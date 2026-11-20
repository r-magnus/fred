/**
 * Rating Fred's replies (#247): the outbox on the phone and the send to the
 * Fred team's server (tools/feedback-worker).
 *
 * A rating is written to feedback-outbox.json when it is tapped and sent when
 * a send can succeed: right away, when Fred opens, and when he comes back to
 * the screen (App.tsx). The server's "got it" is what takes it off the phone.
 * The rules for that are in feedback-outbox.ts.
 *
 * What is sent is said where the hiker rates: the question, Fred's reply and
 * its sources, the thumbs and any comment, the app version and the kind of
 * phone. Never the location, and no id for the phone or the person.
 */
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { flushOutbox, resultOf, upsert, type Rating, type SendResult } from './feedback-outbox.ts';

/**
 * Where ratings go: the Worker's address once it is deployed
 * (tools/feedback-worker/README.md). Unset, ratings wait on the phone until a
 * build that knows it.
 */
export const FEEDBACK_URL: string | null = process.env.EXPO_PUBLIC_FRED_FEEDBACK_URL ?? null;
/** Not a secret (anything in an app can be read out of it): it only keeps stray traffic off the server. */
const CLIENT = 'fred-app/1';
/** Long enough for a slow bar of signal; short enough not to hang on a dead one. */
const SEND_MS = 15_000;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const APP_VERSION: string = (require('../app.json') as { expo: { version: string } }).expo.version;
export const appVersion = (): string => APP_VERSION;
export const platform = (): string => `${Platform.OS} ${String(Platform.Version)}`;

const file = (): File => new File(Paths.document, 'feedback-outbox.json');

function load(): Rating[] {
  try {
    const f = file();
    if (!f.exists) return [];
    const parsed: unknown = JSON.parse(f.textSync());
    return Array.isArray(parsed) ? (parsed as Rating[]) : [];
  } catch {
    return [];
  }
}

function save(outbox: Rating[]): void {
  try {
    const f = file();
    if (outbox.length === 0) { if (f.exists) f.delete(); return; }
    f.write(JSON.stringify(outbox));
  } catch { /* a full disk: the rating is lost, the chat is not */ }
}

async function send(r: Rating): Promise<SendResult> {
  if (FEEDBACK_URL === null) return 'retry';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SEND_MS);
  try {
    const res = await fetch(FEEDBACK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Fred-Client': CLIENT },
      body: JSON.stringify(r),
      signal: ctrl.signal,
    });
    return resultOf(res.status);
  } catch {
    return 'retry';
  } finally {
    clearTimeout(timer);
  }
}

let flushing: Promise<void> | null = null;
let again = false;

/**
 * Sends whatever waits. Safe to call as often as liked: one round runs at a
 * time, and a call during a round asks for one more round after it, so a
 * rating tapped mid-round is not left waiting for the next app open.
 */
export function flushFeedback(): Promise<void> {
  if (flushing !== null) { again = true; return flushing; }
  flushing = (async () => {
    try {
      do {
        again = false;
        const { sent, dropped, left } = await flushOutbox(load, save, send);
        if (sent + dropped > 0) console.log(`[fred] feedback sent ${sent}, refused ${dropped}, waiting ${left}`);
        if (left > 0 && sent + dropped === 0) break; // no signal: stop, the next trigger tries again
      } while (again);
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

/** Keeps the rating on the phone at once, then tries to send it. */
export function rate(r: Rating): void {
  save(upsert(load(), r));
  void flushFeedback();
}

/** How many ratings wait to be sent. */
export const waiting = (): number => load().length;
