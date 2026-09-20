import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChunkRecord } from '@fred/pack-format';
import { ask, maxTokensForPressure, DEFAULT_ABSTAIN_THRESHOLD } from '../src/pipeline.ts';
import { assertCompatibleEmbedding, retrieve, DEFAULT_RETRIEVAL } from '../src/retrieve.ts';
import { route } from '../src/router.ts';
import { extractKeywords } from '../src/lexicon.ts';
import { SYSTEM_PREFIX } from '../src/prompt.ts';
import { FakeBackend, FakePackStore, FAKE_SPEC } from './fakes.ts';

type Seed = Omit<ChunkRecord, 'id' | 'packId' | 'ordinal'>;
const seed = (text: string, over: Partial<Seed> = {}): Seed => ({
  text, context: '', section: 'sec', source: 'WHO BEC 2018', page: 10,
  domain: 'first-aid-physical', licenseId: 'who-bec', blockKind: 'prose', ...over,
});

const PACKS = [
  { id: 'core-firstaid', domains: ['first-aid-physical'] as const, scope: { kind: 'global' } as const },
  { id: 'core-survival', domains: ['survival'] as const, scope: { kind: 'global' } as const },
  { id: 'state-CO-wildlife', domains: ['wildlife'] as const, scope: { kind: 'us-state', state: 'CO' } as const },
];

function buildStore(): FakePackStore {
  const store = new FakePackStore();
  store.addPack('core-firstaid', [
    seed('Control severe bleeding with firm direct pressure on the wound.'),
    seed('Shock presents with cool clammy skin and a weak rapid pulse.'),
  ]);
  store.addPack('core-survival', [
    seed('Build a fire using dry tinder and progressively larger kindling.', { domain: 'survival', source: 'FM 21-76', licenseId: 'fm-21-76' }),
  ]);
  store.addPack('state-CO-wildlife', [
    seed('Black bear encounters: make yourself large, speak calmly, do not run.', { domain: 'wildlife', source: 'FEIS', licenseId: 'feis' }),
  ]);
  return store;
}

const deps = () => ({ backend: new FakeBackend(), store: buildStore(), packs: PACKS });

test('a well-supported first-aid query produces a cited answer', async () => {
  const d = deps();
  const res = await ask('How do I control severe bleeding from a wound?', d, { state: 'CO' });
  assert.equal(res.kind, 'answer');
  if (res.kind !== 'answer') return;
  assert.ok(res.citations.length > 0);
  assert.equal(res.citations[0]!.source, 'WHO BEC 2018');
  assert.equal(res.medical, true, 'first-aid answers must be flagged medical');
  let out = '';
  for await (const t of res.stream) out += t;
  assert.equal(out, 'FAKE ANSWER');
});

test('the generated prompt starts with the cacheable system prefix verbatim', async () => {
  const d = deps();
  const res = await ask('How do I control severe bleeding?', d, { state: 'CO' });
  assert.equal(res.kind, 'answer');
  for await (const _ of (res as { stream: AsyncIterable<string> }).stream) { /* drain */ }
  const prompt = d.backend.lastPrompt ?? '';
  assert.ok(prompt.startsWith(SYSTEM_PREFIX), 'prefix must be byte-identical for KV reuse');
  assert.ok(prompt.includes('SOURCES:'));
  assert.ok(prompt.includes('SOURCE 1'), 'sources must be numbered so steps can refer to them');
  assert.ok(!/Cite the sources/i.test(prompt),
    'the model is not asked to cite: citations come from retrieval, and asking a ' +
    '0.6B model to inline them produced answers consisting only of "[1], [3]"');
});

test('abstains rather than answering from weak context', async () => {
  const d = deps();
  const res = await ask('How do I control severe bleeding?', d, {
    state: 'CO',
    abstainThreshold: 0.99, // nothing can clear this
  });
  assert.equal(res.kind, 'abstain');
  if (res.kind !== 'abstain') return;
  assert.ok(res.diagnostics.topScore < 0.99);
  assert.ok(res.nearest.length > 0, 'the nearest source should still be offered');
  assert.equal(d.backend.lastPrompt, null, 'generation must not run when abstaining');
});

test('a query with no retrievable content abstains', async () => {
  const res = await ask('xyzzy plugh quantum flibbertigibbet', deps(), { state: 'CO' });
  assert.equal(res.kind, 'abstain');
});

