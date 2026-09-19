/**
 * Calibrate the abstention gate against the labelled set.
 *
 *   node tools/eval/src/calibrate.ts [runs.jsonl] [verdicts.json]
 *
 * DEFAULT_ABSTAIN_THRESHOLD has only ever been set by hand (0.35). This sweeps
 * it against questions labelled answerable and unanswerable, which is the thing
 * a hand-set threshold cannot be checked against: a set containing only
 * answerable questions measures accuracy but says nothing about where the gate
 * belongs, because it holds no case the gate should stop.
 *
 * Needs no API credentials. If `verdicts.json` from grade.ts is present it is
 * used to score an answered question as correct only when the judge accepted it;
 * otherwise answering an answerable question counts as correct on its own, which
 * is the weaker measurement and is labelled as such in the output.
 *
 * `needs-location` questions are excluded: that gate fires before retrieval
 * (pipeline.ts checks skippedStatePacks before scoring), so no threshold moves
 * them and including them would flatter every candidate equally.
 */
import { existsSync, readFileSync } from 'node:fs';
import { DEFAULT_ABSTAIN_THRESHOLD } from '@fred/rag-core';
import { loadGradedSet, loadVerdicts, setsFor, type GradedQuestion, type GradedRun } from './graded-types.ts';


const runsPath = process.argv[2] ?? 'docs/graded-runs.jsonl';
const verdictsPath = process.argv[3] ?? 'docs/graded-verdicts.json';

const questions = new Map<string, GradedQuestion>(
  setsFor(process.env.EVAL_SET).flatMap((s) => loadGradedSet(s, (p) => readFileSync(p, 'utf8'))).map((q) => [q.id, q]),
);
const runs: GradedRun[] = readFileSync(runsPath, 'utf8')
  .split('\n').filter((l) => l.trim() !== '')
  .map((l) => JSON.parse(l) as GradedRun);

let accepted: Set<string> | null = null;
if (existsSync(verdictsPath)) {
  const v = loadVerdicts(verdictsPath, (p) => readFileSync(p, 'utf8'), questions, runs);
  accepted = new Set(v.filter((x) => x.acceptable).map((x) => x.questionId));
  console.log(`using judge verdicts from ${verdictsPath}: an answer counts only if accepted\n`);
} else {
  console.log(`no ${verdictsPath}; scoring an answered question as correct without judging its content`);
  console.log('(run grade.ts for the real A-KR2 number — this sweep only locates the gate)\n');
}

interface Case {
  readonly id: string;
  /** True when the question has a real answer in the corpora. */
  readonly answerable: boolean;
  /** Fused score the gate compares against. */
  readonly topScore: number;
  /** Whether the produced answer was good, when a judge has said so. */
  readonly answerGood: boolean;
}

const cases: Case[] = [];
for (const r of runs) {
  const q = questions.get(r.questionId);
  if (!q) throw new Error(`run references unknown question ${r.questionId}`);
  if (q.expect === 'needs-location') continue;
  cases.push({
    id: q.id,
    answerable: q.expect === 'answer',
    topScore: r.topScore,
    answerGood: accepted === null ? true : accepted.has(q.id),
  });
}

const nAnswerable = cases.filter((c) => c.answerable).length;
const nUnanswerable = cases.length - nAnswerable;
console.log(`${cases.length} cases in the sweep: ${nAnswerable} answerable, ${nUnanswerable} not`);
console.log('(needs-location questions excluded: that gate fires before retrieval)\n');

interface Row {
  t: number;
  hit: number;      // answerable, answered, and good
  miss: number;     // answerable, gated off
  bad: number;      // answerable, answered, but the judge rejected it
  falseAns: number; // unanswerable, answered anyway
  decline: number;  // unanswerable, correctly declined
}

function evaluate(t: number): Row {
  const row: Row = { t, hit: 0, miss: 0, bad: 0, falseAns: 0, decline: 0 };
  for (const c of cases) {
    const wouldAnswer = c.topScore >= t;
    if (c.answerable) {
      if (!wouldAnswer) row.miss++;
      else if (c.answerGood) row.hit++;
      else row.bad++;
    } else if (wouldAnswer) row.falseAns++;
    else row.decline++;
  }
  return row;
}

/** Candidate thresholds: every observed score, so no boundary is missed. */
const candidates = [...new Set([
  ...cases.map((c) => Number(c.topScore.toFixed(4))),
  DEFAULT_ABSTAIN_THRESHOLD,
])].sort((a, b) => a - b);

const rows = candidates.map(evaluate);

console.log('    gate | hit  miss  bad | false  decline |  recall  specificity  Youden J');
console.log('  -------+----------------+----------------+----------------------------------');
for (const r of rows) {
  const recall = nAnswerable === 0 ? 0 : r.hit / nAnswerable;
  const spec = nUnanswerable === 0 ? 0 : r.decline / nUnanswerable;
  const j = recall + spec - 1;
  const mark = Math.abs(r.t - DEFAULT_ABSTAIN_THRESHOLD) < 1e-9 ? ' <- current' : '';
  console.log(
    `  ${r.t.toFixed(4).padStart(6)} | ${String(r.hit).padStart(3)} ${String(r.miss).padStart(5)} ` +
    `${String(r.bad).padStart(5)} | ${String(r.falseAns).padStart(5)} ${String(r.decline).padStart(8)} ` +
    `|  ${recall.toFixed(3)}      ${spec.toFixed(3)}      ${j.toFixed(3)}${mark}`,
  );
}

function scoreJ(r: Row): number {
  const recall = nAnswerable === 0 ? 0 : r.hit / nAnswerable;
  const spec = nUnanswerable === 0 ? 0 : r.decline / nUnanswerable;
  return recall + spec - 1;
}

const best = rows.reduce((a, b) => (scoreJ(b) > scoreJ(a) ? b : a));
// Lowest gate that lets nothing unanswerable through — the conservative choice
// for a first-aid app, where a confident answer to an uncovered question is
// worse than a decline the user can act around.
const noFalse = rows.filter((r) => r.falseAns === 0).sort((a, b) => a.t - b.t)[0];
const current = evaluate(DEFAULT_ABSTAIN_THRESHOLD);

console.log(`\ncurrent gate ${DEFAULT_ABSTAIN_THRESHOLD}: ` +
  `hit ${current.hit}/${nAnswerable}, false answers ${current.falseAns}/${nUnanswerable}, J=${scoreJ(current).toFixed(3)}`);
console.log(`best Youden J at ${best.t.toFixed(4)}: ` +
  `hit ${best.hit}/${nAnswerable}, false answers ${best.falseAns}/${nUnanswerable}, J=${scoreJ(best).toFixed(3)}`);
if (noFalse) {
  console.log(`lowest gate with zero false answers: ${noFalse.t.toFixed(4)} ` +
    `(keeps ${noFalse.hit}/${nAnswerable} answerable questions)`);
} else {
  console.log('no threshold eliminates false answers: some unanswerable question outscores every answerable one');
}

if (accepted === null) {
  console.log('\nNOTE: no judge verdicts, so "hit" means answered, not answered well.');
  console.log('The gate located here is an upper bound on what it can deliver.');
}
