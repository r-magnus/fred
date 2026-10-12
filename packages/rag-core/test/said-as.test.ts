import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noCardKind, noCardShare, saidAs, type SaidAsModel } from '../src/said-as.ts';

/** Two labels over two dimensions: int8 rows (127, 0) and (0, 127). */
const model: SaidAsModel = {
  labels: ['Burns', 'none:pet'], dim: 2,
  w: Buffer.from(new Int8Array([127, 0, 0, 127]).buffer).toString('base64'),
  scales: [1 / 127, 2 / 127], b: [0, -1], scale: 4, sure: 0.6, leans: 0.4,
};

test('saidAs: each label gets a share, largest first, and the shares add up to 1', () => {
  const said = saidAs(model, new Float32Array([3, 4]));
  // (3, 4) at length 4 is (2.4, 3.2): z = 2.4 for Burns, 2 * 3.2 - 1 = 5.4 for the pet.
  assert.deepEqual(said.map((s) => s.label), ['none:pet', 'Burns']);
  assert.ok(Math.abs(said[0]!.p - 1 / (1 + Math.exp(2.4 - 5.4))) < 1e-6);
  assert.ok(Math.abs(said[0]!.p + said[1]!.p - 1) < 1e-9);
});

test("saidAs: the vector's own length does not matter", () => {
  const a = saidAs(model, new Float32Array([3, 4]));
  const b = saidAs(model, new Float32Array([30, 40]));
  assert.ok(Math.abs(a[0]!.p - b[0]!.p) < 1e-6);
});

test('noCardKind: a none label names its kind, a card has none', () => {
  assert.equal(noCardKind('none:pet'), 'pet');
  assert.equal(noCardKind('Burns'), undefined);
});

test("noCardShare: the no-card kinds add up, a fragment is left out", () => {
  const said = [
    { label: 'none:other', p: 0.4 }, { label: 'Burns', p: 0.2 }, { label: 'none:chat', p: 0.2 },
    { label: 'none:fragment', p: 0.15 }, { label: 'Snakebite', p: 0.05 },
  ];
  assert.ok(Math.abs(noCardShare(said) - 0.6) < 1e-9);
});
