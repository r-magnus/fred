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
import { ask, verifyEmbedderParity, DEFAULT_RETRIEVAL } from '@fred/rag-core';
import { NodePackStore, createNodeBackend } from './node-pack.ts';
import { loadOnnxEmbedder } from '../../ingest/src/onnx-embed.ts';
import { loadGradedSet, describeSet, setsFor, type GradedQuestion, type GradedRun } from './graded-types.ts';


const outPath = process.argv[2] ?? 'docs/graded-runs.jsonl';

/**
 * TOPK overrides how many chunks reach the generator, so the distractor question
 * can be swept without editing rag-core. Three of the four graded "wrong passage"
 * failures had the right chunk at SOURCE 1 and were answered from SOURCE 4
 * (docs/results-akr2.md), which is a generation problem wearing a retrieval
 * costume — and the obvious thing to test is whether fewer sources fixes it.
 */
const topK = process.env.TOPK === undefined ? DEFAULT_RETRIEVAL.topK : Number(process.env.TOPK);
if (!Number.isInteger(topK) || topK < 1) throw new Error(`TOPK must be a positive integer, got ${process.env.TOPK}`);
const retrieval = { ...DEFAULT_RETRIEVAL, topK };

const questions: GradedQuestion[] = setsFor(process.env.EVAL_SET).flatMap((s) =>
  loadGradedSet(s, (p) => readFileSync(p, 'utf8')),
);
console.log(describeSet(questions));
const genModelPath = process.env.GEN_MODEL ?? `${process.env.HOME}/models/Qwen3-1.7B-Q4_K_M.gguf`;
// Printed because these two settings are what an A/B between runs is varying,
// and a results file that does not say which model produced it is not evidence.
console.log(`topK=${topK}  model=${genModelPath.split('/').pop()}`);

/**
 * PACKS_EXCLUDE=core-firstaid measures what the app loses without a pack — the
 * licensing question in HANDOFF.md, where WHO's NonCommercial terms block
 * commercial use. Comma-separated pack ids. An id that matches nothing is an
 * error, so a typo cannot pass for a result.
 */
const exclude = new Set((process.env.PACKS_EXCLUDE ?? '').split(',').map((s) => s.trim()).filter(Boolean));
const store = new NodePackStore();
const packDirs = readdirSync('packs')
  .map((d) => join('packs', d))
  .filter((d) => existsSync(join(d, 'manifest.json')));
const allIds = packDirs.map((d) => (JSON.parse(readFileSync(join(d, 'manifest.json'), 'utf8')) as { id: string }).id);
for (const id of exclude) {
  if (!allIds.includes(id)) throw new Error(`PACKS_EXCLUDE names ${id}, but packs/ holds ${allIds.join(', ')}`);
}
const manifests = packDirs.filter((_, i) => !exclude.has(allIds[i]!)).map((d) => store.load(d));
if (manifests.length === 0) throw new Error('no packs under packs/; run tools/ingest first');
if (exclude.size > 0) console.log(`excluding ${[...exclude].join(', ')}`);
const base = manifests[0]!;

// EMBED=onnx embeds queries with the ONNX encoder that ingest and the device
// use, for a machine that has it but not the GGUF. Not interchangeable for
// comparing runs: keep it the same on both sides of an A/B.
const onnx = process.env.EMBED === 'onnx';
console.log(`embedder=${onnx ? 'gte-small.onnx' : 'gte-small_fp16.gguf'}`);
const backend = await createNodeBackend({
  embedModelPath: `${process.env.HOME}/models/gte-small_fp16.gguf`,
  embedModelId: base.embedding.modelId,
  cosineFloor: base.embedding.cosineFloor,
  probe: base.embedding.probe,
  genModelPath,
  ...(onnx ? {
    embedder: await loadOnnxEmbedder(
      `${process.env.HOME}/models/gte-small.onnx`,
      `${process.env.HOME}/models/gte-small-vocab.txt`,
      base.embedding.modelId,
    ),
  } : {}),
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
  });

  let answer = '';
  if (res.kind === 'answer') {
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
