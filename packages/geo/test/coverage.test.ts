import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latLngToCell, gridDisk, cellToParent } from 'h3-js';
import {
  COVERAGE_RES, toCoverageIndex, nearestCoverage, describeBearing,
} from '../src/coverage-entry.ts';

// Yosemite Valley, already used by states.test.ts, so no real position enters
// the repo from a coverage test either.
const HOME = latLngToCell(37.8651, -119.5383, COVERAGE_RES);

test('source cells collapse to their res-7 parents', () => {
  // The FCC publishes res 9; storage and search happen at res 7.
  const res9 = gridDisk(latLngToCell(37.8651, -119.5383, 9), 1);
  const idx = toCoverageIndex(res9);
  for (const c of idx) assert.equal(cellToParent(c, COVERAGE_RES), c);
  // Seven neighbouring res-9 cells sit under far fewer res-7 parents.
  assert.ok(idx.size < res9.length);
});

test('a covered origin needs no walk at all', () => {
  const r = nearestCoverage(HOME, new Set([HOME]));
  assert.notEqual(r, null);
  assert.equal(r!.rings, 0);
  assert.equal(r!.meters, 0);
  assert.equal(r!.cell, HOME);
});

test('finds coverage one ring out and reports a usable distance', () => {
  const neighbour = gridDisk(HOME, 1).find((c) => c !== HOME)!;
  const r = nearestCoverage(HOME, new Set([neighbour]));
  assert.notEqual(r, null);
  assert.equal(r!.rings, 1);
  // One ring is roughly a cell's width; res 7 edges are ~1.2 km.
  assert.ok(r!.meters > 500 && r!.meters < 4000, `got ${r!.meters} m`);
  assert.ok(r!.bearing >= 0 && r!.bearing < 360);
});

test('picks the nearest when several rings are covered', () => {
  const near = gridDisk(HOME, 1).find((c) => c !== HOME)!;
  const far = gridDisk(HOME, 5).find((c) => !gridDisk(HOME, 4).includes(c))!;
  const r = nearestCoverage(HOME, new Set([far, near]));
  assert.equal(r!.cell, near);
  assert.equal(r!.rings, 1);
});

test('returns null rather than inventing a direction', () => {
  // "No reported coverage within N km" is the honest answer, and B-KR3 is a
  // trust feature before it is a navigation one.
  assert.equal(nearestCoverage(HOME, new Set()), null);
  const far = gridDisk(HOME, 9).find((c) => !gridDisk(HOME, 8).includes(c))!;
  assert.equal(nearestCoverage(HOME, new Set([far]), 3), null);
});

test('collects surrounding covered cells for shading, not just the winner', () => {
  const ring1 = gridDisk(HOME, 1).filter((c) => c !== HOME);
  const r = nearestCoverage(HOME, new Set(ring1));
  assert.ok(r!.covered.length > 1, 'map needs a region, not one hexagon');
  for (const c of r!.covered) assert.ok(ring1.includes(c));
});

test('covered cells are never reported twice', () => {
  // gridDisk(k) contains gridDisk(k-1), so a naive loop double-counts.
  const ring = gridDisk(HOME, 2).filter((c) => c !== HOME);
  const r = nearestCoverage(HOME, new Set(ring));
  assert.equal(new Set(r!.covered).size, r!.covered.length);
});

test('bearings become words someone can act on', () => {
  assert.equal(describeBearing(0), 'north');
  assert.equal(describeBearing(90), 'east');
  assert.equal(describeBearing(180), 'south');
  assert.equal(describeBearing(270), 'west');
  assert.equal(describeBearing(315), 'north-west');
  assert.equal(describeBearing(359), 'north');
  assert.equal(describeBearing(-90), 'west');
});
