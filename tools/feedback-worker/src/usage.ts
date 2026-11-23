/**
 * What POST /usage accepts (#285): a batch of usage counts from one install,
 * of the shape apps/mobile/src/usage-log.ts sends. One row is an event on a
 * day ("open on 2026-11-24"), with a random install ID, the app version and
 * the kind of phone. No question, reply or location is ever part of it.
 *
 * Kept free of the Workers runtime so it can be tested in Node.
 */

/** The app's list (usage-log.ts USAGE_EVENTS). A newer app's event is refused, not guessed at. */
export const EVENTS: ReadonlySet<string> = new Set([
  'open', 'ask', 'setup_started', 'guides_ready', 'area_ready', 'setup_done', 'setup_found', 'model_ready', 'model_failed',
]);
export const USAGE_LIMITS = { batch: 50, short: 40 } as const;
/** Larger than any batch within the limits. */
export const USAGE_MAX_BODY = 12_000;

export interface UsageRow {
  readonly installId: string;
  readonly event: string;
  readonly day: string;
  readonly appVersion: string;
  readonly platform: string;
}

const ID = /^[A-Za-z0-9_-]{8,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max: number, min = 1): v is string =>
  typeof v === 'string' && v.length >= min && v.length <= max;

/** The rows, or why the batch was refused. One bad row refuses the batch: the app then lets it go. */
export function checkUsage(body: unknown): { ok: true; rows: UsageRow[] } | { ok: false; why: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, why: 'not an object' };
  const b = body as Record<string, unknown>;
  if (typeof b.installId !== 'string' || !ID.test(b.installId)) return { ok: false, why: 'installId' };
  if (!Array.isArray(b.events) || b.events.length === 0 || b.events.length > USAGE_LIMITS.batch) return { ok: false, why: 'events' };
  const rows: UsageRow[] = [];
  for (const e of b.events as unknown[]) {
    if (typeof e !== 'object' || e === null) return { ok: false, why: 'event' };
    const o = e as Record<string, unknown>;
    if (typeof o.event !== 'string' || !EVENTS.has(o.event)) return { ok: false, why: 'event' };
    if (typeof o.day !== 'string' || !DAY.test(o.day)) return { ok: false, why: 'day' };
    if (!str(o.appVersion, USAGE_LIMITS.short)) return { ok: false, why: 'appVersion' };
    if (!str(o.platform, USAGE_LIMITS.short)) return { ok: false, why: 'platform' };
    rows.push({ installId: b.installId, event: o.event, day: o.day, appVersion: o.appVersion, platform: o.platform });
  }
  return { ok: true, rows };
}

/** One row per install, event and day: a resend is ignored, so the first copy's version stays. */
export const USAGE_INSERT = `
INSERT INTO usage (install_id, event, day, app_version, platform, received_at)
VALUES (?1, ?2, ?3, ?4, ?5, ?6)
ON CONFLICT (install_id, event, day) DO NOTHING`;

export const usageBindings = (r: UsageRow, receivedAt: string): unknown[] =>
  [r.installId, r.event, r.day, r.appVersion, r.platform, receivedAt];