test('a state-scoped query with unresolved location asks for the state', async () => {
  const res = await ask('What do I do if I see a bear?', deps(), { state: null });
  assert.equal(res.kind, 'needs-location');
  if (res.kind !== 'needs-location') return;
  assert.deepEqual(res.candidatePacks, ['state-CO-wildlife']);
});

test('the same query answers once the state is known', async () => {
  const res = await ask('What do I do if I see a bear?', deps(), { state: 'CO' });
  assert.equal(res.kind, 'answer');
  if (res.kind !== 'answer') return;
  assert.equal(res.citations[0]!.source, 'FEIS');
  assert.equal(res.medical, false);
});

test('a pack from another state is never searched', async () => {
  const res = await ask('What do I do if I see a bear?', deps(), { state: 'OH' });
  assert.equal(res.kind, 'needs-location');
  const r = route(extractKeywords('bear'), PACKS, { state: 'OH' });
  // The invariant is that the wrong state's pack is not searched — not that
  // nothing is. Routing now widens to the unscoped packs rather than returning
  // empty, and the location prompt is decided after retrieval instead.
  assert.ok(!r.packIds.includes('state-CO-wildlife'), r.packIds.join(', '));
  assert.deepEqual(r.skippedStatePacks, ['state-CO-wildlife']);
  assert.ok(r.reason.includes('outside OH'));
});

test('plural domain terms still route to their domain', () => {
  // US-08-AC2's wording. Matching only the raw token left "animals" unrouted.
  const r = route(extractKeywords('I have a cooler, can animals get in?'), PACKS, { state: 'CO' });
  assert.ok(r.domains.includes('wildlife'), r.reason);
  assert.deepEqual(r.packIds, ['state-CO-wildlife']);
  const snakes = extractKeywords('are there snakes here').find((k) => k.term === 'snake');
  assert.equal(snakes?.isDomainTerm, true, 'stem() turns "snakes" into "snak"; the trailing-s form must match');
});

test('lay injury wording routes to first aid, not the fallback', () => {
  // US-02-AC1's wording. With no domain match it fell back to every pack.
  const r = route(extractKeywords('I cut myself on a branch, what should I do?'), PACKS, { state: null });
  assert.deepEqual(r.domains, ['first-aid-physical'], r.reason);
  const ankle = route(extractKeywords('my friend twisted an ankle on the trail'), PACKS, { state: null });
  assert.ok(ankle.domains.includes('first-aid-physical'), ankle.reason);
});

test('a bite routes to first aid even when the animal routes to wildlife', () => {
  const r = route(extractKeywords('A rattlesnake bit my leg, what do I do?'), PACKS, { state: null });
  assert.ok(r.domains.includes('first-aid-physical'), r.reason);
  assert.ok(r.packIds.includes('core-firstaid'), 'first aid must be searched without a location');
});

test('diagnostics expose the numbers the debug overlay needs', async () => {
  const res = await ask('How do I control severe bleeding from a wound?', deps(), { state: 'CO' });
  assert.equal(res.kind, 'answer');
  const d = res.diagnostics;
  assert.ok(d.keywords.length > 0);
  assert.ok(d.candidates.length > 0);
  assert.ok(d.topScore >= DEFAULT_ABSTAIN_THRESHOLD);
  assert.ok(d.tokensBefore > 0);
  assert.ok(d.tokensAfter > 0 && d.tokensAfter <= d.tokensBefore);
  assert.equal(d.route.packIds.includes('core-firstaid'), true);
});

test('adaptive generation budget follows PocketRAG Eq. 5', () => {
  assert.equal(maxTokensForPressure(0.0), 1024);
  assert.equal(maxTokensForPressure(0.69), 1024);
  assert.equal(maxTokensForPressure(0.70), 768);
  assert.equal(maxTokensForPressure(0.84), 768);
  assert.equal(maxTokensForPressure(0.85), 256);
  assert.equal(maxTokensForPressure(1.0), 256);
});

test('memory pressure actually reaches the generate call', async () => {
  const d = { ...deps(), memory: { pressure: () => 0.9 } };
  const res = await ask('How do I control severe bleeding from a wound?', d, { state: 'CO' });
  assert.equal(res.kind, 'answer');
  for await (const _ of (res as { stream: AsyncIterable<string> }).stream) { /* drain */ }
  assert.equal(d.backend.lastOptions?.maxTokens, 256);
});

