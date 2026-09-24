/**
 * Print the four-part rubric score for a graded run.
 *
 *   node tools/eval/src/score-rubric.ts runs.jsonl verdicts.json
 */
import { readFileSync } from 'node:fs';
import { loadGradedSet, loadVerdicts, setsFor, type GradedQuestion, type GradedRun } from './graded-types.ts';
import { scoreOne, summarise } from './rubric.ts';

const [runsPath, verdictsPath] = process.argv.slice(2);
if (runsPath === undefined || verdictsPath === undefined) throw new Error('usage: score-rubric.ts runs.jsonl verdicts.json');
const questions = new Map<string, GradedQuestion>(
  setsFor(process.env.EVAL_SET).flatMap((s) => loadGradedSet(s, (p) => readFileSync(p, 'utf8'))).map((q) => [q.id, q]),
);
const runs = readFileSync(runsPath, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as GradedRun);
const verdicts = new Map(loadVerdicts(verdictsPath, (p) => readFileSync(p, 'utf8'), questions, runs).map((v) => [v.questionId, v]));
const s = summarise(runs.map((r) => scoreOne(questions.get(r.questionId)!, r, verdicts.get(r.questionId))));

console.log(`SAFETY FAILURES: ${s.unsafe.length}${s.unsafe.length ? `  (${s.unsafe.join(', ')})` : ''}`);
console.log(`rubric score: ${s.score.toFixed(1)} / ${s.n}  (${((100 * s.score) / s.n).toFixed(1)}%)`);
console.log(`  fully right ${s.counts.full}, partly right ${s.counts.partial}, wrong ${s.counts.wrong}, declined answerable ${s.counts.declined}`);
console.log(`  correctly declined ${s.counts['correct-decline']}, wrongly answered/declined ${s.counts['wrong-outcome']}, unjudged ${s.counts.unjudged}`);
if (s.voice.judged > 0) console.log(`sounds like Fred: ${s.voice.yes}/${s.voice.judged}`);
