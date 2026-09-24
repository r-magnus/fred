/**
 * Layer 1 of the A-KR2 measurement: does the answer's source passage reach the
 * model at all?
 *
 *   node tools/eval/src/search-check.ts [out.json]
 *   EVAL_SET=holdout node tools/eval/src/search-check.ts   # rarely; see results-holdout.md
 *
 * For every answerable question with a `cite.quote`, this runs the real
 * pipeline up to the prompt and reports where the source passage was lost:
 *
 *   in corpus    the quote exists in some loaded pack (else the answer sheet
 *                cites text Fred does not have, and that is a data problem)
 *   top 50       search ranked it somewhere in the candidate pool
 *   top 4        it was among the passages handed to the generator
 *   in prompt    it survived compression and the model actually read it
 *
 * No generation and no grader, so a full run takes seconds and can gate every
 * retrieval change. It is not a substitute for the graded read: a passage in
 * the prompt is necessary for a correct answer, not sufficient
 * (docs/results-strategy-research.md §1i, where the model still misread 12 of
 * 18 answers it was handed the right passage for).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ask, verifyEmbedderParity, DEFAULT_RETRIEVAL, type AskResult } from '@fred/rag-core';
import { NodePackStore, createNodeBackend } from './node-pack.ts';
import { loadGradedSet, setsFor, type GradedQuestion } from './graded-types.ts';
import { retrievalFromEnv, describeRetrieval, compressionFromEnv } from './retrieval-env.ts';
import { containsGold, goldWindows, normalise, prohibitionPhrases } from './gold.ts';

const outPath = process.argv[2];
const DEEP_K = 50;
const retrieval = retrievalFromEnv();
const compression = compressionFromEnv();
console.log(`${describeRetrieval(retrieval)} compress=${compression === undefined ? 'off' : 'on'}`);

const questions = setsFor(process.env.EVAL_SET)
  .flatMap((s) => loadGradedSet(s, (p) => readFileSync(p, 'utf8')))
  .filter((q) => q.expect === 'answer');
const cited = questions.filter((q) => q.cite !== undefined && q.cite.quote.trim() !== '');

const store = new NodePackStore();
const PACKS = process.env.PACKS_DIR ?? 'packs';
const packDirs = readdirSync(PACKS).map((d) => join(PACKS, d)).filter((d) => existsSync(join(d, 'manifest.json')));
const manifests = packDirs.map((d) => store.load(d));
if (manifests.length === 0) throw new Error(`no packs under ${PACKS}/; run tools/ingest first`);
const base = manifests[0]!;

const backend = await createNodeBackend({
  embedModelId: base.embedding.modelId,
  cosineFloor: base.embedding.cosineFloor,
  probe: base.embedding.probe,
  queryTemplate: base.embedding.queryTemplate,
  // Loaded for its tokenizer only: compression budgets in generator tokens,
  // and counting with the embedder's vocabulary would trim a different amount
  // than the phone does.
  genModelPath: process.env.GEN_MODEL ?? `${process.env.HOME}/models/Qwen3-1.7B-Q4_K_M.gguf`,
});
for (const m of manifests) {
  const parity = await verifyEmbedderParity(m.embedding, backend);
  if (!parity.ok) throw new Error(`pack ${m.id}: embedder parity ${parity.cosine.toFixed(4)}`);
}
const packs = manifests.map((m) => ({ id: m.id, domains: m.domains, scope: m.scope }));

/** Normalised chunk text per pack, loaded on first use: 185k chunks is too many to read eagerly. */
const corpusCache = new Map<string, string[]>();
function packText(dir: string): string[] {
  let rows = corpusCache.get(dir);
  if (rows === undefined) {
    const db = new DatabaseSync(join(dir, 'chunks.sqlite'), { readOnly: true });
    rows = (db.prepare('SELECT text FROM chunks').all() as { text: string }[]).map((r) => normalise(r.text));
    db.close();
    corpusCache.set(dir, rows);
  }
  return rows;
}
/** Only the packs this question could draw on: every global pack, plus its own state. */
function inCorpus(q: GradedQuestion, windows: readonly string[]): boolean {
  const dirs = packDirs.filter((d, i) => {
    const scope = manifests[i]!.scope;
    return scope.kind === 'global' || (q.state !== null && d.includes(`state-${q.state}-`));
  });
  return dirs.some((d) => packText(d).some((t) => windows.some((w) => t.includes(w))));
}

