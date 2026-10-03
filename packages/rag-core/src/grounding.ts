/**
 * Keeping a model-written answer to its sources (#126,
 * docs/plan-grounded-answers.md).
 *
 * The number check: a sentence that states a number found nowhere in the
 * passages the model was given (or in the question) is the model's own.
 * "Black spruce... typically reaching heights of 30 to 60 meters"; "If you
 * are camped above 8,000 feet, boil water for 3 minutes" under an EPA page
 * that says 5,000. The answer streams token by token as before; only a
 * sentence with a digit in it is held until it ends and checked. On a number
 * with no source, the rest of the answer is replaced (`onUnsourced`).
 */

/**
 * Lowest similarity at which a passage sentence is quoted for a question.
 * Set on seen questions only (see docs/results-grounded-answers.md).
 */
export const QUOTE_FLOOR = 0.5;

/** Sentences this close to the best one are quoted with it (two at most). */
export const QUOTE_BAND = 0.05;

/** Said before quoted sentences that replace the rest of an answer. */
export const QUOTE_INSTEAD = 'From the source:';

const WORDS: Readonly<Record<string, string>> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', fifteen: '15', twenty: '20', thirty: '30', forty: '40', fifty: '50', sixty: '60',
  hundred: '100', half: '0.5', quarter: '0.25',
};

/** The numbers a text states, normalised: "1,000" -> "1000", "three" -> "3". */
export function numbersIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) out.push(m[0].replace(/,(?=\d{3}\b)/g, '').replace(/\.0+$/, ''));
  for (const m of text.toLowerCase().matchAll(/\b[a-z]+\b/g)) if (WORDS[m[0]] !== undefined) out.push(WORDS[m[0]]!);
  return out;
}

/**
 * The numbers a sentence states that the sources don't. List markers ("2.")
 * and step numbers are not claims.
 */
export function unsourcedNumbers(sentence: string, sources: ReadonlySet<string>): string[] {
  const claim = sentence.replace(/^\s*(?:\d+[.)]|step \d+:?)\s+/i, '');
  return [...new Set(numbersIn(claim))].filter((n) => !sources.has(n));
}

/** The end of the first sentence in a buffer, or 0. Numbers like "2.5" don't end one. */
function sentenceEnd(buf: string): number {
  const m = /(?<!\d)[.!?](?=\s)|(?<=\d)[.!?](?=\s+[A-Z])|\n/.exec(buf);
  return m === null ? 0 : m.index + m[0].length;
}

export async function* numberChecked(
  tokens: AsyncIterable<string>,
  sourceText: string,
  onUnsourced: (shownAlready: boolean) => Promise<string>,
): AsyncGenerator<string> {
  const sources = new Set(numbersIn(sourceText));
  let held = '';
  let shown = false;
  for await (const tok of tokens) {
    if (held === '' && !/\d/.test(tok)) {
      // Not inside a sentence with a number: pass straight through, but keep
      // the current sentence's text in case a digit arrives later in it.
      yield tok;
      if (tok.trim() !== '') shown = true;
      continue;
    }
    held += tok;
    for (let cut = sentenceEnd(held); cut > 0; cut = sentenceEnd(held)) {
      const sentence = held.slice(0, cut);
      if (unsourcedNumbers(sentence, sources).length > 0) {
        yield await onUnsourced(shown);
        return;
      }
      yield sentence;
      if (sentence.trim() !== '') shown = true;
      held = held.slice(cut);
      if (!/\d/.test(held)) { if (held !== '') { yield held; shown = true; } held = ''; break; }
    }
  }
  if (held !== '') {
    if (unsourcedNumbers(held, sources).length > 0) { yield await onUnsourced(shown); return; }
    yield held;
  }
}
