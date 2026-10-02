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
 * default takes 2.5 s), and a stop shows the rest at once: a card cut off
 * before its don'ts would be worse than no effect.
 */

export interface TypeOutOptions {
  /** Time per word for short text. Default 50 ms (Ryan, 2026-10-02: a little slower than 30). */
  readonly perWordMs?: number;
  /** Longest a single piece of text takes to appear. Default 2500 ms. */
  readonly maxMs?: number;
  /** How often the shown text grows. Default 33 ms (about 30 times a second). */
  readonly tickMs?: number;
  /** When aborted, the rest of the current piece is shown at once. */
  readonly signal?: AbortSignal;
  /** For tests. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

/** Pieces with no more words than this pass straight through: model tokens. */
const TOKEN_WORDS = 3;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The words due are worked out from the time elapsed, not from one pause per
 * word: on the phone a timer and a re-render per word took 4.5 s for a card
 * meant to take 1.5 s. Each tick shows however many words are due, so a slow
 * frame shows more words at once instead of falling behind.
 */
export async function* typeOut(stream: AsyncIterable<string>, opts: TypeOutOptions = {}): AsyncIterable<string> {
  const perWordMs = opts.perWordMs ?? 50;
  const maxMs = opts.maxMs ?? 2500;
  const tickMs = opts.tickMs ?? 33;
  const sleep = opts.sleep ?? wait;
  const now = opts.now ?? Date.now;
  for await (const piece of stream) {
    const words = piece.match(/\s*\S+\s*/g) ?? [piece];
    if (words.length <= TOKEN_WORDS) { yield piece; continue; }
    const msPerWord = Math.min(perWordMs, maxMs / words.length);
    const start = now();
    let shown = 0;
    while (shown < words.length) {
      const due = opts.signal?.aborted === true ? words.length
        : Math.min(words.length, Math.max(shown + 1, Math.floor((now() - start) / msPerWord) + 1));
      yield words.slice(shown, due).join('');
      shown = due;
      if (shown < words.length) await sleep(tickMs);
    }
  }
}
