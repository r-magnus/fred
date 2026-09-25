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
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ask, verifyEmbedderParity } from '@fred/rag-core';
import { NodePackStore, createNodeBackend } from './node-pack.ts';
import { loadGradedSet, describeSet, setsFor, type GradedQuestion, type GradedRun } from './graded-types.ts';
import { compressionFromEnv, describeRetrieval, retrievalFromEnv } from './retrieval-env.ts';


const outPath = process.argv[2] ?? 'docs/graded-runs.jsonl';

// Retrieval and compression settings come from the environment (TOPK,
// RETRIEVAL_QUERY, DENSE_POOL, COMPRESS); see retrieval-env.ts. TOPK used to be
// read here, so a comparison of how many chunks reach the generator still works.
const retrieval = retrievalFromEnv();
const PACKS = process.env.PACKS_DIR ?? 'packs';
const compression = compressionFromEnv();

const questions: GradedQuestion[] = setsFor(process.env.EVAL_SET).flatMap((s) =>
  loadGradedSet(s, (p) => readFileSync(p, 'utf8')),
);
console.log(describeSet(questions));
const genModelPath = process.env.GEN_MODEL ?? `${process.env.HOME}/models/Qwen3-1.7B-Q4_K_M.gguf`;
// Printed because these two settings are what an A/B between runs is varying,
// and a results file that does not say which model produced it is not evidence.
console.log(`${describeRetrieval(retrieval)} compress=${compression === undefined ? 'off' : 'on'}  model=${genModelPath.split('/').pop()}  packs=${PACKS}`);

const store = new NodePackStore();
const manifests = readdirSync(PACKS)
  .map((d) => join(PACKS, d))
  .filter((d) => existsSync(join(d, 'manifest.json')))
  .map((d) => store.load(d));
if (manifests.length === 0) throw new Error('no packs under packs/; run tools/ingest first');
const base = manifests[0]!;

const backend = await createNodeBackend({
  embedModelId: base.embedding.modelId,
  cosineFloor: base.embedding.cosineFloor,
  probe: base.embedding.probe,
  queryTemplate: base.embedding.queryTemplate,
  genModelPath,
});

// A parity failure invalidates every number below it, so check before spending
// an hour of generation rather than discovering it in the results.
for (const m of manifests) {
  const parity = await verifyEmbedderParity(m.embedding, backend);
  if (!parity.ok) {
    throw new Error(`pack ${m.id}: embedder parity ${parity.cosine.toFixed(4)}, refusing to run`);
  }
}
console.log(`${manifests.length} packs, embedder parity OK\n`);

const packs = manifests.map((m) => ({ id: m.id, domains: m.domains, scope: m.scope }));
const runs: GradedRun[] = [];

for (const [i, q] of questions.entries()) {
  const t0 = Date.now();
  const res = await ask(q.question, { backend, store, packs }, {
    state: q.state, retrieval,
    ...(compression === undefined ? {} : { compression }),
    // ABSTAIN_THRESHOLD overrides the decline gate; 0 lets every question
    // through, which is what calibrate.ts needs to see the score distribution.
    ...(process.env.ABSTAIN_THRESHOLD !== undefined ? { abstainThreshold: Number(process.env.ABSTAIN_THRESHOLD), fallbackThreshold: Number(process.env.ABSTAIN_THRESHOLD) } : {}),
    // ROUTING_FALLBACK=1 measures what searching everything on a no-match
    // recovers. Off by default so a plain run reflects what ships.
    ...(process.env.ROUTING_FALLBACK === '1' ? { allowRoutingFallback: true } : {}),
    ...(process.env.FALLBACK_THRESHOLD !== undefined
      ? { fallbackThreshold: Number(process.env.FALLBACK_THRESHOLD) } : {}),
    // SUFFICIENCY=1 asks the model whether the retrieved passages answer the
    // question before generating. Off by default until it has earned its cost.
    ...(process.env.SUFFICIENCY === '1' ? { checkSufficiency: true } : {}),
    // SUFFICIENCY_PROMPT=numeric swaps in the wording that makes "a question
    // asking for a quantity needs the quantity present" an explicit rule. The
    // default wording is 0 of 3 on dosing questions.
    ...(process.env.SUFFICIENCY_PROMPT === 'numeric'
      ? { sufficiencyVariant: 'numeric' as const } : {}),
    // ANSWER_SHAPE=lead adds "give the thing the question asks for, first".
    ...(process.env.ANSWER_SHAPE === 'lead' ? { answerVariant: 'lead' as const } : {}),
  });

  let answer = '';
  // GENERATE=0 records retrieval and the gate's decision without spending a
  // generation pass: enough for calibrate.ts, seconds instead of twenty minutes.
  if (res.kind === 'answer' && process.env.GENERATE !== '0') {
    for await (const tok of res.stream) answer += tok;
  }
  const latencyMs = Date.now() - t0;
  const d = res.diagnostics;

  const run: GradedRun = {
    questionId: q.id,
    question: q.question,
    outcome: res.kind,
    answer: answer.trim(),
    topScore: d.topScore,
    topDomain: d.candidates[0]?.chunk.domain ?? null,
    citations: res.kind === 'answer'
      ? res.citations.map((c) => `${c.source}${c.page === null ? '' : ` p.${c.page}`} — ${c.section}`)
      : [],
    latencyMs,
    promptTokens: d.tokensAfter,
    ...(res.kind === 'abstain' ? { abstainReason: res.reason } : {}),
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

await backend.dispose();
store.close();
