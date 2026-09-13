/**
 * Off-device tests for the parts of the device PackStore that are pure.
 *
 * device-pack.ts itself cannot run under Node — it imports op-sqlite, llama.rn
 * and expo-file-system — so the byte handling it depends on lives here instead,
 * where it is typechecked and tested. That is exactly the code whose bugs would
 * be silent: a wrong base64 decode or a wrong row offset does not throw, it
 * returns confidently wrong neighbours.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeBase64 } from '../src/base64.ts';
import { quantizeInt8, vectorRow, cosineInt8 } from '../src/score.ts';

test('base64 decode round-trips arbitrary bytes', () => {
  const bytes = new Uint8Array(512);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37) % 256;
  const b64 = Buffer.from(bytes).toString('base64');
  const back = decodeBase64(b64);
  assert.equal(back.byteLength, bytes.byteLength);
  assert.deepEqual([...back], [...bytes]);
});

test('base64 decode preserves high bytes that become negative INT8', () => {
  // vectors.i8 is signed; byte 0x80..0xFF must survive as -128..-1, and a
  // charCodeAt-based decode is where that silently breaks.
  const bytes = Uint8Array.from([0x00, 0x7f, 0x80, 0xff, 0x81]);
  const back = decodeBase64(Buffer.from(bytes).toString('base64'));
  const signed = new Int8Array(back.buffer, back.byteOffset, back.length);
  assert.deepEqual([...signed], [0, 127, -128, -1, -127]);
});

test('vectorRow returns the requested row, not a neighbour', () => {
  const dim = 8;
  const rows = 5;
  const buf = new Uint8Array(dim * rows);
  for (let r = 0; r < rows; r++) for (let i = 0; i < dim; i++) buf[r * dim + i] = r + 1;
  for (let r = 0; r < rows; r++) {
    assert.deepEqual([...vectorRow(buf, r, dim)], Array(dim).fill(r + 1), `row ${r}`);
  }
});

test('vectorRow is a view, so no copy is made per candidate', () => {
  const buf = new Uint8Array(16);
  const row = vectorRow(buf, 1, 8);
  row[0] = 42;
  assert.equal(buf[8], 42, 'writing through the view must reach the backing buffer');
});

test('vectorRow rejects an out-of-range ordinal instead of aliasing', () => {
  const buf = new Uint8Array(16);
  assert.throws(() => vectorRow(buf, 2, 8), /past buffer length/);
  assert.throws(() => vectorRow(buf, -1, 8), /non-negative/);
  assert.throws(() => vectorRow(buf, 1.5, 8), /integer/);
});

test('a pack round-trip preserves similarity end to end', () => {
  // Quantize -> pack into a flat buffer -> base64 -> decode -> slice -> score,
  // which is the full path a vector takes from ingest to on-device retrieval.
  const dim = 64;
  const make = (seed: number): Float32Array =>
    Float32Array.from({ length: dim }, (_, i) => Math.sin(seed * (i + 1)));
  const originals = [make(1), make(2), make(3)];

  const flat = new Uint8Array(dim * originals.length);
  originals.forEach((v, i) => flat.set(new Uint8Array(quantizeInt8(v).vec.buffer), i * dim));

  const decoded = decodeBase64(Buffer.from(flat).toString('base64'));
  originals.forEach((v, i) => {
    const row = vectorRow(decoded, i, dim);
    assert.ok(cosineInt8(v, row) >= 0.99, `row ${i} similarity ${cosineInt8(v, row)}`);
  });
  // And a different row must NOT match, which is what an off-by-one would break.
  assert.ok(cosineInt8(originals[0]!, vectorRow(decoded, 1, dim)) < 0.9);
});
