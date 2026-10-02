/**
 * Fixed text shown a few words at a time, as if it were being written.
 *
 * A field card, its matched lines or a clarifying answer arrive as one piece
 * of reviewed text; model-written answers arrive token by token. Revealing the
 * fixed text word by word makes the two feel alike (Ryan, 2026-10-02: "just
 * for user feel"). It is display only: nothing upstream waits on it, and the
 * text is never changed, only paced.
 *
 * In an emergency the whole card matters more than the effect, so a piece is
 * always fully shown within `maxMs` however long it is (a 150-word card at the
 * default takes 1.5 s), and a stop shows the rest at once: a card cut off
 * before its don'ts would be worse than no effect.
 */

export interface TypeOutOptions {
  /** Pause between words for short text. Default 30 ms. */
  readonly perWordMs?: number;
  /** Longest a single piece of text takes to appear. Default 1500 ms. */
  readonly maxMs?: number;
  /** When aborted, the rest of the current piece is shown at once. */
  readonly signal?: AbortSignal;
  /** For tests. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** Pieces with no more words than this pass straight through: model tokens. */
const TOKEN_WORDS = 3;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function* typeOut(stream: AsyncIterable<string>, opts: TypeOutOptions = {}): AsyncIterable<string> {
  const perWordMs = opts.perWordMs ?? 30;
  const maxMs = opts.maxMs ?? 1500;
  const sleep = opts.sleep ?? wait;
  for await (const piece of stream) {
    const words = piece.match(/\s*\S+\s*/g) ?? [piece];
    if (words.length <= TOKEN_WORDS) { yield piece; continue; }
    const pause = Math.min(perWordMs, maxMs / words.length);
    for (const [i, w] of words.entries()) {
      if (opts.signal?.aborted === true) { yield words.slice(i).join(''); break; }
      yield w;
      if (i < words.length - 1) await sleep(pause);
    }
  }
}
