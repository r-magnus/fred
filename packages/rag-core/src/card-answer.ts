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
import { cosineInt8 } from './score.ts';
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

/**
 * #109: the lowest similarity at which a card line counts as answering a
 * question. Set on seen chats (2026-10-02): the line that answers scored
 * 0.39-0.55 ("Don't put ice on it" 0.54 for "can i put ice on it"); a card
 * with no such line topped out at 0.28-0.36 ("can she walk on it" 0.30, a
 * soaked dressing 0.36). Under it the card is shown whole, as before.
 */
export const LINE_FLOOR = 0.37;

/** Lines this close to the best one are shown with it. */
const LINE_BAND = 0.08;

/**
 * The card lines (0-based, card order) that answer a question: the best one if
 * it reaches LINE_FLOOR, and the next if it is nearly as close. Empty when no
 * line does, or the vectors do not match the card (a pack built from other text).
 */
export function matchCardLines(queryVec: Float32Array, card: ParsedCard, rows: readonly Int8Array[] | undefined, message?: string): number[] {
  if (rows === undefined || rows.length !== cardLines(card).length) return [];
  const sims = rows.map((r, i) => [cosineInt8(queryVec, r), i] as const).sort((x, y) => y[0] - x[0]);
  const best = sims[0];
  if (best === undefined || best[0] < LINE_FLOOR) return [];
  const picked = sims.slice(0, 2).filter(([d]) => d >= Math.max(LINE_FLOOR, best[0] - LINE_BAND)).map(([, i]) => i);
  // #112: "what should I watch for" is answered by the card's list of signs.
  // The message's other words outvote it: "My friend hit their head on a rock
  // and seems confused. What should I watch for?" matched the neck line and
  // the emergency line (0.52, 0.53) over the concussion signs. Asked without
  // them, the signs line was still second.
  const signs = message !== undefined && ASKS_SIGNS.test(message) ? signsLine(card) : undefined;
  if (signs !== undefined && !picked.includes(signs)) picked.splice(1, 1, signs);
  return picked.sort((x, y) => x - y);
}

/** A question about what to look out for, or how to tell. */
const ASKS_SIGNS = /\b(?:watch(?: out)? for|look(?: out)? for|signs?|symptoms?|how (?:do|can|would|will) (?:i|we|you) (?:know|tell))\b/i;

/** The card's list of signs: the line that opens "Watch for" or "Signs" (0-based, card order). */
export function signsLine(card: ParsedCard): number | undefined {
  const i = cardLines(card).findIndex((l) => /^(?:watch for|signs\b)/i.test(l));
  return i < 0 ? undefined : i;
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
