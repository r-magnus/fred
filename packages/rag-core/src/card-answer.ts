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
