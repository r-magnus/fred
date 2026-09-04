import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chunkTermSet, cosineInt8, dequantizeInt8, fuse, lexicalScore, quantizeInt8, DEFAULT_ALPHA,
} from '../src/score.ts';
import { extractKeywords } from '../src/lexicon.ts';
import { fakeEmbed } from './fakes.ts';

test('fuse matches PocketRAG Eq. 3 by hand', () => {
  // U = 0.6 * 0.8 + 0.4 * 0.5 = 0.48 + 0.20 = 0.68
  assert.equal(Number(fuse(0.8, 0.5, 0.6).toFixed(10)), 0.68);
  // alpha = 1 is pure semantic; alpha = 0 is pure lexical
  assert.equal(fuse(0.9, 0.1, 1), 0.9);
  assert.equal(fuse(0.9, 0.1, 0), 0.1);
  assert.equal(DEFAULT_ALPHA, 0.6);
});

test('fuse clamps a negative cosine so lexical evidence is not cancelled', () => {
  // Without clamping this would be 0.6*(-1) + 0.4*1 = -0.2, ranking a perfect
  // keyword match below an unrelated chunk.
  assert.equal(Number(fuse(-1, 1, 0.6).toFixed(10)), 0.4);
});

test('lexicalScore reduces to |K_q n W_c| / |K_q| when weights are equal', () => {
  const kws = ['alpha', 'beta', 'gamma', 'delta'].map((term) => ({
    term, weight: 1, isDomainTerm: false,
  }));
  assert.equal(lexicalScore(kws, new Set(['alpha', 'beta'])), 0.5);
  assert.equal(lexicalScore(kws, new Set(['alpha', 'beta', 'gamma', 'delta'])), 1);
  assert.equal(lexicalScore(kws, new Set(['zeta'])), 0);
});

test('lexicalScore stays in [0,1] with domain weighting', () => {
  const kws = extractKeywords('severe bleeding from a leg wound');
  const s = lexicalScore(kws, chunkTermSet('Control bleeding by direct pressure on the wound.'));
  assert.ok(s > 0 && s <= 1, `expected (0,1], got ${s}`);
});

test('lexicalScore is defined for a query with no domain vocabulary', () => {
  const kws = extractKeywords('what should someone do about that thing');
  assert.ok(kws.length > 0, 'content words must survive stopword removal');
  const s = lexicalScore(kws, chunkTermSet('unrelated text'));
  assert.ok(Number.isFinite(s) && s >= 0, 'must not be NaN from a 0/0 division');
});

test('INT8 round-trip keeps cosine >= 0.99 (ingest tolerance)', () => {
  for (const phrase of ['control severe bleeding', 'start a fire with tinder', 'black bear encounter']) {
    const v = fakeEmbed(phrase, 384);
    const { vec: row, scale } = quantizeInt8(v);
    assert.ok(cosineInt8(v, row) >= 0.99, `${phrase}: cosine ${cosineInt8(v, row)}`);
    const back = dequantizeInt8(row, scale);
    for (let i = 0; i < v.length; i++) {
      assert.ok(Math.abs((back[i] as number) - (v[i] as number)) <= scale, 'within one quantization step');
    }
  }
});

test('cosine ranking is invariant to the per-row INT8 scale', () => {
  const q = fakeEmbed('tourniquet application', 64);
  const c = fakeEmbed('apply a tourniquet above the wound', 64);
  const a = quantizeInt8(c);
  const scaled = new Float32Array(c.map((x) => x * 37.5));
  const b = quantizeInt8(scaled);
  assert.ok(Math.abs(cosineInt8(q, a.vec) - cosineInt8(q, b.vec)) < 1e-9);
});

test('cosineInt8 rejects a dimension mismatch instead of scoring garbage', () => {
  assert.throws(() => cosineInt8(new Float32Array(4), new Int8Array(8)), /dim mismatch/);
});
