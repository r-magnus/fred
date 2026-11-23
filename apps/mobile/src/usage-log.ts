/**
 * Usage counts (#285), as they wait on the phone to be sent: whether setup
 * got through, and on which days Fred was opened and asked something. They
 * measure the Release Candidate KRs (testers finish setup; testers come back),
 * which ratings can't.
 *
 * One row is an event on a day: "open on 2026-11-24". Never what was asked,
 * never where. The rows carry a random install ID, made on the phone the
 * first time and kept in usage.json, so the days of one install can be told
 * apart from another's. It is not a device ID, and it is never sent with a
 * rating, so ratings still can't be tied to each other or to these rows.
 *
 * Each event is noted at most once a day (`last`), so the file stays small
 * however often Fred is opened, and the server ignores a row it already has,
 * so a resend after a lost reply is stored once.
 *
 * Kept free of Expo so the rules can be tested in Node; src/usage.ts does the
 * file and the network.
 */

export const USAGE_EVENTS = [
  'open',          // Fred came to the screen (launch, or back from another app)
  'ask',           // a question was sent
  'setup_started', // the setup wizard was shown
  'guides_ready',  // the guides download finished
  'area_ready',    // a state's or region's download finished
  'setup_done',    // the wizard was finished, or skipped out of
  'setup_found',   // setup was already done before counting began (an update)
  'model_ready',   // the model and guides loaded: Fred can answer on this phone
  'model_failed',  // they didn't, with the guides on the phone
] as const;
export type UsageEvent = typeof USAGE_EVENTS[number];

/** One event on one day, as it is sent. */
export interface UsageRow {
  readonly event: UsageEvent;
  /** The phone's own date, YYYY-MM-DD. */
  readonly day: string;
  readonly appVersion: string;
  readonly platform: string;
}

export interface UsageState {
  readonly installId: string;
  /** The last day each event was noted. */
  readonly last: Partial<Record<UsageEvent, string>>;
  readonly waiting: readonly UsageRow[];
}

/** The same limits the server holds rows to (tools/feedback-worker/src/usage.ts). */
export const USAGE_LIMITS = { installId: 64, short: 40, batch: 50 } as const;
/** Months out of signal: the oldest rows are let go past this. */
export const WAITING_MAX = 400;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Za-z0-9_-]{8,64}$/;
const cut = (s: string, n: number): string => (s.length <= n ? s : s.slice(0, n));
const pad = (n: number): string => String(n).padStart(2, '0');

/** The phone's local date: a day out on the trail is the hiker's day, not UTC's. */
export const dayOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** A random ID for this install: about 100 bits, nothing taken from the phone. */
export function newInstallId(rand: () => number = Math.random): string {
  let s = '';
  while (s.length < 20) s += Math.floor(rand() * 36 ** 5).toString(36).padStart(5, '0');
  return `i${s.slice(0, 20)}`;
}

export const freshState = (rand?: () => number): UsageState => ({ installId: newInstallId(rand), last: {}, waiting: [] });

/** A saved state read back, or a fresh one if the file is missing or not ours. */
export function readState(parsed: unknown, rand?: () => number): UsageState {
  if (typeof parsed !== 'object' || parsed === null) return freshState(rand);
  const p = parsed as Record<string, unknown>;
  if (typeof p.installId !== 'string' || !ID.test(p.installId)) return freshState(rand);
  const known = new Set<string>(USAGE_EVENTS);
  const last: Partial<Record<UsageEvent, string>> = {};
  if (typeof p.last === 'object' && p.last !== null) {
    for (const [k, v] of Object.entries(p.last as Record<string, unknown>)) {
      if (known.has(k) && typeof v === 'string' && DAY.test(v)) last[k as UsageEvent] = v;
    }
  }
  const waiting = Array.isArray(p.waiting)
    ? (p.waiting as unknown[]).filter((r): r is UsageRow => {
      const o = r as Record<string, unknown> | null;
      return typeof o === 'object' && o !== null && known.has(o.event as string) && typeof o.day === 'string' && DAY.test(o.day)
        && typeof o.appVersion === 'string' && typeof o.platform === 'string';
    })
    : [];
  return { installId: p.installId, last, waiting: waiting.slice(-WAITING_MAX) };
}

/** The state with this event noted for the day; the same state if it already was. */
export function note(s: UsageState, event: UsageEvent, day: string, appVersion: string, platform: string): UsageState {
  if (s.last[event] === day) return s;
  const row: UsageRow = { event, day, appVersion: cut(appVersion, USAGE_LIMITS.short), platform: cut(platform, USAGE_LIMITS.short) };
  return { ...s, last: { ...s.last, [event]: day }, waiting: [...s.waiting, row].slice(-WAITING_MAX) };
}

/** Whether an event was ever noted on this install. */
export const ever = (s: UsageState, event: UsageEvent): boolean => s.last[event] !== undefined;

/** The next rows to send, oldest first. */
export const batchOf = (s: UsageState): UsageRow[] => s.waiting.slice(0, USAGE_LIMITS.batch);

const key = (r: UsageRow): string => `${r.event}\n${r.day}`;

/**
 * The state, read again after a send, without the rows the server is done
 * with. Rows noted while the send was under way stay.
 */
export function without(s: UsageState, done: readonly UsageRow[]): UsageState {
  if (done.length === 0) return s;
  const gone = new Set(done.map(key));
  return { ...s, waiting: s.waiting.filter((r) => !gone.has(key(r))) };
}

/** What one send carries. */
export const body = (s: UsageState, rows: readonly UsageRow[]): { installId: string; events: readonly UsageRow[] } =>
  ({ installId: s.installId, events: rows });
