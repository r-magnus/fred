import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { latLngToCell, gridDisk } from 'h3-js';
import { encodeCells, decodeCells, COVERAGE_RES } from '../src/coverage-entry.ts';

const area = (k: number): string[] =>
  gridDisk(latLngToCell(37.8651, -119.5383, COVERAGE_RES), k);

test('a round trip returns exactly what went in', () => {
  const cells = area(4);
  assert.deepEqual(decodeCells(encodeCells(cells)).sort(), [...cells].sort());
});

test('input order does not matter, because encoding sorts', () => {
  const cells = area(3);
  const shuffled = [...cells].reverse();
  assert.deepEqual(decodeCells(encodeCells(shuffled)), decodeCells(encodeCells(cells)));
});

test('an empty pack round-trips rather than throwing', () => {
  assert.deepEqual(decodeCells(encodeCells([])), []);
});

test('a single cell survives, which the delta scheme could easily break', () => {
  const one = [latLngToCell(37.8651, -119.5383, COVERAGE_RES)];
  assert.deepEqual(decodeCells(encodeCells(one)), one);
});

test('64-bit ids survive; Number would silently round them', () => {
  // A res-7 H3 index exceeds Number.MAX_SAFE_INTEGER, so the codec uses BigInt.
  const cell = latLngToCell(37.8651, -119.5383, COVERAGE_RES);
  assert.ok(BigInt(`0x${cell}`) > BigInt(Number.MAX_SAFE_INTEGER));
  assert.deepEqual(decodeCells(encodeCells([cell])), [cell]);
});

test('gzipped deltas beat gzipped JSON by a wide margin', () => {
  // The whole reason for this format. Contiguous coverage means tiny, repeating
  // gaps, which gzip crushes; the raw ids do not compress nearly as well.
  const cells = area(12);
  const deltas = gzipSync(encodeCells(cells)).length;
  const json = gzipSync(Buffer.from(JSON.stringify(cells))).length;
  assert.ok(deltas * 4 < json, `deltas ${deltas} vs json ${json}`);
});
