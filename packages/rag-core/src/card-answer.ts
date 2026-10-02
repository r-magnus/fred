/**
 * Answering from a field card rather than letting the model rewrite it.
 *
 * With the right card in the prompt, the 1.7B model still drops a "don't"
 * ("remove any clothing that is stuck to the burn") or merges the adult and
 * baby steps of CPR (docs/plan-phase3.md, class A). Cards are reviewed text in
 * Fred's voice, so when one clearly matches, the safest answer is the card.
 *
 * Card chunk text is written by tools/ingest/src/cards.ts `cardText`: the title,
 * a one-line summary, numbered steps, then the don'ts, the get-help line and
 * any notes, one per line. The parse below relies on that layout.
 */
import type { PromptParts } from './prompt.ts';

export interface ParsedCard {
  readonly title: string;
  readonly summary: string;
  readonly steps: readonly string[];
  /** Everything after the steps: don'ts, when to get help, notes. Always shown. */
  readonly rest: readonly string[];
}

const STEP = /^(\d+)\.\s+(.*)$/;

export function parseCard(text: string): ParsedCard {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  const [title = '', summary = '', ...body] = lines;
  const steps: string[] = [];
  const rest: string[] = [];
  for (const l of body) {
    const m = STEP.exec(l);
    if (m !== null && rest.length === 0) steps.push(m[2]!);
    else rest.push(l);
  }
  return { title, summary, steps, rest };
}

/**
 * The card as an answer. `stepIndexes` (0-based, card order) limits the steps
 * shown; the summary, don'ts and get-help line are always kept, because they
 * are where the card's safety content lives.
 */
export function renderCard(card: ParsedCard, stepIndexes?: readonly number[]): string {
  const keep = stepIndexes === undefined || stepIndexes.length === 0
    ? card.steps
    : card.steps.filter((_, i) => stepIndexes.includes(i));
  return [card.summary, ...keep.map((s, i) => `${i + 1}. ${s}`), ...card.rest].join('\n');
}

/** Ask the model which of the card's steps the question needs. */
export function buildPickParts(query: string, card: ParsedCard): PromptParts {
  return {
    system: 'You pick which steps of a first-aid or survival card answer a hiker\'s question. Reply with step numbers only.',
    user: `CARD: ${card.title}\n${card.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n` +
      `QUESTION: ${query}\n\n` +
      'Which steps does the hiker need to answer this question? Reply with the step numbers separated by commas, and nothing else.\n\nSTEPS:',
  };
}

/** Step numbers from the pick reply, 0-based, valid and in card order. Empty means "show every step". */
export function readPick(text: string, stepCount: number): number[] {
  const picked = new Set<number>();
  for (const m of text.matchAll(/\d+/g)) {
    const n = Number(m[0]);
    if (n >= 1 && n <= stepCount) picked.add(n - 1);
  }
  return [...picked].sort((a, b) => a - b);
}

/**
 * #109: every line of a card a question could be answered by, in order: its
 * steps, then its don'ts, get-help line and notes. A reply made of some of
 * these lines is the card's own reviewed wording, so it cannot invert it.
 */
export function cardLines(card: ParsedCard): string[] {
  return [...card.steps, ...card.rest];
}

/** Ask the model which lines of the card answer the question. Numbers only. */
export function buildLinePickParts(query: string, earlier: readonly string[], card: ParsedCard): PromptParts {
  const lines = cardLines(card);
  return {
    system: 'You pick which lines of a first-aid or survival card answer a hiker\'s question. Reply with line numbers only.',
    user: `CARD: ${card.title}\n${lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}\n\n` +
      (earlier.length === 0 ? '' : `EARLIER MESSAGES: ${earlier.join(' / ')}\n`) +
      `QUESTION: ${query}\n\n` +
      'Which lines answer exactly this question? Reply with at most 3 line numbers separated by commas. If no line answers it, reply 0.\n\nLINES:',
  };
}

/** The picked lines (0-based, card order), or empty for "none" or nothing readable. At most 3. */
export function readLinePick(text: string, lineCount: number): number[] {
  if (/^\s*0\b/.test(text)) return [];
  return readPick(text, lineCount).slice(0, 3);
}

/**
 * A card's steps in a chosen order, for one answer to its clarifying question.
 * The summary, don'ts and get-help line stay, as in `renderCard`.
 */
export function renderCardSteps(card: ParsedCard, steps1Based: readonly number[]): string {
  const keep = steps1Based.map((n) => card.steps[n - 1]).filter((s): s is string => s !== undefined);
  return [card.summary, ...keep.map((s, i) => `${i + 1}. ${s}`), ...card.rest].join('\n');
}

/** "not", "no", "n't" or "without" just before a phrase flips it: "no blisters" is not "blistered". */
const NEGATION = /\b(?:no|not|never|without|isn'?t|aren'?t|wasn'?t|don'?t|doesn'?t|didn'?t)\s+(?:\w+\s+)?$/i;

/**
 * Which answer the message already gives, if exactly one. A phrase counts
 * unless a negation sits just before it, so "the skin isn't blistered" does
 * not pick "Blistered". Two or more answers named, or none, means ask.
 */
export function pickChoice(
  choices: readonly { readonly label: string; readonly words: readonly string[] }[],
  message: string,
): number | null {
  const text = message.toLowerCase();
  const hits = choices.map((c) => c.words.some((w) => {
    const phrase = w.toLowerCase();
    let at = text.indexOf(phrase);
    while (at !== -1) {
      const before = text.slice(Math.max(0, at - 24), at);
      const wordStart = at === 0 || /\W/.test(text[at - 1]!);
      if (wordStart && (/^(?:no|not|without)\b/.test(phrase) || !NEGATION.test(before))) return true;
      at = text.indexOf(phrase, at + 1);
    }
    return false;
  }));
  const picked = hits.flatMap((h, i) => (h ? [i] : []));
  return picked.length === 1 ? picked[0]! : null;
}
