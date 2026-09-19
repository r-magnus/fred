/**
 * Emit the A-KR2 grading packet: every answer that needs judging, with its
 * answer sheet.
 *
 *   node tools/eval/src/grading-packet.ts [runs.jsonl]
 *
 * The proposal's method (README §04, QR-02) is to "give an enterprise model a
 * test to administer to Fred, alongside an answer sheet", then decide whether
 * each answer is acceptable. The enterprise model is Claude Opus 5, reading this
 * packet directly — there is no API call in the loop, because the grader is
 * already in the loop.
 *
 * What this replaces: an earlier `grade.ts` posted each answer to the Messages
 * API. That worked, but it made a measurement the project could not run without
 * a key, and it added an SDK dependency to a repo whose whole premise is that
 * the thing runs offline. Reading a packet is the same measurement with the
 * machinery removed.
 *
 * Questions the pipeline declined are NOT in the packet. There is no prose to
 * judge, and asking a grader whether an empty string is a good answer invents a
 * measurement; those are scored by outcome in `verdicts.ts`.
 */
import { readFileSync } from 'node:fs';
import { loadGradedSet, setsFor, type GradedQuestion, type GradedRun } from './graded-types.ts';

const runsPath = process.argv[2] ?? 'docs/graded-runs.jsonl';

const questions = new Map<string, GradedQuestion>(
  setsFor(process.env.EVAL_SET).flatMap((s) => loadGradedSet(s, (p) => readFileSync(p, 'utf8'))).map((q) => [q.id, q]),
);
const runs: GradedRun[] = readFileSync(runsPath, 'utf8')
  .split('\n').filter((l) => l.trim() !== '')
  .map((l) => JSON.parse(l) as GradedRun);

const judged = runs.filter((r) => {
  const q = questions.get(r.questionId);
  if (!q) throw new Error(`run references unknown question ${r.questionId}`);
  return q.expect === 'answer' && r.outcome === 'answer';
});

console.log(`# A-KR2 grading packet`);
console.log(`# ${judged.length} of ${runs.length} runs need judging; the rest are scored by outcome.\n`);

for (const r of judged) {
  const q = questions.get(r.questionId)!;
  console.log('='.repeat(78));
  console.log(`ID:       ${q.id}   [${q.pack}, ${q.provenance}]`);
  console.log(`QUESTION: ${q.question}${q.state === null ? '' : `   (location: ${q.state})`}`);
  console.log(`\nKEY POINTS:`);
  q.keyPoints.forEach((p, i) => console.log(`  [${i}] ${p}`));
  if (q.redFlags && q.redFlags.length > 0) {
    console.log(`\nRED FLAGS (any present => unacceptable):`);
    q.redFlags.forEach((f, i) => console.log(`  [${i}] ${f}`));
  }
  console.log(`\nFRED'S ANSWER (U=${r.topScore.toFixed(3)}, ${r.citations.length} citations):`);
  console.log(r.answer.split('\n').map((l) => `  ${l}`).join('\n'));
  console.log();
}
