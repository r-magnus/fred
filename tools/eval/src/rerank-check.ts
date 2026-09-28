/**
 * Would a cross-encoder reranker put the right passage higher? Judged with no
 * generation (docs/results-noise-research.md, option 2).
 *
 *   RERANKER=~/models/bge-reranker-v2-m3-Q4_K_M.gguf node tools/eval/src/rerank-check.ts [pool]
 *
 * Without RERANKER it reports the search alone, which is how a pack change
 * (PACKS_DIR) is judged: the same questions, before and after.
 *
 * For every answerable tuning and held-out question with a known source
 * passage (`cite.quote`), take the search's top `pool` (default 20), rerank
 * them, and report where the source passage lands before and after.
 */
import { readFileSync } from 'node:fs';
import { getLlama } from 'node-llama-cpp';
import { ask } from '@fred/rag-core';
import { openHarness } from './harness.ts';
import { loadGradedSet, setsFor } from './graded-types.ts';
import { askOptionsFromEnv } from './retrieval-env.ts';

const pool = Number(process.argv[2] ?? 20);
const modelPath = (process.env.RERANKER ?? '').replace(/^~/, process.env.HOME ?? '');
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ');

const questions = setsFor('all').flatMap((f) => loadGradedSet(f, (p) => readFileSync(p, 'utf8')))
  .filter((q) => q.expect === 'answer' && q.cite?.quote);
const harness = await openHarness();
const opts = askOptionsFromEnv();
const ranker = modelPath === '' ? null
  : await (await (await getLlama()).loadModel({ modelPath })).createRankingContext();

const before: (number | null)[] = [];
const after: (number | null)[] = [];
let ms = 0;
for (const q of questions) {
  const res = await ask(q.question, harness, {
    ...opts, state: q.state, abstainThreshold: 0,
    retrieval: { ...opts.retrieval!, topK: pool },
  });
  const cands = res.diagnostics.candidates;
  const key = norm(q.cite!.quote).slice(0, 60);
  const isRight = (text: string): boolean => norm(text).includes(key);
  before.push(cands.findIndex((c) => isRight(c.chunk.text)));
  if (ranker === null) { after.push(before.at(-1)!); process.stdout.write('.'); continue; }
  const t0 = Date.now();
  const scores = await ranker.rankAll(q.question, cands.map((c) => c.chunk.text));
  ms += Date.now() - t0;
  const order = scores.map((s, i) => [s, i] as const).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
  after.push(order.findIndex((i) => isRight(cands[i]!.chunk.text)));
  process.stdout.write('.');
}
const at = (ranks: (number | null)[], k: number): string =>
  `${ranks.filter((r) => r !== null && r >= 0 && r < k).length}`;
console.log(`\n${questions.length} questions, pool ${pool}, ${modelPath.split('/').pop() || 'search only'}, ${Math.round(ms / questions.length)} ms per question`);
for (const k of [1, 2, 3, 4]) console.log(`right passage in top ${k}: search ${at(before, k)}  reranked ${at(after, k)}`);
console.log(`in the pool at all: ${at(before, pool)}`);
const moved = before.map((b, i) => [b, after[i]] as const);
console.log(`moved up: ${moved.filter(([b, a]) => a! >= 0 && (b! < 0 || a! < b!)).length}  moved down: ${moved.filter(([b, a]) => b! >= 0 && a! > b!).length}`);
await harness.close();
