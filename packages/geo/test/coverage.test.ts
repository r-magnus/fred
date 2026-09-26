import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latLngToCell, gridDisk, cellToParent } from 'h3-js';
import {
  COVERAGE_RES, toCoverageIndex, nearestCoverage, describeBearing,
  zoneOf, zonesNear, anyCarrier, carrierCells, type CoveragePack,
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

// Issue #58: two warning zones. AT&T covers HOME and its first ring; Verizon
// covers only HOME's ring-2 band; beyond ring 2 nobody reports anything.
const ring = (k: number): string[] => gridDisk(HOME, k).filter((c) => !gridDisk(HOME, k - 1).includes(c));
const PACK: CoveragePack = { asOf: '2025-12-31', carriers: [
  { id: '130077', name: 'AT&T', cells: new Set(gridDisk(HOME, 1)) },
  { id: '131425', name: 'Verizon', cells: new Set(ring(2)) },
] };
const ATT = '130077', VZW = '131425';
const everywhere = (): boolean => true;

test('no carrier at all is no-service, whoever the user is with', () => {
  const far = ring(3)[0]!;
  for (const who of [ATT, VZW, null]) assert.equal(zoneOf(far, PACK, who), 'no-service');
});

test('your carrier missing where another reports is a carrier gap', () => {
  assert.equal(zoneOf(HOME, PACK, VZW), 'carrier-gap');
  assert.equal(zoneOf(ring(2)[0]!, PACK, ATT), 'carrier-gap');
  assert.equal(zoneOf(HOME, PACK, ATT), 'covered');
});

test('an unknown carrier gets only the no-service warning', () => {
  // With no carrier, a gap cannot be claimed: absence of your carrier is unknowable.
  assert.equal(zoneOf(HOME, PACK, null), 'covered');
  assert.equal(zoneOf(ring(2)[0]!, PACK, null), 'covered');
  // Same for a carrier that files nothing in this state and roams here.
  assert.equal(zoneOf(HOME, PACK, '999999'), 'covered');
  assert.equal(carrierCells(PACK, '999999'), null);
});

test('zonesNear splits the neighbourhood into the two warnings', () => {
  const z = zonesNear(HOME, PACK, VZW, everywhere, 3);
  assert.deepEqual([...z.carrierGap].sort(), [...gridDisk(HOME, 1)].sort());
  assert.deepEqual([...z.noService].sort(), [...ring(3)].sort());
  const unknown = zonesNear(HOME, PACK, null, everywhere, 3);
  assert.equal(unknown.carrierGap.length, 0);
  assert.equal(unknown.noService.length, ring(3).length);
});

test('nothing is claimed outside the area the pack describes', () => {
  // Outside the state, a missing cell is missing data, not a dead zone.
  const z = zonesNear(HOME, PACK, VZW, () => false, 3);
  assert.equal(z.carrierGap.length + z.noService.length, 0);
});

test('anyCarrier is the union, which is what 911 depends on', () => {
  const u = anyCarrier(PACK);
  assert.equal(u.size, gridDisk(HOME, 2).length);
  assert.equal(anyCarrier(PACK), u, 'computed once per pack');
});
