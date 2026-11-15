import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChunkRecord } from '@fred/pack-format';
import { ask, maxTokensForPressure, tipsInTrustOrder, DEFAULT_ABSTAIN_THRESHOLD, CLOSEST_CARD_FLOOR, UNDER_GATE_QUOTE_FLOOR } from '../src/pipeline.ts';
import { currentThread, readUnderstood } from '../src/understand.ts';
import { applyQueryTemplate, assertCompatibleEmbedding, retrieve, DEFAULT_RETRIEVAL, type ScoredChunk } from '../src/retrieve.ts';
import { quantizeInt8 } from '../src/score.ts';
import { route } from '../src/router.ts';
import { extractKeywords } from '../src/lexicon.ts';
import { SYSTEM_PREFIX, CLOSEST_CARD_LEAD } from '../src/prompt.ts';
import { FakeBackend, FakePackStore, FAKE_SPEC, fakeEmbed } from './fakes.ts';
import { truncateVector } from '../src/sentences.ts';

type Seed = Omit<ChunkRecord, 'id' | 'packId' | 'ordinal'>;
const seed = (text: string, over: Partial<Seed> = {}): Seed => ({
  text, context: '', section: 'sec', source: 'WHO BEC 2018', page: 10,
  domain: 'first-aid-physical', licenseId: 'who-bec', blockKind: 'prose', audience: 'everyone', ...over,
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

test('a weak state-pack search is retried across the unscoped packs', async () => {
  // With California set, "how do I keep bears out of my food" searched the
  // state species pack alone and declined, though a tips page answers it. The
  // state pack here says nothing about food; the survival manual does.
  const store = new FakePackStore();
  store.addPack('core-firstaid', [seed('Control severe bleeding with firm direct pressure on the wound.')]);
  store.addPack('core-survival', [
    seed('Hang your food bag from a high branch away from camp so a bear cannot reach your food.', { domain: 'survival', source: 'FM 21-76', licenseId: 'fm-21-76' }),
  ]);
  store.addPack('state-CO-wildlife', [
    seed('Ursus americanus ranges across Front Range foothills and aspen parkland.', { domain: 'wildlife', source: 'FEIS', licenseId: 'feis' }),
  ]);
  const q = 'How do I hang my food so a bear cannot reach it at camp?';
  const narrow = await ask(q, { backend: new FakeBackend(), store, packs: PACKS }, { state: 'CO', abstainThreshold: 0 });
  const res = await ask(q, { backend: new FakeBackend(), store, packs: PACKS }, { state: 'CO' });
  assert.ok(narrow.diagnostics.topScore < DEFAULT_ABSTAIN_THRESHOLD,
    'fixture: the routed search alone should fall under the gate');
  assert.equal(res.kind, 'answer');
  if (res.kind !== 'answer') return;
  assert.equal(res.citations[0]!.source, 'FM 21-76');
});

test('a pack from another state is never searched', async () => {
  // The hiker is in Ohio and only Colorado's pack is installed. Asking "which
  // state are you in?" would be asking what Fred already knows, and its state
  // buttons would offer Colorado's answer to someone in Ohio: decline instead.
  const res = await ask('What do I do if I see a bear?', deps(), { state: 'OH' });
  assert.equal(res.kind, 'abstain');
  const r = route(extractKeywords('bear'), PACKS, { state: 'OH' });
  // The invariant is that the wrong state's pack is not searched — not that
  // nothing is. Routing widens to the unscoped packs rather than returning empty.
  assert.ok(!r.packIds.includes('state-CO-wildlife'), r.packIds.join(', '));
  assert.deepEqual(r.skippedStatePacks, []);
});

test('an unknown location still asks for one', async () => {
  const res = await ask('What do I do if I see a bear?', deps(), { state: null });
  assert.equal(res.kind, 'needs-location');
  const r = route(extractKeywords('bear'), PACKS, { state: null });
  assert.deepEqual(r.skippedStatePacks, ['state-CO-wildlife']);
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

test('a qualifying field card is placed first, even from outside the top K', async () => {
  const { withReservedCard } = await import('../src/retrieve.ts');
  const mk = (packId: string, id: string, score: number) =>
    ({ chunk: { id, packId } as never, cosineRaw: score, cosine: score, sLex: 0, score });
  const scored = [mk('m', 'a', 0.5), mk('m', 'b', 0.45), mk('m', 'c', 0.44), mk('m', 'd', 0.43), mk('cards', 'card', 0.38)];
  const opts = { candidateLimit: 50, topK: 4, alpha: 1, mode: 'hybrid' as const, queryInput: 'question' as const, densePool: 20 };
  const reserved = withReservedCard(scored, { ...opts, reserve: { packId: 'cards', minScore: 0.35 } });
  assert.deepEqual(reserved.map((c) => c.chunk.id), ['card', 'a', 'b', 'c']);
  const tooWeak = withReservedCard(scored, { ...opts, reserve: { packId: 'cards', minScore: 0.4 } });
  assert.deepEqual(tooWeak.map((c) => c.chunk.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(withReservedCard(scored, opts).map((c) => c.chunk.id), ['a', 'b', 'c', 'd']);
});

// Provider-only material (docs/plan-phase3.md, class B).
function clinicalStore(withCard: boolean): FakePackStore {
  const store = new FakePackStore();
  store.addPack('core-firstaid', [
    seed('Insert the IV cannula into the vein and secure the cannula with tape.', { audience: 'provider' }),
    seed('Control severe bleeding with firm direct pressure on the wound.'),
  ]);
  store.addPack('core-fieldcards', withCard
    ? [seed('Insert IV cannula vein: you cannot do this out here; keep them warm and get help.', { source: 'Fred field card' })]
    : []);
  return store;
}
const clinicalPacks = [
  { id: 'core-firstaid', domains: ['first-aid-physical'] as const, scope: { kind: 'global' } as const },
  { id: 'core-fieldcards', domains: ['first-aid-physical'] as const, scope: { kind: 'global' } as const },
];

test('a clinical procedure is referred on, not answered', async () => {
  const backend = new FakeBackend();
  const res = await ask('How do I insert an IV cannula into a vein?', { backend, store: clinicalStore(false), packs: clinicalPacks }, {
    state: null, abstainThreshold: 0,
  });
  assert.equal(res.kind, 'abstain');
  if (res.kind !== 'abstain') return;
  assert.equal(res.reason, 'provider-only');
  assert.equal(backend.lastPrompt, null, 'the model must never see the procedure');
});

test('a matching field card takes precedence over provider-only material', async () => {
  const res = await ask('How do I insert an IV cannula into a vein?', { backend: new FakeBackend(), store: clinicalStore(true), packs: clinicalPacks }, {
    state: null, abstainThreshold: 0,
    retrieval: { ...DEFAULT_RETRIEVAL, reserve: { packId: 'core-fieldcards', minScore: 0 } },
  });
  assert.equal(res.kind, 'answer');
});

test('provider-only passages never reach the model, even beside an answer', async () => {
  const backend = new FakeBackend();
  const res = await ask('How do I control severe bleeding from a wound?', { backend, store: clinicalStore(false), packs: clinicalPacks }, {
    state: null, abstainThreshold: 0,
  });
  assert.equal(res.kind, 'answer');
  if (res.kind !== 'answer') return;
  for await (const _ of res.stream) { /* drain */ }
  assert.ok(!(backend.lastPrompt ?? '').includes('cannula'));
  assert.ok(res.citations.every((c) => !c.section.includes('cannula')));
});

test('the hiker\'s state is named only when a state pack is answered from', async () => {
  const d = deps();
  const bears = await ask('Black bear encounters around here: what do I do?', d, { state: 'CO', abstainThreshold: 0, locationInPrompt: true });
  assert.equal(bears.kind, 'answer');
  if (bears.kind === 'answer') assert.match(bears.prompt.user, /\(The hiker is in Colorado\.\)/);
  const bleed = await ask('How do I control severe bleeding from a wound?', deps(), { state: 'CO', locationInPrompt: true });
  assert.equal(bleed.kind, 'answer');
  if (bleed.kind === 'answer') assert.doesNotMatch(bleed.prompt.user, /hiker is in/);
});

test('a clearly matching card is answered verbatim, without the model', async () => {
  const store = new FakePackStore();
  store.addPack('core-firstaid', [seed('Burns need cool water.')]);
  store.addPack('core-fieldcards', [seed(
    "Burns\nCool it and cover it.\n1. Cool the burn with cool water.\n2. Cover it with a clean dressing.\nDon't pull off clothing that is stuck to the burn.",
    { source: 'Fred field card' },
  )]);
  const backend = new FakeBackend();
  const res = await ask('burns cool cover clothing stuck', { backend, store, packs: clinicalPacks }, {
    state: null, abstainThreshold: 0, cardAnswer: 'verbatim',
    retrieval: { ...DEFAULT_RETRIEVAL, reserve: { packId: 'core-fieldcards', minScore: 0 } },
  });
  assert.equal(res.kind, 'answer');
  if (res.kind !== 'answer') return;
  let out = '';
  for await (const t of res.stream) out += t;
  assert.equal(out, "Cool it and cover it.\n1. Cool the burn with cool water.\n2. Cover it with a clean dressing.\nDon't pull off clothing that is stuck to the burn.");
  assert.equal(backend.lastPrompt, null);
  assert.equal(res.citations.length, 1);
});

test('a card with a clarifying question: whole card and the question, or the case already named', async () => {
  const store = new FakePackStore();
  store.addPack('core-firstaid', [seed('Burns need cool water.')]);
  store.addPack('core-fieldcards', [seed(
    "Burns\nStop it, then check the skin.\n1. Stop, drop and roll.\n2. Surface burn: cool water.\n3. Blistering burn: cool and cover.\nDon't use ice.",
    { source: 'Fred field card' },
  )]);
  const clarify = { question: 'What does the skin look like?', choices: [
    { label: 'Red', words: ['just red'], steps: [1, 2] },
    { label: 'Blistered', words: ['blister'], steps: [1, 3] },
  ] };
  const withClarify = Object.assign(store, {
    clarifyFor: (id: string) => (id === 'core-fieldcards:0' ? clarify : undefined),
    cardSourcesFor: (id: string) => (id === 'core-fieldcards:0' ? [{ source: 'ATP 3-50.21 Survival 2018', pages: [28] }] : undefined),
  });
  const opts = {
    state: null, abstainThreshold: 0, cardAnswer: 'verbatim' as const,
    retrieval: { ...DEFAULT_RETRIEVAL, reserve: { packId: 'core-fieldcards', minScore: 0 } },
  };
  const text = async (r: Awaited<ReturnType<typeof ask>>): Promise<string> => {
    let out = '';
    if (r.kind === 'answer') for await (const t of r.stream) out += t;
    return out;
  };

  const vague = await ask('burns stop drop roll cool cover', { backend: new FakeBackend(), store: withClarify, packs: clinicalPacks }, opts);
  assert.equal(vague.kind, 'answer');
  if (vague.kind !== 'answer') return;
  assert.equal(vague.clarify?.picked, null);
  assert.deepEqual(vague.citations[0]?.basis, [{ source: 'ATP 3-50.21 Survival 2018', pages: [28] }]);
  assert.equal(vague.clarify?.choices[1]?.text, "Stop it, then check the skin.\n1. Stop, drop and roll.\n2. Blistering burn: cool and cover.\nDon't use ice.");
  assert.match(await text(vague), /1\. Stop, drop and roll\.\n2\. Surface burn/);

  const named = await ask('burns stop drop roll cool cover, it is starting to blister', { backend: new FakeBackend(), store: withClarify, packs: clinicalPacks }, opts);
  assert.equal(named.kind === 'answer' ? named.clarify?.picked : undefined, 'Blistered');
  assert.equal(await text(named), "Stop it, then check the skin.\n1. Stop, drop and roll.\n2. Blistering burn: cool and cover.\nDon't use ice.");
});

// Conversation memory (docs/plan-memory.md).
const drain = async (res: Awaited<ReturnType<typeof ask>>): Promise<void> => {
  if (res.kind === 'answer') for await (const _ of res.stream) { /* drain */ }
};
const BLEED = 'How do I control severe bleeding from a wound?';
const openerScore = async (): Promise<number> =>
  (await ask(BLEED, deps(), { state: 'CO' })).diagnostics.topScore;

test('without a previous question nothing about memory changes', async () => {
  const d = deps();
  const res = await ask('What if it keeps going?', d, { state: 'CO' });
  await drain(res);
  assert.equal(res.diagnostics.followUp, undefined);
  assert.ok(!(d.backend.lastPrompt ?? '').includes('EARLIER QUESTION'));
});

test('a follow-up that means nothing alone is searched with the earlier question', async () => {
  const d = deps();
  const res = await ask('What if it keeps going?', d, {
    state: 'CO', previous: { question: BLEED, topScore: await openerScore() },
  });
  assert.equal(res.diagnostics.followUp?.used, true);
  assert.equal(res.kind, 'answer');
  await drain(res);
  const prompt = d.backend.lastPrompt ?? '';
  assert.ok(prompt.includes(`EARLIER QUESTION: ${BLEED}\nQUESTION: What if it keeps going?`));
  assert.ok(prompt.includes('direct pressure'), 'answered from the earlier topic');
});

test('the model can be kept from seeing the earlier question', async () => {
  const d = deps();
  const res = await ask('What if it keeps going?', d, {
    state: 'CO', previous: { question: BLEED, topScore: await openerScore() }, previousInPrompt: false,
  });
  await drain(res);
  assert.equal(res.diagnostics.followUp?.used, true);
  assert.ok(!(d.backend.lastPrompt ?? '').includes('EARLIER QUESTION'));
});

test('no memory after a question Fred could not answer', async () => {
  // An opener under the gate has no topic to build on.
  const res = await ask('What if it keeps going?', deps(), {
    state: 'CO', previous: { question: BLEED, topScore: DEFAULT_ABSTAIN_THRESHOLD - 0.01 },
  });
  assert.equal(res.diagnostics.followUp, undefined);
});

test('a message on a new topic keeps its own search', async () => {
  const d = deps();
  const res = await ask('How do I build a fire from dry tinder and kindling?', d, {
    state: 'CO', previous: { question: BLEED, topScore: await openerScore() },
  });
  assert.equal(res.diagnostics.followUp?.used, false);
  await drain(res);
  const prompt = d.backend.lastPrompt ?? '';
  assert.ok(!prompt.includes('EARLIER QUESTION'));
  assert.ok(prompt.includes('tinder'));
});

test('a joined search that still cannot answer changes nothing', async () => {
  // Find the joined score, then set the gate just above it, with the opener
  // clearing that gate and the joined search keeping 90% of it: only the
  // "must clear the gate" rule can refuse memory here.
  const probe = await ask('What if it keeps going?', deps(), {
    state: 'CO', previous: { question: BLEED, topScore: await openerScore() }, abstainThreshold: 0, fallbackThreshold: 0,
  });
  const joined = probe.diagnostics.followUp!.joinedTopScore;
  const gate = joined + 0.01;
  const res = await ask('What if it keeps going?', deps(), {
    state: 'CO', previous: { question: BLEED, topScore: gate }, abstainThreshold: gate, fallbackThreshold: gate,
  });
  assert.equal(res.diagnostics.followUp?.used, false);
  assert.equal(res.kind, 'abstain');
});

test('a provider-only passage just behind the top still triggers the referral', async () => {
  // The needle-decompression failure: the procedure came second by 0.001.
  const store = new FakePackStore();
  store.addPack('core-firstaid', [
    // Same words as the question, plus one: just behind the ordinary passage.
    seed('needle decompression tension pneumothorax chest wall collapsed lung trauma breathing emergency casualty insert', { audience: 'provider' }),
    seed('needle decompression tension pneumothorax chest wall collapsed lung trauma breathing emergency casualty'),
  ]);
  store.addPack('core-fieldcards', []);
  const backend = new FakeBackend();
  const res = await ask('needle decompression tension pneumothorax chest wall collapsed lung trauma breathing emergency casualty',
    { backend, store, packs: clinicalPacks }, { state: null, abstainThreshold: 0 });
  const ranked = [...res.diagnostics.candidates].sort((a, b) => b.score - a.score);
  assert.equal(ranked[0]!.chunk.audience ?? 'everyone', 'everyone', 'fixture: the ordinary passage must rank first');
  assert.ok(ranked[1]!.score >= 0.95 * ranked[0]!.score, `fixture: near-tie, got ${ranked[1]!.score} vs ${ranked[0]!.score}`);
  assert.equal(res.kind, 'abstain');
  if (res.kind === 'abstain') assert.equal(res.reason, 'provider-only');
  assert.equal(backend.lastPrompt, null);
});

// Intent (docs/results-intent-probe.md).
const intentStore = (): FakePackStore => {
  const store = new FakePackStore();
  store.addPack('core-firstaid', [seed('Control severe bleeding with firm direct pressure on the wound.')]);
  store.addPack('core-fieldcards', [seed('friend bleeding badly from his leg: press hard on the wound and get help', { source: 'Fred field card', section: 'Heavy bleeding' })]);
  return store;
};
const saying = (word: string): FakeBackend => {
  const b = new FakeBackend();
  const gen = b.generate.bind(b);
  b.generate = async function* (p, o) { if (p.user.endsWith('->')) { yield word; return; } yield* gen(p, o); };
  return b;
};
const intentOpts = { state: null, abstainThreshold: 0.99, fallbackThreshold: 0.99, intent: true,
  retrieval: { ...DEFAULT_RETRIEVAL, reserve: { packId: 'core-fieldcards', minScore: 0.35 } } } as const;

test('an emergency opens the leading card even under the gate', async () => {
  const res = await ask('my friend is bleeding badly from his leg', { backend: saying('NOW'), store: intentStore(), packs: clinicalPacks }, intentOpts);
  assert.equal(res.diagnostics.intent, 'now');
  assert.equal(res.kind, 'answer');
  if (res.kind === 'answer') assert.equal(res.citations[0]!.source, 'Fred field card');
});

test('small talk gets the fixed reply, with the card only offered', async () => {
  const res = await ask('my friend was bleeding badly yesterday but he is fine now', { backend: saying('CHAT'), store: intentStore(), packs: clinicalPacks }, intentOpts);
  assert.equal(res.kind, 'chat');
  if (res.kind === 'chat') assert.equal(res.offer?.citation.source, 'Fred field card');
});

test('a pet is never the patient: no card is forced open', async () => {
  const res = await ask('my dog is bleeding badly from his leg', { backend: saying('NOW'), store: intentStore(), packs: clinicalPacks }, intentOpts);
  assert.notEqual(res.kind, 'answer');
});

test('with intent off, nothing changes', async () => {
  const res = await ask('my friend is bleeding badly from his leg', { backend: saying('NOW'), store: intentStore(), packs: clinicalPacks }, { ...intentOpts, intent: false });
  assert.equal(res.diagnostics.intent, undefined);
  assert.equal(res.kind, 'abstain');
});

// #212: a new, unrelated question right after a card does not reopen it.
// On the phone, "how do I tell if canned fish has gone bad" after the
// head-injury card found nothing of its own (0.000), and joining it to the
// head-injury question kept only 0.292 of that question's match.
const BLED = 'my friend is bleeding badly from his leg';
const threadOpts = { ...intentOpts, understand: true, abstainThreshold: 0.3, fallbackThreshold: 0.3,
  previous: { question: BLED, topScore: 0.95 }, history: [BLED], lastCard: 'Heavy bleeding' } as const;

test('#212: an unrelated question after a card does not reopen it', async () => {
  const res = await ask('how do i tell if canned fish has gone bad', { backend: saying('QUESTION'), store: intentStore(), packs: clinicalPacks }, threadOpts);
  assert.equal(res.diagnostics.followUp?.used, false, 'fixture: the joined search must leave the topic');
  assert.equal(res.diagnostics.agreedCard, undefined);
  assert.notEqual(res.kind, 'answer');
});

test('#212: a short message after a card still keeps it', async () => {
  const res = await ask('what now', { backend: saying('QUESTION'), store: intentStore(), packs: clinicalPacks }, threadOpts);
  assert.equal(res.diagnostics.agreedCard, 'Heavy bleeding');
});

// Tips packs (#96, docs/plan-tips.md).
const tipsPacks = [
  { id: 'core-firstaid', domains: ['first-aid-physical'] as const, scope: { kind: 'global' } as const },
  { id: 'core-tips-nps', domains: ['outdoor-skills'] as const, scope: { kind: 'global' } as const },
  { id: 'core-tips-wikivoyage', domains: ['outdoor-skills'] as const, scope: { kind: 'global' } as const },
];
const tipsStore = (): FakePackStore => {
  const store = new FakePackStore();
  store.addPack('core-firstaid', [seed('cannot walk after a fall: splint it, cool it, raise it and get help')]);
  // Shares more words with the question than the first-aid passage does.
  store.addPack('core-tips-wikivoyage', [seed('stepped in a hole on the trail now walk in boots with ankle support', {
    source: 'Wikivoyage', section: 'Hiking > Footwear', domain: 'outdoor-skills', licenseId: 'wikivoyage:Hiking' })]);
  store.addPack('core-tips-nps', []);
  return store;
};
const tipsOpts = { state: null, abstainThreshold: 0, fallbackThreshold: 0, intent: true } as const;
// No routing vocabulary, so every pack is searched and only the guard keeps
// tips out. (With "ankle" or "swelling" in it, routing alone would.)
const ANKLE = 'stepped in a hole on the trail and now i cannot walk';

test('an emergency is never answered from tips', async () => {
  const res = await ask(ANKLE, { backend: saying('NOW'), store: tipsStore(), packs: tipsPacks }, tipsOpts);
  assert.equal(res.kind, 'answer');
  if (res.kind === 'answer') assert.ok(res.citations.every((c) => c.source !== 'Wikivoyage'), 'a tip reached an emergency answer');
});

test('the same words asked as a question may use tips', async () => {
  const res = await ask(ANKLE, { backend: saying('QUESTION'), store: tipsStore(), packs: tipsPacks }, tipsOpts);
  assert.equal(res.kind, 'answer');
  if (res.kind === 'answer') assert.ok(res.citations.some((c) => c.source === 'Wikivoyage'), 'fixture: the tip should be searchable');
});

test('where both tips packs answer, NPS is read first and nothing else moves', () => {
  const chunk = (packId: string, domain: string, id: string) =>
    ({ chunk: { packId, domain, id }, score: 0.5, cosine: 0.5, cosineRaw: 0.5, sLex: 0 }) as unknown as ScoredChunk;
  const order = tipsInTrustOrder([
    chunk('core-fieldcards', 'first-aid-physical', 'card'),
    chunk('core-tips-wikivoyage', 'outdoor-skills', 'wv'),
    chunk('core-survival', 'survival', 'manual'),
    chunk('core-tips-nps', 'outdoor-skills', 'nps'),
  ]).map((c) => c.chunk.id);
  assert.deepEqual(order, ['card', 'nps', 'manual', 'wv']);
});

const tickPacks = [
  { id: 'core-fieldcards', domains: ['first-aid-physical'] as const, scope: { kind: 'global' } as const },
  { id: 'core-tips-wikivoyage', domains: ['outdoor-skills'] as const, scope: { kind: 'global' } as const },
  { id: 'state-CO-wildlife', domains: ['wildlife'] as const, scope: { kind: 'us-state', state: 'CO' } as const },
];
const tickStore = (): FakePackStore => {
  const store = new FakePackStore();
  store.addPack('core-fieldcards', [seed('tick dug into skin: grip it close with tweezers and pull straight out', { source: 'Fred field card', section: 'Removing a tick' })]);
  store.addPack('core-tips-wikivoyage', [seed('tick prevention: tuck pants into socks, use repellent, check after the hike', {
    source: 'Wikivoyage', section: 'Pests > Ticks', domain: 'outdoor-skills', licenseId: 'wikivoyage:Pests' })]);
  store.addPack('state-CO-wildlife', []);
  return store;
};

test('an emergency routed only to tips is searched again without them', async () => {
  // "tick" is a tips word, so routing picks the tips pack alone; filtering it
  // out left nothing and the tick card was lost (docs/results-tips.md).
  const res = await ask('a tick dug into my armpit', { backend: saying('NOW'), store: tickStore(), packs: tickPacks }, tipsOpts);
  assert.equal(res.kind, 'answer');
  if (res.kind === 'answer') assert.equal(res.citations[0]!.source, 'Fred field card');
});

test('a question about "this area" is not answered from general tips without a location', async () => {
  const store = new FakePackStore();
  store.addPack('core-fieldcards', []);
  store.addPack('core-tips-wikivoyage', [seed('dangerous animals in this area snakes scorpions keep your distance', {
    source: 'Wikivoyage', section: 'Arid region safety > Stay safe', domain: 'outdoor-skills', licenseId: 'wikivoyage:Arid_region_safety' })]);
  store.addPack('state-CO-wildlife', []);
  const res = await ask('are there dangerous animals in this area', { backend: saying('QUESTION'), store, packs: tickPacks }, tipsOpts);
  assert.equal(res.kind, 'needs-location');
});

// Understanding the conversation (#98, docs/plan-understand.md).
test('readUnderstood reads the word and the request, and keeps an invented word', () => {
  assert.deepEqual(readUnderstood('NOW | lost and scared, what to do'), { intent: 'now', request: 'lost and scared, what to do' });
  assert.deepEqual(readUnderstood('OUT | pet dog ate chocolate'), { intent: 'out', request: '' });
  // Qwen3-1.7B put the key word where the label goes.
  assert.deepEqual(readUnderstood('THROAT | closing up after eating a trail snack'), { intent: undefined, request: 'throat closing up after eating a trail snack' });
  assert.equal(readUnderstood('NOW |'), undefined);
  assert.equal(readUnderstood(''), undefined);
});

const understandStore = (): FakePackStore => {
  const store = new FakePackStore();
  store.addPack('core-firstaid', [seed('Control severe bleeding with firm direct pressure on the wound.')]);
  store.addPack('core-fieldcards', [seed('lost and scared in the backcountry: stop, stay put, stay warm and signal for searchers', { source: 'Fred field card', section: 'Lost', domain: 'survival' })]);
  return store;
};
const understandPacks = [
  { id: 'core-firstaid', domains: ['first-aid-physical'] as const, scope: { kind: 'global' } as const },
  { id: 'core-fieldcards', domains: ['first-aid-physical', 'survival'] as const, scope: { kind: 'global' } as const },
];
/** Answers the intent check with `word` and the understanding step with `line`. */
const understanding = (line: string, word = 'QUESTION'): FakeBackend => {
  const b = new FakeBackend();
  const gen = b.generate.bind(b);
  b.generate = async function* (p, o) {
    if (p.user.startsWith('Messages:')) { yield line; return; }
    if (p.user.endsWith('->')) { yield word; return; }
    yield* gen(p, o);
  };
  return b;
};
const uOpts = { state: null, abstainThreshold: 0.3, fallbackThreshold: 0.3, intent: true, understandOwnFloor: 0.1,
  retrieval: { ...DEFAULT_RETRIEVAL, reserve: { packId: 'core-fieldcards', minScore: 0.9 } } } as const;

test('a message that means nothing alone is read with the ones before it', async () => {
  const res = await ask('pls help', { backend: understanding('NOW | lost and scared in the backcountry, what to do'), store: understandStore(), packs: understandPacks },
    { ...uOpts, history: ['i am lost and scared in the backcountry'] });
  assert.equal(res.diagnostics.understood?.used, true, JSON.stringify(res.diagnostics.understood));
  assert.equal(res.kind, 'answer');
  if (res.kind === 'answer') assert.equal(res.citations[0]!.source, 'Fred field card');
});

test('the same message with no history is not rewritten', async () => {
  const res = await ask('pls help', { backend: understanding('NOW | lost and scared in the backcountry, what to do', 'QUESTION'), store: understandStore(), packs: understandPacks }, uOpts);
  assert.equal(res.diagnostics.understood, undefined);
  assert.equal(res.kind, 'abstain');
});

test('out of scope is declined', async () => {
  const res = await ask('how do i fix it', { backend: understanding('OUT | horse lost a shoe'), store: understandStore(), packs: understandPacks },
    { ...uOpts, history: ['our horse threw a shoe'] });
  assert.equal(res.kind, 'abstain');
  if (res.kind === 'abstain') assert.equal(res.reason, 'out-of-scope');
});

test('a request that finds what the hiker never said is not used', async () => {
  // Phase 3's failure: the model makes anything sound like a manual. The
  // request finds the bleeding passage; the hiker's own words don't.
  const res = await ask('what now', { backend: understanding('QUESTION | control severe bleeding with firm direct pressure on the wound'), store: understandStore(), packs: understandPacks },
    { ...uOpts, history: ['bitcoin crashed overnight'] });
  assert.equal(res.diagnostics.understood?.used, false, JSON.stringify(res.diagnostics.understood));
  assert.notEqual(res.kind, 'answer');
});

test('an emergency that finds nothing gets the safety net, not a dead end', async () => {
  const res = await ask('a mountain lion is staring at us from the rocks', { backend: understanding('NOW | large animal staring from the rocks', 'NOW'), store: understandStore(), packs: understandPacks }, uOpts);
  assert.equal(res.kind, 'abstain');
  if (res.kind === 'abstain') assert.equal(res.reason, 'safety-net');
});

test('a pet in trouble gets no safety net', async () => {
  const res = await ask('my dog is staring at the rocks and shaking', { backend: understanding('NOW | dog shaking', 'NOW'), store: understandStore(), packs: understandPacks }, uOpts);
  assert.ok(res.kind !== 'abstain' || res.reason !== 'safety-net');
});

test('an invented word takes its intent from the intent check on the request', async () => {
  const res = await ask('pls help', { backend: understanding('LOST | scared in the backcountry, what to do', 'NOW'), store: understandStore(), packs: understandPacks },
    { ...uOpts, history: ['i am lost and scared in the backcountry'] });
  assert.equal(res.diagnostics.understood?.intent, 'now');
  assert.equal(res.kind, 'answer');
});

test('with understanding off, nothing changes', async () => {
  const d = { store: understandStore(), packs: understandPacks };
  const on = await ask('pls help', { ...d, backend: understanding('NOW | lost and scared in the backcountry, what to do') }, { ...uOpts, understand: false, history: ['i am lost and scared in the backcountry'] });
  const without = await ask('pls help', { ...d, backend: understanding('NOW | lost and scared in the backcountry, what to do') }, { ...uOpts, understand: false });
  assert.equal(on.diagnostics.understood, undefined);
  assert.equal(on.kind, without.kind);
  assert.ok(on.kind !== 'abstain' || on.reason === 'low-score');
});

test('a new statement starts its own topic; a message that points back continues it', () => {
  // The 2026-09-30 phone sequence: the CPR question must not follow the hiker.
  const phone = ["Someone isn't breathing, what do I do?", "no idea where we are anymore and i'm freaking out"];
  assert.deepEqual(currentThread("no idea where we are anymore and i'm freaking out", phone.slice(0, 1)), []);
  assert.deepEqual(currentThread('what do we do', phone), ["no idea where we are anymore and i'm freaking out"]);
  assert.deepEqual(currentThread('sliced my thumb open whittling', [...phone, 'what do we do']), []);
  assert.deepEqual(currentThread("it's dripping everywhere", [...phone, 'what do we do', 'sliced my thumb open whittling']), ['sliced my thumb open whittling']);
  // A chain of short or pointing-back messages runs back to the one that started it.
  assert.deepEqual(currentThread('what do i do', ['we stopped for lunch by the creek', 'my friend fell off a ledge', "he's not moving"]),
    ['my friend fell off a ledge', "he's not moving"]);
  assert.deepEqual(currentThread('pls help', []), []);
});

test('possessives and "there" do not tie a new statement to the last topic', () => {
  const earlier = ['flat tire on the forest road', 'how do i change it'];
  assert.deepEqual(currentThread('my hiking partner tripped and hit his head on a rock', earlier), []);
  assert.deepEqual(currentThread("there's a bear in front of me", earlier), []);
  assert.deepEqual(currentThread("he's kind of out of it", [...earlier, 'my hiking partner tripped and hit his head on a rock']),
    ['my hiking partner tripped and hit his head on a rock']);
});

// Round 2 of #98 (docs/plan-understand-2.md).
const guardStore = (): FakePackStore => {
  const store = new FakePackStore();
  store.addPack('core-firstaid', [seed('Bandage technique for the forearm.')]);
  store.addPack('core-fieldcards', [
    seed('Twisted or sprained ankle, or a strained muscle\nTreat it with RICE.\n1. Ice the ankle swelling.\n2. Wrap the ankle.', { source: 'Fred field card', section: 'Twisted or sprained ankle, or a strained muscle' }),
    seed('Snakebite\nKeep them still and get help.\n1. Keep them still.\nDon\'t put ice on it.', { source: 'Fred field card', section: 'Snakebite' }),
  ]);
  return store;
};
const guardOpts = { state: null, abstainThreshold: 0.3, fallbackThreshold: 0.3, intent: true,
  retrieval: { ...DEFAULT_RETRIEVAL, reserve: { packId: 'core-fieldcards', minScore: 0.2 } } } as const;

test('a card is never shown after a condition it must not follow; the condition card leads, with a question', async () => {
  const res = await ask('its on his ankle and swelling', { backend: understanding('NOW | ankle swelling after snakebite', 'NOW'), store: guardStore(), packs: clinicalPacks },
    { ...guardOpts, history: ['how do i tell if a snake is venomous', 'my friend just got bit by one'] });
  assert.deepEqual(res.diagnostics.conditions, ['snakebite']);
  assert.equal(res.kind, 'answer');
  if (res.kind === 'answer') {
    assert.equal(res.citations[0]!.section, 'Snakebite');
    assert.equal(res.clarify?.question, 'Is this about the snakebite?');
    assert.equal(res.diagnostics.blocked?.card, 'Twisted or sprained ankle, or a strained muscle');
  }
});

test('the same card with no condition is shown as before', async () => {
  const res = await ask('its on his ankle and swelling', { backend: understanding('NOW | ankle swelling', 'NOW'), store: guardStore(), packs: clinicalPacks },
    { ...guardOpts, history: ['i rolled my ankle on a rock'] });
  assert.equal(res.diagnostics.conditions, undefined);
  if (res.kind === 'answer') assert.equal(res.citations[0]!.section, 'Twisted or sprained ankle, or a strained muscle');
});

test('with guards off, the block is off', async () => {
  const res = await ask('its on his ankle and swelling', { backend: understanding('NOW | ankle swelling after snakebite', 'NOW'), store: guardStore(), packs: clinicalPacks },
    { ...guardOpts, guards: false, history: ['how do i tell if a snake is venomous', 'my friend just got bit by one'] });
  assert.equal(res.diagnostics.blocked, undefined);
});

test('something wrong with no danger sign gets the watch reply, not the get-help-now one', async () => {
  const res = await ask('my knee is killing me going downhill', { backend: understanding('NOW | knee pain downhill', 'NOW'), store: understandStore(), packs: understandPacks }, uOpts);
  assert.equal(res.kind, 'abstain');
  if (res.kind === 'abstain') assert.equal(res.reason, 'watch');
});

test('a question is never small talk, even when the understanding step says CHAT', async () => {
  const res = await ask('how much water', { backend: understanding('CHAT | how much water for a day hike', 'CHAT'), store: understandStore(), packs: understandPacks },
    { ...uOpts, history: ['what should i bring for a day hike'] });
  assert.notEqual(res.kind, 'chat');
});

// #109: a specific question answered from a card's own lines.
const leadBackend = (): FakeBackend => {
  const b = new FakeBackend();
  const gen = b.generate.bind(b);
  b.generate = async function* (p, o) {
    if (p.user.startsWith('Messages:')) { yield 'NOW | snakebite, ice'; return; }
    if (p.user.endsWith('->')) { yield 'QUESTION'; return; }
    yield* gen(p, o);
  };
  return b;
};
const leadOpts = { state: null, abstainThreshold: 0.05, fallbackThreshold: 0.05, intent: true,
  retrieval: { ...DEFAULT_RETRIEVAL, reserve: { packId: 'core-fieldcards', minScore: 0.05 } } } as const;
const ICE_Q = 'can i put ice on the snakebite';
/** The card's two lines: `close` marks the ones pointing the way the question does. */
const leadStore = async (b: FakeBackend, close: readonly boolean[]) => {
  const store = new FakePackStore();
  store.addPack('core-firstaid', [seed('Bandage technique for the forearm.')]);
  store.addPack('core-fieldcards', [seed("Snakebite\nKeep them still and get help.\n1. Keep them still.\nDon't put ice on it.", { source: 'Fred field card', section: 'Snakebite' })]);
  const q = await b.embed(applyQueryTemplate(b.embeddingSpec().queryTemplate, ICE_Q));
  const rows = close.map((c) => quantizeInt8(q.map((x) => (c ? x : -x))).vec);
  return Object.assign(store, { cardLineVectorsFor: () => rows });
};

test('a specific question about a card gets the card lines that answer it, the card folded', async () => {
  const b = leadBackend();
  const res = await ask(ICE_Q, { backend: b, store: await leadStore(b, [false, true]), packs: clinicalPacks },
    { ...leadOpts, history: ['a snake bit my friend'] });
  assert.equal(res.kind, 'answer');
  if (res.kind === 'answer') {
    assert.equal(res.card?.title, 'Snakebite');
    assert.equal(await readAll(res.stream), "Keep them still and get help.\nDon't put ice on it.");
  }
});

test('no line close enough: the card itself, open', async () => {
  const b = leadBackend();
  const res = await ask(ICE_Q, { backend: b, store: await leadStore(b, [false, false]), packs: clinicalPacks },
    { ...leadOpts, history: ['a snake bit my friend'] });
  if (res.kind === 'answer') {
    assert.equal(res.card, undefined);
    assert.match(await readAll(res.stream), /1\. Keep them still/);
  } else assert.fail(res.kind);
});

const readAll = async (s: AsyncIterable<string>): Promise<string> => { let t = ''; for await (const x of s) t += x; return t; };
test('with LEAD off, the card itself is the answer', async () => {
  const b = leadBackend();
  const res = await ask(ICE_Q, { backend: b, store: await leadStore(b, [false, true]), packs: clinicalPacks },
    { ...leadOpts, lead: false, history: ['a snake bit my friend'] });
  if (res.kind === 'answer') assert.equal(res.card, undefined);
});

// #23: the model declines a question the search chose to answer.
class Declines extends FakeBackend {
  override async *generate(): AsyncIterable<string> { yield "I don't have reliable "; yield 'information on that.'; }
}
function declineStore(): FakePackStore {
  const store = new FakePackStore();
  store.addPack('core-survival', [seed('To get a fire going in the rain with wet wood, find standing dead wood: it stays dry in rain.', { domain: 'survival' })]);
  store.addPack('core-fieldcards', [seed('Starting a fire\nLay dry tinder on a dry base.\n1. Add wood from small to large.', { source: 'Fred field card', section: 'Starting a campfire', domain: 'survival' })]);
  return store;
}
const textOf = async (s: AsyncIterable<string>): Promise<string> => { let o = ''; for await (const x of s) o += x; return o; };
const declinePacks = [
  { id: 'core-survival', domains: ['survival'] as const, scope: { kind: 'global' } as const },
  { id: 'core-fieldcards', domains: ['survival'] as const, scope: { kind: 'global' } as const },
];
test('a model decline shows the field card it was handed, said to be the closest (#23)', async () => {
  const q = 'how do i get a fire going with wet wood in the rain';
  const optsFor = (closestCard: boolean) => ({
    // The card is a source for the model here, not shown word for word.
    state: null, abstainThreshold: 0, closestCard, cardAnswer: 'off' as const,
    retrieval: { ...DEFAULT_RETRIEVAL, reserve: { packId: 'core-fieldcards', minScore: 2 } },
  });
  const on = await ask(q, { backend: new Declines(), store: declineStore(), packs: declinePacks }, optsFor(true));
  assert.equal(on.kind, 'answer');
  if (on.kind !== 'answer') return;
  const card = on.diagnostics.candidates.find((c) => c.chunk.packId === 'core-fieldcards');
  assert.ok(card !== undefined && card.score >= CLOSEST_CARD_FLOOR, `card score ${card?.score}`);
  const text = await textOf(on.stream);
  assert.ok(text.startsWith(CLOSEST_CARD_LEAD), text);
  assert.match(text, /dry tinder on a dry base/i);
  assert.deepEqual(on.diagnostics.answerGuard, { refused: true, replacedBy: 'card' });

  const off = await ask(q, { backend: new Declines(), store: declineStore(), packs: declinePacks }, optsFor(false));
  assert.equal(off.kind, 'answer');
  if (off.kind === 'answer') assert.equal(await textOf(off.stream), "I don't have reliable information on that.");
});

test('an answer the model did write is never touched by the closest-card step (#23)', async () => {
  const res = await ask('how do i get a fire going with wet wood in the rain', { backend: new FakeBackend(), store: declineStore(), packs: declinePacks }, {
    state: null, abstainThreshold: 0, cardAnswer: 'off', retrieval: { ...DEFAULT_RETRIEVAL, reserve: { packId: 'core-fieldcards', minScore: 2 } },
  });
  assert.equal(res.kind, 'answer');
  if (res.kind === 'answer') { assert.equal(await textOf(res.stream), 'FAKE ANSWER'); assert.deepEqual(res.diagnostics.answerGuard, {}); }
});

// #23: a search under the gate whose passages hold a sentence close to the question.
test('under the gate, a sentence close to the question is quoted; a distant one is not (#23)', async () => {
  const q = 'how far from the lake do i dig a cathole';
  const passage = 'Dispose of waste properly on every trip.\nTo dig a cathole, walk 200 feet from any lake or stream.';
  const make = (closeTo: string): FakePackStore => {
    const store = new FakePackStore();
    store.addPack('core-survival', [seed(passage, { domain: 'survival', source: 'National Park Service' })]);
    const row = (t: string): Int8Array => quantizeInt8(truncateVector(fakeEmbed(t))).vec;
    return Object.assign(store, { sentenceVectorsFor: () => [row('nothing alike zzz'), row(closeTo)] });
  };
  const packs = [{ id: 'core-survival', domains: ['survival'] as const, scope: { kind: 'global' } as const }];
  // The gate is set above any score, so the search is declined.
  const near = await ask(q, { backend: new FakeBackend(), store: make(q), packs }, { state: null, abstainThreshold: 5, fallbackThreshold: 5 });
  assert.equal(near.kind, 'answer');
  if (near.kind !== 'answer') return;
  assert.equal(await textOf(near.stream), "Here's what the National Park Service says:\nTo dig a cathole, walk 200 feet from any lake or stream.");
  assert.equal(near.diagnostics.answerGuard?.replacedBy, 'near-quote');
  assert.ok((near.diagnostics.nearSentence?.similarity ?? 0) >= UNDER_GATE_QUOTE_FLOOR);

  const far = await ask(q, { backend: new FakeBackend(), store: make('bears wolves moose elk bison'), packs }, { state: null, abstainThreshold: 5, fallbackThreshold: 5 });
  assert.equal(far.kind, 'abstain');
  const off = await ask(q, { backend: new FakeBackend(), store: make(q), packs }, { state: null, abstainThreshold: 5, fallbackThreshold: 5, quoteUnderGate: false });
  assert.equal(off.kind, 'abstain');

  // Read as urgent, with no danger sign: the sentence comes before the watch reply.
  const urgent = { backend: understanding('NOW | cathole distance from lake', 'NOW'), store: make(q), packs };
  const now = await ask(q, urgent, { ...uOpts, state: null, abstainThreshold: 5, fallbackThreshold: 5 });
  assert.equal(now.kind, 'answer');
  if (now.kind === 'answer') assert.equal(now.diagnostics.answerGuard?.replacedBy, 'near-quote');
  const watch = await ask(q, { ...urgent, backend: understanding('NOW | cathole distance from lake', 'NOW') }, { ...uOpts, state: null, abstainThreshold: 5, fallbackThreshold: 5, quoteBeforeWatch: false });
  assert.equal(watch.kind === 'abstain' && watch.reason, 'watch');
  // A danger sign keeps the get-help-now reply.
  const danger = await ask(`he is not breathing. ${q}`, { ...urgent, backend: understanding('NOW | not breathing', 'NOW'), store: make(`he is not breathing. ${q}`) }, { ...uOpts, state: null, abstainThreshold: 5, fallbackThreshold: 5 });
  assert.equal(danger.kind === 'abstain' && danger.reason, 'safety-net');
});
