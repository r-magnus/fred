/**
 * Usage counts (#285): the file on the phone and the send to the Fred team's
 * server (tools/feedback-worker, POST /usage). The rules are in usage-log.ts.
 *
 * Noted: setup steps, and on which days Fred was opened and asked something.
 * Sent with a random install ID and the app version and kind of phone. Never
 * a question, a reply or a location. The privacy policy (site/privacy) says so.
 *
 * Nothing is noted during a phone test run (the `devhooks` file, App.tsx):
 * those are the desktop driving the app, not a hiker.
 */
import { File, Paths } from 'expo-file-system';
import { FEEDBACK_URL, appVersion, platform } from './feedback.ts';
import { resultOf } from './feedback-outbox.ts';
import { batchOf, body, dayOf, ever, note, readState, without, type UsageEvent, type UsageState } from './usage-log.ts';

/** Beside the ratings, on the same Worker. EXPO_PUBLIC_FRED_USAGE_URL points a build at another one. */
export const USAGE_URL: string | null = process.env.EXPO_PUBLIC_FRED_USAGE_URL
  ?? (FEEDBACK_URL === null ? null : FEEDBACK_URL.replace(/\/feedback$/, '/usage'));
const CLIENT = 'fred-app/1';
const SEND_MS = 15_000;

const file = (): File => new File(Paths.document, 'usage.json');
const testRun = (): boolean => {
  try { return new File(Paths.document, 'devhooks').exists; } catch { return false; }
};

let cached: UsageState | null = null;

function load(): UsageState {
  if (cached !== null) return cached;
  let parsed: unknown = null;
  try {
    const f = file();
    if (f.exists) parsed = JSON.parse(f.textSync());
  } catch { /* unreadable: start again with a new ID */ }
  cached = readState(parsed);
  if (parsed === null) save(cached);
  return cached;
}

function save(s: UsageState): void {
  cached = s;
  try { file().write(JSON.stringify(s)); } catch { /* a full disk: a count is lost, nothing else */ }
}

/** Notes the event for today (once a day at most) and tries to send. */
export function noteUsage(event: UsageEvent): void {
  if (testRun()) return;
  try {
    const before = load();
    const after = note(before, event, dayOf(new Date()), appVersion(), platform());
    if (after !== before) save(after);
  } catch { return; }
  void flushUsage();
}

/** Whether this install has ever noted the event. */
export function usageEver(event: UsageEvent): boolean {
  try { return ever(load(), event); } catch { return true; }
}

let flushing: Promise<void> | null = null;
let again = false;

/** Sends what waits, a batch at a time. One round at a time; out of signal it stops until the next try. */
export function flushUsage(): Promise<void> {
  if (flushing !== null) { again = true; return flushing; }
  flushing = (async () => {
    try {
      do {
        again = false;
        for (;;) {
          const s = load();
          const rows = batchOf(s);
          if (rows.length === 0 || USAGE_URL === null) break;
          const res = await send(JSON.stringify(body(s, rows)));
          if (res === 'retry') return;
          // Sent, or refused as a whole (sending it again won't help): let these rows go.
          save(without(load(), rows));
        }
      } while (again);
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

async function send(text: string): Promise<'sent' | 'retry' | 'drop'> {
  if (USAGE_URL === null) return 'retry';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SEND_MS);
  try {
    const res = await fetch(USAGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Fred-Client': CLIENT },
      body: text,
      signal: ctrl.signal,
    });
    return resultOf(res.status);
  } catch {
    return 'retry';
  } finally {
    clearTimeout(timer);
  }
}
