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
import { loadGradedSet, describeSet, GRADED_SETS, type GradedQuestion, type GradedRun } from './graded-types.ts';


const outPath = process.argv[2] ?? 'docs/graded-runs.jsonl';

const questions: GradedQuestion[] = GRADED_SETS.flatMap((s) =>
  loadGradedSet(s, (p) => readFileSync(p, 'utf8')),
);
console.log(describeSet(questions));

const store = new NodePackStore();
const manifests = readdirSync('packs')
  .map((d) => join('packs', d))
  .filter((d) => existsSync(join(d, 'manifest.json')))
  .map((d) => store.load(d));
if (manifests.length === 0) throw new Error('no packs under packs/; run tools/ingest first');
const base = manifests[0]!;

const backend = await createNodeBackend({
  embedModelPath: `${process.env.HOME}/models/gte-small_fp16.gguf`,
  embedModelId: base.embedding.modelId,
  cosineFloor: base.embedding.cosineFloor,
  probe: base.embedding.probe,
  genModelPath: process.env.GEN_MODEL ?? `${process.env.HOME}/models/Qwen3-0.6B-Q4_K_M.gguf`,
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
  const res = await ask(q.question, { backend, store, packs }, { state: q.state });

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
