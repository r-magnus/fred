/**
 * Ratings of Fred's replies (#247), as they wait on the phone to be sent.
 *
 * A thumbs up or down is written to the outbox the moment it is tapped, and
 * leaves it only once the server has said it has it. Out of signal a send
 * simply fails and is tried again later (src/feedback.ts says when), so
 * nothing here asks whether the phone is online: on a trail the answer to
 * that is often wrong both ways, and trying is the only honest test.
 *
 * One reply has one rating, under one id. A changed mind (up, then down) or a
 * comment added afterwards replaces the waiting copy, and the server keeps the
 * newest by `ratedAt`, so a copy sent twice (the reply to a send can be lost
 * even when the send arrived) is stored once.
 *
 * Kept free of Expo so the rules can be tested in Node.
 */

export type Thumb = 'up' | 'down';

/** One rating as it is sent: what was asked, what Fred said, and what the hiker thought of it. */
export interface Rating {
  /** Stable for the reply: a second rating of the same reply replaces the first. */
  readonly id: string;
  readonly rating: Thumb;
  /** "What can Fred do better?", when the hiker wrote something. */
  readonly comment: string | null;
  readonly question: string;
  /** The words Fred showed, as near as they can be put in one string. */
  readonly reply: string;
  /** answer, chat or abstain (a decline): which part of Fred replied. */
  readonly replyKind: string;
  /** The sources listed under the reply: "manual · section". */
  readonly sources: readonly string[];
  readonly deep: boolean;
  readonly stopped: boolean;
  /** ISO times. */
  readonly askedAt: string;
  readonly ratedAt: string;
  readonly appVersion: string;
  readonly platform: string;
}

/** Long enough for any reply Fred writes; a cap so one rating can't be megabytes. */
export const LIMITS = { id: 64, comment: 2000, question: 2000, reply: 8000, sources: 20, source: 200, short: 40 } as const;
/** The oldest waiting ratings are let go past this: a phone months out of signal shouldn't grow a file without end. */
export const OUTBOX_MAX = 300;

const cut = (s: string, n: number): string => (s.length <= n ? s : s.slice(0, n));

/** A rating trimmed to the limits the server holds it to, so a long reply is never refused for its length. */
export function fit(r: Rating): Rating {
  const comment = r.comment === null ? null : cut(r.comment.trim(), LIMITS.comment);
  return {
    ...r,
    id: cut(r.id, LIMITS.id),
    comment: comment === '' ? null : comment,
    question: cut(r.question, LIMITS.question),
    reply: cut(r.reply, LIMITS.reply),
    replyKind: cut(r.replyKind, LIMITS.short),
    sources: r.sources.slice(0, LIMITS.sources).map((s) => cut(s, LIMITS.source)),
    appVersion: cut(r.appVersion, LIMITS.short),
    platform: cut(r.platform, LIMITS.short),
  };
}

/** The outbox with this rating in it, in place of any earlier one for the same reply. */
export function upsert(outbox: readonly Rating[], r: Rating): Rating[] {
  return [...outbox.filter((o) => o.id !== r.id), fit(r)].slice(-OUTBOX_MAX);
}

/**
 * What a send came to.
 *   sent   the server has it: let it go
 *   retry  no signal, a timeout, the server busy: keep it, and stop for now
 *   drop   the server refused this rating itself: sending it again won't help
 */
export type SendResult = 'sent' | 'retry' | 'drop';

/** How an HTTP status reads as a SendResult. */
export function resultOf(status: number): SendResult {
  if (status >= 200 && status < 300) return 'sent';
  // Too many, or the server's own fault: another time.
  if (status === 408 || status === 429 || status >= 500) return 'retry';
  return 'drop';
}

/**
 * Sends what waits, oldest first, and takes out each one the server is done
 * with. The first `retry` ends the round: without signal, the rest would fail
 * the same way.
 *
 * The outbox is read again before it is written: a rating tapped, or a comment
 * added, while the sends were under way must not be lost. A rating comes out
 * only if it is still the copy that was sent (same id, same ratedAt).
 */
export async function flushOutbox(
  load: () => Rating[], save: (outbox: Rating[]) => void, send: (r: Rating) => Promise<SendResult>,
): Promise<{ sent: number; dropped: number; left: number }> {
  const done = new Set<string>();
  let sent = 0;
  let dropped = 0;
  for (const r of load()) {
    let res: SendResult;
    try { res = await send(r); } catch { res = 'retry'; }
    if (res === 'retry') break;
    if (res === 'sent') sent += 1; else dropped += 1;
    done.add(`${r.id}\n${r.ratedAt}`);
  }
  if (done.size === 0) return { sent, dropped, left: load().length };
  const left = load().filter((r) => !done.has(`${r.id}\n${r.ratedAt}`));
  save(left);
  return { sent, dropped, left: left.length };
}