test('chunk domain, not just pack domain, decides what a query can retrieve', async () => {
  const store = new FakePackStore();
  store.addPack('core-survival', [
    seed('Cut the snare cord where it crosses the branch.', { domain: 'survival', source: 'ATP 3-50.21' }),
    seed('For a cut, rinse the wound with clean water and cover it.', { source: 'ATP 3-50.21' }),
  ]);
  const packs = [{ id: 'core-survival', domains: ['survival', 'first-aid-physical'] as const, scope: { kind: 'global' } as const }];
  const res = await ask('I cut myself on a branch', { backend: new FakeBackend(), store, packs }, {
    state: null,
    abstainThreshold: 0,
  });
  assert.equal(res.kind, 'answer');
  const got = res.diagnostics.candidates;
  assert.ok(got.length > 0);
  assert.ok(got.every((c) => c.chunk.domain === 'first-aid-physical'),
    'a snare passage must not answer a first-aid question just because its pack routes for first aid');
});

test('a query with no domain vocabulary is searched, then declined on the evidence', async () => {
  // These used to be refused by the router. That bought +20.6 points on the
  // tuning set and cost 15 of 31 held-out questions, because refusing on "no
  // vocabulary matched" measures the lexicon rather than the query
  // (docs/results-holdout.md). They must still be declined — just by the gate,
  // after looking, rather than by never looking.
  for (const q of [
    'What is the capital of France?',
    'How do I perform a cricothyrotomy?',
    'How deep can I dive before I need a decompression stop?',
  ]) {
    const r = route(extractKeywords(q), PACKS, { state: null });
    assert.ok(r.packIds.length > 0, `${q} should be searched`);
    assert.ok(!r.packIds.some((id) => id.startsWith('state-')), 'no state pack on a speculative search');
    assert.equal(r.skippedStatePacks.length, 0, 'must abstain, not ask for a location');
    assert.equal((await ask(q, deps(), { state: null })).kind, 'abstain', q);
  }
});

test('lay descriptions of emergencies still route', () => {
  // The other half of that trade, and the reason the fallback existed. These
  // describe real emergencies without a single clinical word; before the lexicon
  // carried body parts and described symptoms, every one matched nothing and
  // would have been refused outright.
  for (const [q, domain] of [
    ['My friend is shivering uncontrollably and confused after falling in a cold creek', 'first-aid-physical'],
    ['Something is stuck in my eye after a branch hit me', 'first-aid-physical'],
    ['My friend hit their head on a rock and seems confused', 'first-aid-physical'],
    ['I need to cross a river, what should I avoid?', 'survival'],
    ['I think I am lost, should I keep walking?', 'survival'],
  ] as [string, string][]) {
    const r = route(extractKeywords(q), PACKS, { state: null });
    assert.ok(r.packIds.length > 0, `refused: ${q}`);
    assert.ok(r.domains.includes(domain as never), `${q} -> [${r.domains.join(', ')}]`);
  }
});

test('a question about plant food safety does not demand a location', () => {
  // The answer is in ATP 3-50.21's edibility chapter and is not state-specific,
  // but 'plant' routed only to the state-scoped plants domain, so the pipeline
  // asked the user where they were before it would answer.
  const r = route(extractKeywords('How do I know if a wild plant is safe to eat?'), PACKS, { state: null });
  assert.ok(r.domains.includes('survival'), r.reason);
  assert.ok(r.packIds.includes('core-survival'), `expected a global pack, got [${r.packIds.join(', ')}]`);
});

test('which species are here does not route to the survival manual', () => {
  // The converse of the test above, and it caught a real regression: routing
  // bare 'plant' to survival made ATP 3-50.21's PLANTS chapter outrank the FEIS
  // species reviews for "what plants and animals are near me?". Only the eating
  // vocabulary is shared, so a species question must not reach survival at all.
  const r = route(extractKeywords('What plants and animals are near me?'), PACKS, { state: 'CO' });
  assert.ok(r.packIds.includes('state-CO-wildlife'), `expected the state pack, got [${r.packIds.join(', ')}]`);
  assert.ok(!r.domains.includes('survival'), `species questions must not route to survival: ${r.reason}`);
});

