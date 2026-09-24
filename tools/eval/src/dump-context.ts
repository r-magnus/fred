/**
 * Re-run retrieval only, and record the passages each answer was built from.
 *
 *   EVAL_SET=holdout node tools/eval/src/dump-context.ts runs.jsonl out.jsonl
 *
 * Exists because the run files store citation *labels* — source, page, section
 * — and not passage text, so nothing downstream can check an answer against
 * what it was given. A grounding verifier needs the text.
 *
 * Retrieval is deterministic and runs before generation, so re-running it
 * reproduces the same passages without spending a generation pass: the whole
 * holdout set takes seconds rather than the ten minutes a full run costs.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ask, verifyEmbedderParity, DEFAULT_RETRIEVAL } from '@fred/rag-core';
import { NodePackStore, createNodeBackend } from './node-pack.ts';
import { loadGradedSet, setsFor, type GradedQuestion, type GradedRun } from './graded-types.ts';

const runsPath = process.argv[2] ?? 'docs/holdout-runs-norouter.jsonl';
const outPath = process.argv[3] ?? 'docs/holdout-context.jsonl';

const questions = new Map<string, GradedQuestion>(
  setsFor(process.env.EVAL_SET).flatMap((s) => loadGradedSet(s, (p) => readFileSync(p, 'utf8')))
    .map((q) => [q.id, q]),
);
const runs: GradedRun[] = readFileSync(runsPath, 'utf8')
  .split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as GradedRun);

const store = new NodePackStore();
const manifests = readdirSync('packs').map((d) => join('packs', d))
  .filter((d) => existsSync(join(d, 'manifest.json'))).map((d) => store.load(d));
const base = manifests[0]!;
const backend = await createNodeBackend({
  embedModelId: base.embedding.modelId,
  cosineFloor: base.embedding.cosineFloor,
  probe: base.embedding.probe,
  queryTemplate: base.embedding.queryTemplate,
});
for (const m of manifests) {
  const parity = await verifyEmbedderParity(m.embedding, backend);
  if (!parity.ok) throw new Error(`pack ${m.id}: embedder parity ${parity.cosine.toFixed(4)}`);
}
const packs = manifests.map((m) => ({ id: m.id, domains: m.domains, scope: m.scope }));

const out: string[] = [];
for (const r of runs) {
  const q = questions.get(r.questionId);
  if (q === undefined) throw new Error(`unknown question ${r.questionId}`);
  // maxTokens 1: this never generates, it only needs the retrieval half. The
  // backend has no generation model loaded at all, so an answer is impossible.
  const res = await ask(q.question, { backend, store, packs }, { state: q.state, retrieval: DEFAULT_RETRIEVAL });
  const passages = res.diagnostics.candidates
    .slice(0, DEFAULT_RETRIEVAL.topK)
    .map((c) => c.chunk.text);
  out.push(JSON.stringify({
    questionId: r.questionId, question: r.question, answer: r.answer,
    outcome: r.outcome, topScore: res.diagnostics.topScore, passages,
  }));
  process.stdout.write('.');
}
writeFileSync(outPath, `${out.join('\n')}\n`);
console.log(`\nwrote ${out.length} contexts to ${outPath}`);
