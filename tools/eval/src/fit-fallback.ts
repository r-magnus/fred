/**
 * Fit the fallback threshold — on the tuning set only.
 *
 *   node tools/eval/src/fit-fallback.ts [runs.jsonl]
 *
 * Separate from calibrate.ts because the two thresholds guard different things.
 * The normal gate separates weak retrieval from usable retrieval on queries the
 * lexicon recognised. This one has a harder job: on the fallback path the
 * lexicon recognised nothing, so the retrieval score is the *only* evidence that
 * the query is in scope at all, and it has to carry the weight the scope gate
 * used to carry.
 *
 * Refuses to run against the held-out set, for the reason in
 * docs/results-holdout.md: the separating value there is 0.50, and adopting a
 * number read off that set turns the project's one honest measurement into a
 * second training score.
 */
import { readFileSync } from 'node:fs';
import { extractKeywords, route, type RoutablePack } from '@fred/rag-core';
import { loadGradedSet, setsFor, type GradedQuestion, type GradedRun } from './graded-types.ts';

if (process.env.EVAL_SET === 'holdout' || process.env.EVAL_SET === 'all') {
  console.error('Refusing to fit a threshold on the held-out set. See docs/results-holdout.md.');
  process.exit(2);
}

const runsPath = process.argv[2] ?? 'docs/graded-runs-unknownvocab.jsonl';

// Routing depends only on the question, so the fallback flag can be recovered
// without re-running retrieval. The pack shapes mirror what a device carries.
const PACKS: RoutablePack[] = [
  { id: 'core-firstaid', domains: ['first-aid-physical', 'first-aid-psychological'], scope: { kind: 'global' } },
  { id: 'core-firstaid-army', domains: ['first-aid-physical'], scope: { kind: 'global' } },
  { id: 'core-survival', domains: ['survival'], scope: { kind: 'global' } },
  { id: 'state-CA-flora-fauna', domains: ['plants', 'wildlife'], scope: { kind: 'us-state', state: 'CA' } },
];

const questions = new Map<string, GradedQuestion>(
  setsFor(process.env.EVAL_SET).flatMap((s) => loadGradedSet(s, (p) => readFileSync(p, 'utf8'))).map((q) => [q.id, q]),
);
const runs: GradedRun[] = readFileSync(runsPath, 'utf8')
  .split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as GradedRun);

interface Row { id: string; score: number; answerable: boolean }
const onFallback: Row[] = [];
const onNormal: Row[] = [];

for (const r of runs) {
  const q = questions.get(r.questionId);
  if (q === undefined) continue;
  const routed = route(extractKeywords(q.question), PACKS, { state: q.state });
  const row = { id: q.id, score: r.topScore, answerable: q.expect === 'answer' };
  (routed.fallback ? onFallback : onNormal).push(row);
}

function sweep(rows: readonly Row[], label: string): void {
  const yes = rows.filter((r) => r.answerable);
  const no = rows.filter((r) => !r.answerable);
  console.log(`\n=== ${label}: ${yes.length} answerable, ${no.length} out of scope ===`);
  if (yes.length === 0 || no.length === 0) { console.log('  not enough of both to fit'); return; }

  const candidates = [...new Set(rows.map((r) => Math.round(r.score * 1000) / 1000))].sort((a, b) => a - b);
  let best = { t: 0, correct: -1, kept: 0, blocked: 0 };
  console.log('  thresh   answerable kept   out-of-scope blocked   total');
  for (const t of candidates) {
    const kept = yes.filter((r) => r.score >= t).length;
    const blocked = no.filter((r) => r.score < t).length;
    const correct = kept + blocked;
    if (correct > best.correct) best = { t, correct, kept, blocked };
    console.log(`  ${t.toFixed(3)}      ${String(kept).padStart(2)}/${yes.length}              ${String(blocked).padStart(2)}/${no.length}            ${correct}/${rows.length}`);
  }
  console.log(`\n  best: ${best.t.toFixed(3)} keeps ${best.kept}/${yes.length} answerable, blocks ${best.blocked}/${no.length} out of scope`);
  // A threshold chosen on a handful of points is a guess with a decimal place.
  const margin = Math.min(...yes.filter((r) => r.score >= best.t).map((r) => r.score)) - best.t;
  console.log(`  margin to the nearest answerable question above it: ${margin.toFixed(3)}`);
}

sweep(onFallback, 'FALLBACK PATH (no vocabulary matched)');
sweep(onNormal, 'NORMAL PATH (vocabulary matched)');