test('"mountain" alone does not route to wildlife', () => {
  // It sent "can you write me a poem about the mountains?" to a state pack, so
  // the pipeline asked for the user's location. 'lion'/'cougar'/'puma' cover the
  // animal 'mountain' was listed for.
  const poem = route(extractKeywords('Can you write me a poem about the mountains?'), PACKS, { state: null });
  assert.ok(poem.fallback, 'no domain vocabulary, so this is a speculative search');
  assert.equal(poem.skippedStatePacks.length, 0, 'must not gate a non-geographic query on location');

  const lion = route(extractKeywords('Are there mountain lions around here?'), PACKS, { state: 'CO' });
  assert.ok(lion.domains.includes('wildlife'), lion.reason);
});

test('wrong-domain chunks do not consume the Stage-1 candidate quota', async () => {
  // US-02-AC1 in miniature. The survival pack routes for first aid, and its
  // woodcraft chunks all match "cut" lexically. With the domain filter applied
  // after Stage 1 they filled the whole quota and the one wound-care passage —
  // ranked last on lexical overlap — never reached the re-ranker at all.
  const store = new FakePackStore();
  store.addPack('core-survival', [
    ...Array.from({ length: 50 }, (_, i) =>
      seed(`Cut the snare cord ${i} where it crosses the branch, then cut again.`,
        { domain: 'survival', source: 'ATP 3-50.21' })),
    seed('For a cut, rinse the wound with clean water and cover it.', { source: 'ATP 3-50.21' }),
  ]);
  const hits = await retrieve(
    extractKeywords('I cut myself on a branch, what should I do?'),
    ['core-survival'],
    store,
    new FakeBackend(),
    { ...DEFAULT_RETRIEVAL, candidateLimit: 50, topK: 4 },
    ['first-aid-physical'],
  );
  assert.ok(hits.length > 0, 'the wound-care chunk must survive Stage 1');
  assert.ok(hits.every((h) => h.chunk.domain === 'first-aid-physical'));
});

test('an empty domain list is not treated as "no filter"', async () => {
  // A store building `domain IN ()` from an empty array would match nothing;
  // one skipping the clause would match everything. Only route() produces this
  // input, so pin the behaviour rather than leaving it to each store's SQL.
  const store = new FakePackStore();
  store.addPack('core-survival', [seed('Build a fire with dry tinder.', { domain: 'survival' })]);
  const hits = await retrieve(
    extractKeywords('fire tinder'),
    ['core-survival'],
    store,
    new FakeBackend(),
    DEFAULT_RETRIEVAL,
    [],
  );
  assert.equal(hits.length, 0, 'no routed domain means nothing is eligible');
});

test('one large pack cannot crowd another out of Stage 1', async () => {
  const store = new FakePackStore();
  store.addPack('big', Array.from({ length: 60 }, (_, i) => seed(`bleeding note ${i}`)));
  store.addPack('small', [seed('bleeding control with direct pressure')]);
  const hits = await retrieve(extractKeywords('bleeding'), ['big', 'small'], store, new FakeBackend(), {
    ...DEFAULT_RETRIEVAL,
    candidateLimit: 50,
    topK: 100,
  });
  assert.ok(hits.some((h) => h.chunk.packId === 'small'),
    'a pack listed second must still reach Stage 2 when the first has more hits than the limit');
});

test('mixing packs built with a different encoder throws instead of scoring nonsense', () => {
  const store = buildStore();
  store.addPack('bad-pack', [seed('text')], { ...FAKE_SPEC, modelId: 'other/encoder' });
  assert.throws(
    () => assertCompatibleEmbedding(['core-firstaid', 'bad-pack'], store, new FakeBackend()),
    /was built with other\/encoder/,
  );
});

/**
 * Widening has to carry the domains with it.
 *
 * Stage 1 filters candidates by the routed domains, so widening the pack list
 * alone selects the core packs and then discards every chunk inside them. That
 * shipped for one held-out run: "why do people make such a fuss about ticks?"
 * matched wildlife, widened to core-survival, and retrieved nothing at all
 * because core-survival's chunks are tagged survival.
 */
test('widening to unscoped packs widens the domains too', () => {
  const r = route(extractKeywords('Why do people make such a fuss about ticks?'), PACKS, { state: null });
  assert.ok(r.packIds.includes('core-survival'), `packs: ${r.packIds.join(', ')}`);
  assert.ok(r.domains.includes('survival'), `domains: ${r.domains.join(', ')}`);
  assert.ok(!r.packIds.includes('state-CO-wildlife'), 'still never another state');
  // The state pack genuinely matched, so the location prompt stays available if
  // the widened search comes back with nothing.
  assert.deepEqual(r.skippedStatePacks, ['state-CO-wildlife']);
});
