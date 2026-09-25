/**
 * Find the answer sheet's source passage in retrieved text.
 *
 * Every graded question carries `cite.quote`, the passage its key points were
 * written from. That makes retrieval checkable on its own: if the quote is not
 * in what the model reads, no generator can produce the answer sheet's answer,
 * and the failure belongs to search, not to the model.
 *
 * This was missing for most of September, and its absence is how "retrieval is
 * not the problem" survived for three days on the evidence of "four citations
 * and a non-zero score" (docs/results-strategy-research.md). Four citations
 * says retrieval returned something. Only this says it returned the right thing.
 *
 * Matching is by overlapping word windows rather than exact substring, because
 * the quote and the chunk are cut at different places. A quote that starts in
 * one chunk and ends in the next must still count as found, and the ingest
 * cleaner rewrites punctuation and whitespace that a quote taken from the PDF
 * still has.
 */

/** Words per window. Six is long enough that a hit is not a coincidence. */
const WINDOW = 6;
/** Windows start every STRIDE words, so a quote of n words yields ~n/3 probes. */
const STRIDE = 3;

export function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** The probe windows for a quote. A short quote yields a single window. */
export function goldWindows(quote: string): string[] {
  const words = normalise(quote).split(' ').filter((w) => w !== '');
  if (words.length <= WINDOW) return words.length === 0 ? [] : [words.join(' ')];
  const out: string[] = [];
  for (let i = 0; i + WINDOW <= words.length; i += STRIDE) {
    out.push(words.slice(i, i + WINDOW).join(' '));
  }
  return out;
}

/** True when any window of the quote appears in the text. */
export function containsGold(text: string, windows: readonly string[]): boolean {
  if (windows.length === 0) return false;
  const t = normalise(text);
  return windows.some((w) => t.includes(w));
}

/**
 * Every prohibition in a text, as the negation plus the two words it governs,
 * normalised ("do not massage or"). If the phrase is missing from what the
 * model reads, either the whole warning went or it lost its "do not" and now
 * reads as an instruction.
 */
export function prohibitionPhrases(text: string): string[] {
  const t = normalise(text);
  return [...t.matchAll(/\b(?:do not|don t|never|avoid|must not|should not)(?: [a-z0-9]+){2}/g)].map((m) => m[0]);
}
