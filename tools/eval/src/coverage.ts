/**
 * A-KR1 check: does each proposal question reach the material that should answer it?
 *
 *   node tools/eval/src/coverage.ts
 *
 * Retrieval and routing only, no generation. A-KR1 reads "when asked a
 * corpora-relevant question, Fred uses RAG on the proper material", which is a
 * property of routing and ranking; whether the answer is right is A-KR2. The
 * questions are the proposal's acceptance criteria, worded as written, so this
 * measures the stories rather than questions picked to suit the corpus.
 *
 * "Proper material" is judged by the top chunk's own domain, not its pack: the
 * survival manual's medical chapter is first-aid material that happens to ship
 * in core-survival.
 *
 * `expect: null` marks a question no shipped pack covers yet. The correct outcome
 * for those is to decline (abstain or ask for a location), not to answer from
 * whichever pack happens to share a word with the question.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DomainTag } from '@fred/pack-format';
import { ask, verifyEmbedderParity } from '@fred/rag-core';
import { NodePackStore, createNodeBackend } from './node-pack.ts';

interface Probe {
  readonly story: string;
  readonly query: string;
  readonly state: string | null;
  /**
   * Domain(s) the top chunk may belong to, or null when the right outcome is to
   * decline: no pack covers it, or it needs a location that was not given.
   */
  readonly expect: DomainTag | readonly DomainTag[] | null;
}

const PROBES: readonly Probe[] = [
  { story: 'US-02-AC1', query: 'I cut myself on a branch, what should I do?', state: null, expect: 'first-aid-physical' },
  { story: 'US-08-AC1', query: 'I have no idea how to start a fire! I have matches, a knife and some dry grass.', state: null, expect: 'survival' },
  { story: 'US-08-AC2', query: 'I have a cooler with some sandwiches and breakfast sausages in it, can animals get in?', state: 'CA', expect: ['wildlife', 'survival'] },
  { story: 'US-12-AC1', query: 'How do I build a shelter?', state: null, expect: 'survival' },
  { story: 'US-01-AC1', query: 'What plants and animals are near me?', state: 'OR', expect: ['plants', 'wildlife'] },
  { story: 'US-01 (CA)', query: 'Are there mountain lions around here, and what do they eat?', state: 'CA', expect: 'wildlife' },
  { story: 'Figure 2', query: 'What does poison oak look like, and how do I treat the rash?', state: 'CA', expect: 'plants' },
  // Without a location a state-scoped question must ask for one, not guess.
  { story: 'no location', query: 'What does poison oak look like?', state: null, expect: null },
  { story: 'Problem', query: 'My friend badly twisted their ankle on the trail, what should we do?', state: null, expect: 'first-aid-physical' },
  { story: 'survival', query: 'How do I make water from a stream safe to drink?', state: null, expect: 'survival' },
  { story: 'survival', query: 'How can I find north without a compass?', state: null, expect: 'survival' },
  { story: 'survival', query: 'How do I tie a knot to secure a tarp to a tree?', state: null, expect: 'survival' },
  { story: 'first aid', query: 'How do I control severe external bleeding?', state: null, expect: 'first-aid-physical' },
  { story: 'first aid', query: 'Someone is unconscious but breathing, what position do I put them in?', state: null, expect: 'first-aid-physical' },
  { story: 'first aid', query: 'A rattlesnake bit my leg, what do I do?', state: null, expect: 'first-aid-physical' },
  { story: 'first aid', query: 'What are the signs of heat exhaustion and how do I treat it?', state: null, expect: 'first-aid-physical' },
  { story: 'first aid', query: 'How do I splint a broken arm with sticks?', state: null, expect: 'first-aid-physical' },
];

const store = new NodePackStore();
const manifests = readdirSync('packs')
  .map((d) => join('packs', d))
  .filter((d) => existsSync(join(d, 'manifest.json')))
  .map((d) => store.load(d));
if (manifests.length === 0) throw new Error('no packs under packs/; run tools/ingest first');
const base = manifests[0]!;

const backend = await createNodeBackend({
  embedModelId: base.embedding.modelId,
  cosineFloor: base.embedding.cosineFloor,
  probe: base.embedding.probe,
  queryTemplate: base.embedding.queryTemplate,
});

for (const m of manifests) {
  const parity = await verifyEmbedderParity(m.embedding, backend);
  console.log(`pack ${m.id} v${m.version}: ${m.chunkCount} chunks, domains ${m.domains.join(',')}, ` +
    `parity ${parity.ok ? 'OK' : 'MISMATCH'} cos=${parity.cosine.toFixed(4)}`);
}
console.log();

const packs = manifests.map((m) => ({ id: m.id, domains: m.domains, scope: m.scope }));
const rows: string[] = [];
let passed = 0;

for (const p of PROBES) {
  const res = await ask(p.query, { backend, store, packs }, { state: p.state });
  const top = res.kind === 'answer' ? res.diagnostics.candidates[0]?.chunk : undefined;
  const allowed: readonly DomainTag[] | null = p.expect === null ? null : typeof p.expect === 'string' ? [p.expect] : p.expect;
  const ok = allowed === null ? res.kind !== 'answer' : top !== undefined && allowed.includes(top.domain);
  if (ok) passed++;

  const d = res.diagnostics;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${p.story}: ${p.query}`);
  console.log(`     route: ${d.route.reason} -> [${d.route.packIds.join(', ')}]  outcome: ${res.kind}  top U=${d.topScore.toFixed(3)}`);
  for (const c of d.candidates.slice(0, 3)) {
    console.log(`     U=${c.score.toFixed(3)} ${c.chunk.packId} p.${c.chunk.page} [${c.chunk.domain}] ${c.chunk.section.slice(0, 40)}`);
    console.log(`       ${c.chunk.text.replace(/\s+/g, ' ').slice(0, 120)}...`);
  }
  console.log();

  const where = top ? `${top.source}${top.page === null ? '' : ` p.${top.page}`} — ${top.section.slice(0, 40)}` : '—';
  rows.push(`| ${p.story} | ${p.query} | ${allowed?.join(' / ') ?? '(decline)'} | ${res.kind} | ${where} | ${ok ? '✅' : '❌'} |`);
}

console.log('| story | question | expected | outcome | top citation | pass |');
console.log('|---|---|---|---|---|:---:|');
for (const r of rows) console.log(r);
console.log(`\n${passed}/${PROBES.length} passed`);

await backend.dispose();
store.close();
