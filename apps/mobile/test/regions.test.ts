import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  edgeAhead, kmToLine, labelPoint, placeKey, regionAt, roughKm, splitKey, type RegionOutlines,
} from '../src/regions.ts';

// Two squares side by side, one degree each, sharing the line lon = -119,
// and an island off the west one.
const TWO: RegionOutlines = {
  schemaVersion: 1,
  state: 'XX',
  regions: [
    { id: 'west', name: 'West', rings: [
      [-120, 36, -119, 36, -119, 37, -120, 37, -120, 36],
      [-121, 36.4, -120.8, 36.4, -120.8, 36.6, -121, 36.6, -121, 36.4],
    ] },
    { id: 'east', name: 'East', rings: [[-119, 36, -118, 36, -118, 37, -119, 37, -119, 36]] },
  ],
  edges: [{ a: 'east', b: 'west', line: [-119, 36, -119, 37] }],
};

test('a place is a state or a state and region, and splits back', () => {
  assert.equal(placeKey('NV'), 'NV');
  assert.equal(placeKey('CA', 'south'), 'CA/south');
  assert.deepEqual(splitKey('CA/south'), { state: 'CA', region: 'south' });
  assert.deepEqual(splitKey('NV'), { state: 'NV', region: null });
});

test('a position is in the region whose outline holds it, islands included', () => {
  assert.equal(regionAt(TWO, -119.5, 36.5)?.id, 'west');
  assert.equal(regionAt(TWO, -118.5, 36.5)?.id, 'east');
  assert.equal(regionAt(TWO, -120.9, 36.5)?.id, 'west');
  assert.equal(regionAt(TWO, -122, 36.5), null);
});

test('distance to a line is measured in kilometres, not degrees', () => {
  // A tenth of a degree of longitude at 36.5° is about 8.95 km.
  const km = kmToLine(-119.1, 36.5, [-119, 36, -119, 37]);
  assert.ok(Math.abs(km - 8.95) < 0.1, `got ${km}`);
  // Past the end of the line, the distance is to its end.
  assert.ok(Math.abs(kmToLine(-119, 37.1, [-119, 36, -119, 37]) - 11.06) < 0.1);
});

test('the edge warning comes near a border to a region that is not downloaded', () => {
  const near = edgeAhead(TWO, -119.05, 36.5, new Set(['west']));
  assert.equal(near?.from.id, 'west');
  assert.equal(near?.to.id, 'east');
  assert.ok(near !== null && near.km > 4 && near.km < 5);
});

test('no edge warning far from the border, with both sides downloaded, or outside what is downloaded', () => {
  assert.equal(edgeAhead(TWO, -119.8, 36.5, new Set(['west'])), null, 'about 72 km away');
  assert.equal(edgeAhead(TWO, -119.05, 36.5, new Set(['west', 'east'])), null);
  assert.equal(edgeAhead(TWO, -118.95, 36.5, new Set(['west'])), null, 'in East, which is not downloaded');
  assert.equal(edgeAhead(TWO, -122, 36.5, new Set(['west'])), null);
});

test('the warning distance can be changed', () => {
  assert.notEqual(edgeAhead(TWO, -119.8, 36.5, new Set(['west']), 80), null);
});

test('distances are said roughly', () => {
  assert.equal(roughKm(0.4), 'under 1 km');
  assert.equal(roughKm(7.6), 'about 8 km');
});

test('a region\'s name goes inside its biggest ring, away from the edges', () => {
  const [x, y] = labelPoint(TWO.regions[0]!);
  assert.equal(regionAt(TWO, x, y)?.id, 'west');
  assert.ok(x > -119.8 && x < -119.2 && y > 36.2 && y < 36.8, `got ${x}, ${y}`);
});

// The real California outlines, when they have been built
// (scripts/build-state-regions.mjs). Skipped on a checkout without them.
const CA_FILE = new URL('../../../dist/regions/CA/regions-CA.json', import.meta.url);
test('California: known places fall in the region a Californian would name', { skip: !existsSync(CA_FILE) }, () => {
  const ca = JSON.parse(readFileSync(CA_FILE, 'utf8')) as RegionOutlines;
  const at = (lon: number, lat: number): string | undefined => regionAt(ca, lon, lat)?.id;
  assert.equal(at(-118.2437, 34.0522), 'south', 'Los Angeles');
  assert.equal(at(-117.1611, 32.7157), 'south', 'San Diego');
  assert.equal(at(-122.4194, 37.7749), 'bay', 'San Francisco');
  assert.equal(at(-121.8947, 36.6002), 'bay', 'Monterey');
  assert.equal(at(-119.5383, 37.8651), 'sierra', 'Yosemite Valley');
  assert.equal(at(-121.4944, 38.5816), 'sierra', 'Sacramento');
  assert.equal(at(-122.3917, 40.5865), 'north', 'Redding');
  assert.equal(at(-124.1637, 40.8021), 'north', 'Eureka');
  // Every region's label point is inside that region.
  for (const r of ca.regions) {
    const [x, y] = labelPoint(r);
    assert.equal(regionAt(ca, x, y)?.id, r.id, r.name);
  }
  // Gorman, in Los Angeles County a few km below the Kern County line: with
  // only Southern California, the Sierra and Central Valley border is close.
  const have = new Set(['south']);
  const gorman = edgeAhead(ca, -118.7926, 34.7958, have);
  assert.equal(gorman?.to.id, 'sierra');
  assert.ok(gorman !== null && gorman.km < 10, `got ${gorman?.km}`);
  // Big Bear is far from any other region: no warning.
  assert.equal(edgeAhead(ca, -116.911, 34.2439, have), null);
  // With the Sierra region too, Gorman has nothing missing nearby.
  assert.equal(edgeAhead(ca, -118.7926, 34.7958, new Set(['south', 'sierra'])), null);
});
