import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChunkRecord } from '@fred/pack-format';
import { ask, maxTokensForPressure, DEFAULT_ABSTAIN_THRESHOLD } from '../src/pipeline.ts';
import { assertCompatibleEmbedding } from '../src/retrieve.ts';
import { route } from '../src/router.ts';
import { extractKeywords } from '../src/lexicon.ts';
import { SYSTEM_PREFIX } from '../src/prompt.ts';
import { FakeBackend, FakePackStore, FAKE_SPEC } from './fakes.ts';

type Seed = Omit<ChunkRecord, 'id' | 'packId' | 'ordinal'>;
const seed = (text: string, over: Partial<Seed> = {}): Seed => ({
  text, section: 'sec', source: 'WHO BEC 2018', page: 10,
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
  assert.ok(prompt.includes('[1]'), 'sources must be numbered for citation');
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
  assert.deepEqual(r.packIds, []);
  assert.ok(r.reason.includes('outside OH'));
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

test('mixing packs built with a different encoder throws instead of scoring nonsense', () => {
  const store = buildStore();
  store.addPack('bad-pack', [seed('text')], { ...FAKE_SPEC, modelId: 'other/encoder' });
  assert.throws(
    () => assertCompatibleEmbedding(['core-firstaid', 'bad-pack'], store, new FakeBackend()),
    /was built with other\/encoder/,
  );
});
