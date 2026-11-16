/**
 * Run the graded eval set through the real pipeline and record the answers.
 *
 *   node tools/eval/src/run-graded.ts [out.jsonl]
 *
 * Deliberately split from grading. This half needs no API credentials and is
 * reproducible offline; `grade.ts` consumes its output. Separating them also
 * means a judge re-run costs nothing on the device side, and that the same
 * answers can be re-graded if the rubric changes.
 *
 * Unlike run.ts, this drives `ask()` end to end and keeps the generated prose.
 * That is the point: the MCQ harness constrains output to one letter, so it
 * cannot see an answer that names every correct step and also invents one.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { ask } from '@fred/rag-core';
import { openHarness } from './harness.ts';
import { loadGradedSet, describeSet, setsFor, type GradedQuestion, type GradedRun } from './graded-types.ts';
import { askOptionsFromEnv } from './retrieval-env.ts';


const outPath = process.argv[2] ?? 'docs/graded-runs.jsonl';

// EVAL_IDS=a,b runs only those questions, e.g. the ones a decision sweep saw change.
const questions: GradedQuestion[] = setsFor(process.env.EVAL_SET).flatMap((s) =>
  loadGradedSet(s, (p) => readFileSync(p, 'utf8')),
).filter((q) => process.env.EVAL_IDS === undefined || process.env.EVAL_IDS.split(',').includes(q.id));
console.log(describeSet(questions));
const harness = await openHarness();
const { backend, store, packs } = harness;
const askOptions = askOptionsFromEnv();
// STATE=CA asks every question that sets no state of its own as if the hiker
// were in California, as the phone does once it has a location. The sets were
// run with no state until #96's phone check, which hid routing that only
// fails with a state set.
const defaultState = process.env.STATE ?? null;
const runs: GradedRun[] = [];

for (const [i, q] of questions.entries()) {
  const t0 = Date.now();
  const res = await ask(q.question, { backend, store, packs }, { ...askOptions, state: q.state ?? defaultState });

  let answer = '';
  // GENERATE=0 records retrieval and the gate's decision without spending a
  // generation pass: enough for calibrate.ts, seconds instead of twenty minutes.
  // Card lines (#109) are fixed text: read them even under GENERATE=0.
  if (res.kind === 'answer' && (process.env.GENERATE !== '0' || res.card !== undefined)) {
    for await (const tok of res.stream) answer += tok;
  }
  // #130: the opening line is recorded apart, so the answer compares word for word.
  const opener = res.kind === 'answer' ? res.opener?.text ?? undefined : undefined;
  if (opener != null && answer.startsWith(`${opener}\n`)) answer = answer.slice(opener.length + 1);
  const latencyMs = Date.now() - t0;
  const d = res.diagnostics;

  const run: GradedRun = {
    questionId: q.id,
    question: q.question,
    outcome: res.kind,
    answer: answer.trim(),
    ...(opener == null ? {} : { opener }),
    topScore: d.topScore,
    topDomain: d.candidates[0]?.chunk.domain ?? null,
    citations: res.kind === 'answer'
      ? res.citations.map((c) => `${c.source}${c.page === null ? '' : ` p.${c.page}`} — ${c.section}`)
      : [],
    latencyMs,
    promptTokens: d.tokensAfter,
    ...(res.kind === 'abstain' ? { abstainReason: res.reason } : {}),
    ...(d.cardAnswer !== undefined ? { cardAnswer: d.cardAnswer } : {}),
    ...((res.kind === 'abstain' || res.kind === 'chat') && res.offer != null ? { offer: res.offer.title } : {}),
    ...(res.kind === 'answer' && res.card !== undefined ? { offer: res.card.title } : {}),
    ...(d.secondSearch !== undefined ? { secondSearch: d.secondSearch } : {}),
    ...(d.deep !== undefined ? { deep: d.deep } : {}),
    ...(d.widenedTopScore !== undefined ? { widenedTopScore: d.widenedTopScore } : {}),
    ...(d.understood !== undefined ? { understood: d.understood } : {}),
    ...(d.scope !== undefined ? { scope: d.scope } : {}),
    ...(d.said !== undefined ? { said: d.said } : {}),
    ...(d.everyday !== undefined ? { everyday: d.everyday } : {}),
    ...(d.answerGuard?.refused === true ? { modelRefused: true } : {}),
    ...(d.nearSentence === undefined ? {} : { nearSentence: { similarity: Number(d.nearSentence.similarity.toFixed(3)), text: d.nearSentence.text } }),
    ...(d.answerGuard?.replacedBy !== undefined ? { guardedBy: d.answerGuard.replacedBy } : {}),
    retrieved: d.candidates.map((c) => ({ packId: c.chunk.packId, chunkId: c.chunk.id, section: c.chunk.section, score: Number(c.score.toFixed(4)) })),
  };
  runs.push(run);

  const mark = res.kind === q.expect ? 'ok ' : 'DIFF';
  console.log(
    `[${String(i + 1).padStart(3)}/${questions.length}] ${mark} ${q.id.padEnd(22)} ` +
    `expect=${q.expect.padEnd(14)} got=${res.kind.padEnd(14)} U=${d.topScore.toFixed(3)} ${latencyMs}ms`,
  );
}

writeFileSync(outPath, runs.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`\nwrote ${runs.length} runs to ${outPath}`);

// Outcome agreement is not accuracy — it says whether the pipeline routed and
// gated correctly, before any judgement of what the prose actually says.
const agree = runs.filter((r, i) => r.outcome === questions[i]!.expect).length;
console.log(`outcome matches expectation: ${agree}/${runs.length}`);

const answered = runs.filter((r) => r.outcome === 'answer');
if (answered.length > 0) {
  const lat = [...answered].map((r) => r.latencyMs).sort((a, b) => a - b);
  const mean = Math.round(lat.reduce((a, b) => a + b, 0) / lat.length);
  console.log(`answered: ${answered.length}  latency mean ${mean}ms  p95 ${lat[Math.floor(lat.length * 0.95)]}ms`);
}

await harness.close();
