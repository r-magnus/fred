/**
 * Rebalance correct-answer positions across A-D.
 *
 * Hand-authored questions cluster the key in early positions — the first draft
 * of the BEC set was 11/17/2/0, with no D at all. A model with a positional
 * bias would then post an inflated score that looks like knowledge. Options are
 * rotated so the key lands round-robin across the four positions.
 *
 *   node tools/eval/src/balance.ts <dataset.json>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { EvalQuestion } from './types.ts';

const path = process.argv[2];
if (!path) throw new Error('usage: balance.ts <dataset.json>');

const questions = JSON.parse(readFileSync(path, 'utf8')) as EvalQuestion[];

const rebalanced = questions.map((q, i) => {
  const target = (i % 4) as 0 | 1 | 2 | 3;
  const options = [...q.options];
  const correct = options[q.answer] as string;
  options.splice(q.answer, 1);
  options.splice(target, 0, correct);
  return { ...q, options: options as unknown as EvalQuestion['options'], answer: target };
});

const counts = [0, 0, 0, 0];
for (const q of rebalanced) counts[q.answer] = (counts[q.answer] ?? 0) + 1;

// Verify the rotation preserved each question's actual correct text.
rebalanced.forEach((q, i) => {
  const original = questions[i] as EvalQuestion;
  if (q.options[q.answer] !== original.options[original.answer]) {
    throw new Error(`${q.id}: rotation changed the correct answer`);
  }
  if (new Set(q.options).size !== 4) throw new Error(`${q.id}: duplicate options after rotation`);
});

writeFileSync(path, JSON.stringify(rebalanced, null, 1) + '\n');
console.log(`${path}: ${rebalanced.length} questions, balance ${counts.join('/')}`);
