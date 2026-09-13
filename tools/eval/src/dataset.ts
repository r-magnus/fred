import { readFileSync } from 'node:fs';
import type { EvalQuestion } from './types.ts';

/**
 * Load and validate an eval set. Validation is strict because a malformed key
 * silently becomes a wrong accuracy number that looks perfectly plausible.
 */
export function loadDataset(path: string): EvalQuestion[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!Array.isArray(raw)) throw new Error(`${path}: expected a JSON array`);

  const seen = new Set<string>();
  return raw.map((entry, i) => {
    const q = entry as Partial<EvalQuestion>;
    const where = `${path}[${i}]`;
    if (typeof q.id !== 'string' || q.id === '') throw new Error(`${where}: missing id`);
    if (seen.has(q.id)) throw new Error(`${where}: duplicate id "${q.id}"`);
    seen.add(q.id);
    if (typeof q.question !== 'string' || q.question.trim() === '') {
      throw new Error(`${where}: missing question`);
    }
    if (!Array.isArray(q.options) || q.options.length !== 4) {
      throw new Error(`${where}: expected exactly 4 options`);
    }
    if (new Set(q.options).size !== 4) throw new Error(`${where}: duplicate options`);
    if (typeof q.answer !== 'number' || q.answer < 0 || q.answer > 3) {
      throw new Error(`${where}: answer must be 0-3`);
    }
    return q as EvalQuestion;
  });
}

/** Distribution of correct-answer positions; a skew here would flatter a model
 *  that has a positional bias rather than knowledge. */
export function answerBalance(questions: readonly EvalQuestion[]): number[] {
  const counts = [0, 0, 0, 0];
  for (const q of questions) counts[q.answer] = (counts[q.answer] ?? 0) + 1;
  return counts;
}