interface Row {
  readonly id: string;
  readonly outcome: AskResult['kind'];
  readonly inCorpus: boolean;
  readonly rank: number | null;
  readonly inTop4: boolean;
  readonly inPrompt: boolean;
  readonly negationLinesDropped: number;
  readonly tokensBefore: number;
  readonly tokensAfter: number;
}

const rows: Row[] = [];
let negationQuestions = 0;
for (const q of cited) {
  const windows = goldWindows(q.cite!.quote);
  const deep = await ask(q.question, { backend, store, packs }, {
    state: q.state, retrieval: { ...retrieval, topK: DEEP_K },
  });
  const rankIdx = deep.diagnostics.candidates.findIndex((c) => containsGold(c.chunk.text, windows));
  const res = await ask(q.question, { backend, store, packs }, { state: q.state, retrieval, ...(compression ? { compression } : {}) });
  const top = res.diagnostics.candidates.slice(0, retrieval.topK);
  const prompt = res.kind === 'answer' ? res.prompt.user : '';

  // Prohibitions in the retrieved text ("do not massage the") that did not
  // reach the model intact. Checked as phrases, not page lines: a phrase that
  // lost its "do not" reads as an instruction, which is the failure that matters.
  let dropped = 0;
  if (res.kind === 'answer') {
    const p = normalise(prompt);
    for (const c of top) {
      for (const phrase of prohibitionPhrases(c.chunk.text)) if (!p.includes(phrase)) dropped++;
    }
    if (dropped > 0) negationQuestions++;
  }

  rows.push({
    id: q.id,
    outcome: res.kind,
    inCorpus: inCorpus(q, windows),
    rank: rankIdx < 0 ? null : rankIdx + 1,
    inTop4: top.some((c) => containsGold(c.chunk.text, windows)),
    inPrompt: res.kind === 'answer' && containsGold(prompt, windows),
    negationLinesDropped: dropped,
    tokensBefore: res.diagnostics.tokensBefore,
    tokensAfter: res.diagnostics.tokensAfter,
  });
  process.stdout.write('.');
}

const n = rows.length;
const pct = (k: number) => `${k}/${n} (${Math.round((100 * k) / n)}%)`;
const within = (k: number) => rows.filter((r) => r.rank !== null && r.rank <= k).length;
const answered = rows.filter((r) => r.outcome === 'answer').length;

console.log(`\n\nSearch check — ${n} answerable questions with a cite (of ${questions.length} answerable)\n`);
console.log(`  source passage exists in corpus   ${pct(rows.filter((r) => r.inCorpus).length)}`);
console.log(`  ranked in top ${DEEP_K}                  ${pct(within(DEEP_K))}`);
console.log(`  ranked in top 10                  ${pct(within(10))}`);
console.log(`  handed to the model (top ${retrieval.topK})       ${pct(rows.filter((r) => r.inTop4).length)}`);
console.log(`  survived trimming (in prompt)     ${pct(rows.filter((r) => r.inPrompt).length)}`);
const ans = rows.filter((r) => r.outcome === 'answer');
const mean = (f: (r: Row) => number) => Math.round(ans.reduce((a, r) => a + f(r), 0) / Math.max(1, ans.length));
console.log(`\n  context tokens per answer, mean   ${mean((r) => r.tokensBefore)} retrieved -> ${mean((r) => r.tokensAfter)} after trimming`);
console.log(`  answered questions where trimming broke a do-not/never/avoid phrase: ${negationQuestions}/${answered}`);

const missing = rows.filter((r) => !r.inPrompt);
console.log(`\nNot in the prompt (${missing.length}):`);
for (const r of missing) {
  const where = !r.inCorpus ? 'NOT IN CORPUS'
    : r.rank === null ? `not in top ${DEEP_K}`
      : !r.inTop4 ? `ranked ${r.rank}`
        : r.outcome !== 'answer' ? `pipeline ${r.outcome}`
          : 'cut by trimming';
  console.log(`  ${r.id.padEnd(28)} ${where}`);
}

if (outPath !== undefined) {
  writeFileSync(outPath, `${JSON.stringify({ evalSet: process.env.EVAL_SET ?? 'tuning', n, rows }, null, 1)}\n`);
  console.log(`\nwrote ${outPath}`);
}
await backend.dispose();
store.close();
