/**
 * What the feedback server (#247) accepts: one rating from the Fred app, of
 * the shape apps/mobile/src/feedback-outbox.ts sends, within its limits.
 * Anything else is refused with 400, and the app lets that rating go rather
 * than sending it forever.
 *
 * Kept free of the Workers runtime so it can be tested in Node.
 */

export interface Row {
  readonly id: string;
  readonly rating: 'up' | 'down';
  readonly comment: string | null;
  readonly question: string;
  readonly reply: string;
  readonly replyKind: string;
  readonly sources: readonly string[];
  readonly deep: boolean;
  readonly stopped: boolean;
  readonly askedAt: string;
  readonly ratedAt: string;
  readonly appVersion: string;
  readonly platform: string;
}

/** The app's own limits (feedback-outbox.ts LIMITS), so nothing it sends is refused for length. */
export const LIMITS = { id: 64, comment: 2000, question: 2000, reply: 8000, sources: 20, source: 200, short: 40 } as const;
/** Larger than any rating within the limits; checked before the body is parsed. */
export const MAX_BODY = 48_000;

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const ID = /^[A-Za-z0-9_-]+$/;

const str = (v: unknown, max: number, min = 0): v is string =>
  typeof v === 'string' && v.length >= min && v.length <= max;

/** The rating, or why it was refused. */
export function check(body: unknown): { ok: true; row: Row } | { ok: false; why: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false, why: 'not an object' };
  const b = body as Record<string, unknown>;
  if (!str(b.id, LIMITS.id, 1) || !ID.test(b.id)) return { ok: false, why: 'id' };
  if (b.rating !== 'up' && b.rating !== 'down') return { ok: false, why: 'rating' };
  if (b.comment !== null && !str(b.comment, LIMITS.comment)) return { ok: false, why: 'comment' };
  if (!str(b.question, LIMITS.question)) return { ok: false, why: 'question' };
  if (!str(b.reply, LIMITS.reply)) return { ok: false, why: 'reply' };
  if (!str(b.replyKind, LIMITS.short, 1)) return { ok: false, why: 'replyKind' };
  if (!Array.isArray(b.sources) || b.sources.length > LIMITS.sources
    || !b.sources.every((s) => str(s, LIMITS.source))) return { ok: false, why: 'sources' };
  if (typeof b.deep !== 'boolean' || typeof b.stopped !== 'boolean') return { ok: false, why: 'flags' };
  if (!str(b.askedAt, 40) || !ISO.test(b.askedAt)) return { ok: false, why: 'askedAt' };
  if (!str(b.ratedAt, 40) || !ISO.test(b.ratedAt)) return { ok: false, why: 'ratedAt' };
  if (!str(b.appVersion, LIMITS.short, 1)) return { ok: false, why: 'appVersion' };
  if (!str(b.platform, LIMITS.short, 1)) return { ok: false, why: 'platform' };
  return {
    ok: true,
    row: {
      id: b.id, rating: b.rating, comment: b.comment === null || (b.comment as string).trim() === '' ? null : b.comment as string,
      question: b.question, reply: b.reply, replyKind: b.replyKind, sources: b.sources as string[],
      deep: b.deep, stopped: b.stopped, askedAt: b.askedAt, ratedAt: b.ratedAt,
      appVersion: b.appVersion, platform: b.platform,
    },
  };
}

/**
 * The statement that stores a row: a new reply is added; a second rating of
 * the same reply replaces the first only if it is newer, so a late resend of
 * an old copy can't undo a changed mind.
 */
export const UPSERT = `
INSERT INTO feedback (id, rating, comment, question, reply, reply_kind, sources, deep, stopped,
                      asked_at, rated_at, received_at, app_version, platform)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
ON CONFLICT (id) DO UPDATE SET
  rating = excluded.rating, comment = excluded.comment, rated_at = excluded.rated_at,
  received_at = excluded.received_at, app_version = excluded.app_version
WHERE excluded.rated_at >= feedback.rated_at`;

export const bindings = (r: Row, receivedAt: string): unknown[] => [
  r.id, r.rating, r.comment, r.question, r.reply, r.replyKind, JSON.stringify(r.sources),
  r.deep ? 1 : 0, r.stopped ? 1 : 0, r.askedAt, r.ratedAt, receivedAt, r.appVersion, r.platform,
];
