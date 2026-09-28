/**
 * Every question that Fred answers with a field card word for word, and what
 * it shows: the card, the clarifying question, and the case picked, if any.
 * No generation, so the three question sets take a couple of minutes.
 *
 *   EVAL_SET=all node tools/eval/src/card-check.ts out.jsonl
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { ask } from '@fred/rag-core';
import { openHarness } from './harness.ts';
import { BREADTH_SETS, loadGradedSet, setsFor } from './graded-types.ts';
import { askOptionsFromEnv } from './retrieval-env.ts';

const files = process.env.EVAL_SET === 'all' ? [...setsFor('all'), ...BREADTH_SETS] : setsFor(process.env.EVAL_SET);
const questions = files.flatMap((f) => loadGradedSet(f, (p) => readFileSync(p, 'utf8')));
const harness = await openHarness();
const opts = askOptionsFromEnv();
const rows: string[] = [];
for (const q of questions) {
  const res = await ask(q.question, harness, { ...opts, state: q.state });
  if (res.kind !== 'answer' || res.diagnostics.cardAnswer === undefined) continue;
  let text = '';
  for await (const t of res.stream) text += t;
  rows.push(JSON.stringify({
    questionId: q.id, question: q.question, card: res.citations[0]?.section ?? null,
    clarify: res.clarify === undefined ? null : { question: res.clarify.question, picked: res.clarify.picked },
    answer: text,
  }));
}
writeFileSync(process.argv[2] ?? 'card-check.jsonl', rows.join('\n') + '\n');
console.log(`${rows.length} card answers`);
await harness.close();
