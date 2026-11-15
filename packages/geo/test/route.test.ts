import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { planRoute, type RouteSources, type TileReader } from '../src/route/index.ts';
import { clipPolyline, buildNetwork } from '../src/route/trails.ts';
import { buildGrid, heightAt, cellAt, COVER, CELL_BLOCKED } from '../src/route/terrain.ts';
import { climb, toblerSpeed, trailTime, MAX_TRAIL_GRADE } from '../src/route/cost.ts';
import { decodeTile, type TileFeature } from '../src/route/mvt.ts';
import { lonLatToWorld, worldToLonLat, metersPerUnit, WORLD_EXTENT } from '../src/route/tiles.ts';

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'route');

function fixtureReader(dir: string, sub: string): TileReader {
  return async (z, x, y) => {
    const f = path.join(dir, sub, `${z}-${x}-${y}.mvt.gz`);
    return fs.existsSync(f) ? new Uint8Array(zlib.gunzipSync(fs.readFileSync(f))) : null;
  };
}

function fixture(name: string): { sources: RouteSources; from: { lat: number; lon: number }; to: { lat: number; lon: number } } {
  const dir = path.join(FIXTURES, name);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'route.json'), 'utf8'));
  return { sources: { basemap: fixtureReader(dir, 'basemap'), contours: fixtureReader(dir, 'contours') }, from: meta.from, to: meta.to };
}

const path_ = (coords: Array<[number, number]>, tags: Record<string, string> = { kind: 'path', kind_detail: 'path' }): TileFeature =>
  ({ type: 2, tags, geometry: [coords] });

// ---------------------------------------------------------------- projection

test('world units round-trip to lon/lat', () => {
  const [x, y] = lonLatToWorld(-119.5383, 37.8651);
  const [lon, lat] = worldToLonLat(x, y);
  assert.ok(Math.abs(lon + 119.5383) < 1e-9 && Math.abs(lat - 37.8651) < 1e-9);
});

// ---------------------------------------------------------------- cost model

test("Tobler: fastest on a gentle descent, about 5 km/h on the flat", () => {
  assert.ok(Math.abs(toblerSpeed(-0.05) * 3.6 - 6) < 1e-9);
  assert.ok(Math.abs(toblerSpeed(0) * 3.6 - 5.04) < 0.01);
  assert.ok(toblerSpeed(0.2) < toblerSpeed(0) && toblerSpeed(-0.3) < toblerSpeed(-0.05));
});

test('trail time caps the grade, so a wrong height on a trail cannot make it a wall', () => {
  assert.equal(trailTime(100, 300, 'path'), trailTime(100, 100 * MAX_TRAIL_GRADE, 'path'));
  assert.ok(trailTime(100, 0, 'steps') > trailTime(100, 0, 'path'));
});

test('climb ignores wiggles smaller than the noise floor', () => {
  assert.deepEqual(climb([100, 105, 98, 104, 100]), { up: 0, down: 0 });
  assert.deepEqual(climb([100, 120, 140, 130, 160]), { up: 60, down: 0 });
  assert.deepEqual(climb([200, 150, 100]), { up: 0, down: 100 });
});

// ---------------------------------------------------------------- trails

test('clipping keeps only the part inside the tile', () => {
  const pieces = clipPolyline([[-100, 50], [200, 50], [200, 5000]], 4096);
  assert.equal(pieces.length, 1);
  assert.deepEqual(pieces[0]![0], [0, 50]);
  assert.deepEqual(pieces[0]!.at(-1), [200, 4096]);
});

test('a line cut by two tiles joins back into one', () => {
  const mPerUnit = 0.5;
  // The same east-west trail in tile x=0 and tile x=1, each with its buffer.
  const left = { tile: { z: 14, x: 0, y: 0 }, extent: WORLD_EXTENT, features: [path_([[3000, 100], [4200, 100]])] };
  const right = { tile: { z: 14, x: 1, y: 0 }, extent: WORLD_EXTENT, features: [path_([[-104, 100], [1000, 100]])] };
  const net = buildNetwork([left, right], { mPerUnit });
  assert.equal(net.nodeCount, 3, 'start, the shared edge point, end');
  assert.equal(net.edges.length, 2);
});

test('cut ends that miss by a few metres at a tile edge are rejoined for sure', () => {
  const mPerUnit = 0.5;
  const left = { tile: { z: 14, x: 0, y: 0 }, extent: WORLD_EXTENT, features: [path_([[3000, 100], [4200, 100]])] };
  // The neighbour simplified differently: its cut lands 10 units (5 m) away.
  const right = { tile: { z: 14, x: 1, y: 0 }, extent: WORLD_EXTENT, features: [path_([[-104, 110], [1000, 110]])] };
  const net = buildNetwork([left, right], { mPerUnit });
  assert.equal(net.edges.filter((e) => e.guessed).length, 0);
  const deg = net.adjacency.map((a) => a.length).sort();
  assert.deepEqual(deg, [1, 1, 2, 2], 'one continuous line');
});

test('a T-junction without a shared vertex is joined; a 6 m gap is joined as a guess; 40 m stays apart', () => {
  const mPerUnit = 0.5; // 1 unit = 0.5 m
  const t = { z: 14, x: 0, y: 0 };
  const main = path_([[100, 1000], [3000, 1000]]);
  const touching = path_([[500, 1002], [500, 2000]]);   // 1 m short
  const gap = path_([[1500, 1012], [1500, 2000]]);      // 6 m short
  const apart = path_([[2500, 1080], [2500, 2000]]);    // 40 m short
  const net = buildNetwork([{ tile: t, extent: WORLD_EXTENT, features: [main, touching, gap, apart] }], { mPerUnit });
  const guessed = net.edges.filter((e) => e.guessed);
  assert.equal(guessed.length, 1);
  // Main is split at both joins.
  const mainNodes = net.adjacency.filter((a) => a.length >= 3).length;
  assert.equal(mainNodes, 2);
});

test('motorways and piers are not walked; tracks and roads are', () => {
  const t = { z: 14, x: 0, y: 0 };
  const net = buildNetwork([{ tile: t, extent: WORLD_EXTENT, features: [
    path_([[0, 10], [100, 10]], { kind: 'highway', kind_detail: 'motorway' }),
    path_([[0, 20], [100, 20]], { kind: 'path', kind_detail: 'pier' }),
    path_([[0, 30], [100, 30]], { kind: 'path', kind_detail: 'track' }),
    path_([[0, 40], [100, 40]], { kind: 'minor_road', kind_detail: 'residential' }),
  ] }], { mPerUnit: 1 });
  assert.equal(net.edges.length, 2);
});

// ---------------------------------------------------------------- terrain

test('heights interpolate between neighbouring contours', () => {
  // Two horizontal contours 2000 units apart: 1000 m at y=1000, 1040 m at y=3000.
  const t = { z: 12, x: 0, y: 0 };
  const ext = 4096;
  const contours = [{ tile: t, extent: ext, layer: 'contours', features: [
    { type: 2 as const, tags: { ele: 1000 }, geometry: [[[0, 1000], [4096, 1000]] as Array<[number, number]>] },
    { type: 2 as const, tags: { ele: 1040 }, geometry: [[[0, 3000], [4096, 3000]] as Array<[number, number]>] },
  ] }];
  // z12 tile units → world units ×4.
  const box = { minX: 0, minY: 0, maxX: 4096 * 4, maxY: 4096 * 4 };
  const g = buildGrid({ box, cell: 200, basemap: [], contours });
  const mid = heightAt(g, 8000, 2000 * 4);
  assert.ok(Math.abs(mid - 1020) < 3, `halfway reads ${mid}`);
  assert.ok(g.hasElevation);
});

test('water polygons and cliff lines block cells; land cover is recorded', () => {
  const t = { z: 14, x: 0, y: 0 };
  const sq = (x0: number, y0: number, x1: number, y1: number): Array<[number, number]> => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
  const g = buildGrid({
    box: { minX: 0, minY: 0, maxX: 4096, maxY: 4096 }, cell: 64, contours: [],
    basemap: [
      { tile: t, extent: 4096, layer: 'landuse', features: [{ type: 3, tags: { kind: 'forest' }, geometry: [sq(0, 0, 2048, 4096)] }] },
      { tile: t, extent: 4096, layer: 'water', features: [{ type: 3, tags: { kind: 'water' }, geometry: [sq(3000, 3000, 4000, 4000)] }] },
      { tile: t, extent: 4096, layer: 'earth', features: [{ type: 2, tags: { kind: 'cliff' }, geometry: [[[2500, 0], [2500, 2000]]] }] },
    ],
  });
  assert.equal(g.cover[cellAt(g, 100, 100)], COVER.forest);
  assert.equal(g.cover[cellAt(g, 3500, 3500)], COVER.water);
  assert.ok((g.flags[cellAt(g, 2500, 1000)]! & CELL_BLOCKED) !== 0);
  assert.equal(g.cover[cellAt(g, 2200, 3800)], COVER.open);
});

// ---------------------------------------------------------------- MVT

test('decodes a real basemap tile: trails come with names and details', async () => {
  const dir = path.join(FIXTURES, 'half-dome', 'basemap');
  const file = fs.readdirSync(dir).find((f) => f.endsWith('.mvt.gz'))!;
  const layers = decodeTile(new Uint8Array(zlib.gunzipSync(fs.readFileSync(path.join(dir, file)))), ['roads']);
  assert.deepEqual([...layers.keys()], ['roads'], 'only the requested layer is decoded');
  const roads = layers.get('roads')!;
  assert.equal(roads.extent, 4096);
  assert.ok(roads.features.some((f) => f.type === 2 && f.tags.kind === 'path'));
});

// ---------------------------------------------------------------- whole routes

test('Happy Isles to Half Dome keeps to the trails (Mist Trail), about 11.4 km', async () => {
  const { sources, from, to } = fixture('half-dome');
  const res = await planRoute(sources, from, to);
  assert.ok(res.ok, res.ok ? '' : res.reason);
  const r = res.route;
  assert.ok(r.meters > 10_500 && r.meters < 12_500, `${r.meters} m`);
  assert.ok(r.offTrailMeters < 50, `off trail ${r.offTrailMeters} m`);
  const names = new Set(r.stretches.map((s) => s.name));
  assert.ok(names.has('Mist Trail') && names.has('Half Dome Trail') && names.has('The Cables'));
  // Real gain is ~1460 m (1230 → 2694); contour heights land within ~15%.
  assert.ok(r.ascent > 1250 && r.ascent < 1750, `ascent ${r.ascent}`);
  assert.ok(r.hasElevation);
});

test('a map gap past the Kaibab Suspension Bridge is crossed off trail, and flagged unsure', async () => {
  const { sources, from, to } = fixture('kaibab-bridge');
  const res = await planRoute(sources, from, to);
  assert.ok(res.ok, res.ok ? '' : res.reason);
  const r = res.route;
  assert.ok(r.offTrailMeters > 0 && r.unsureMeters >= r.offTrailMeters);
  assert.ok(r.stretches.some((s) => !s.sure && s.kind === 'off-trail'));
  assert.ok(r.stretches.some((s) => s.sure && s.name === 'Phantom Ranch Village Trail'));
  for (const s of r.stretches) assert.ok(s.coords.length >= 2);
});

test('too far for a walking route is refused before any tile is read', async () => {
  let reads = 0;
  const counting: TileReader = async () => { reads++; return null; };
  const res = await planRoute({ basemap: counting }, { lat: 37.7, lon: -119.5 }, { lat: 38.2, lon: -119.5 });
  assert.equal(res.ok, false);
  assert.equal(!res.ok && res.reason, 'too-far');
  assert.equal(reads, 0);
});

test('no map for the area is its own failure, not "no route"', async () => {
  const res = await planRoute({ basemap: async () => null }, { lat: 37.7, lon: -119.5 }, { lat: 37.71, lon: -119.5 });
  assert.equal(!res.ok && res.reason, 'no-map');
});

test('metres per unit shrinks with latitude', () => {
  assert.ok(metersPerUnit(60) < metersPerUnit(30));
});

test('a plan can be cancelled mid-search, and the screen gets turns while it runs', async () => {
  const { sources, from, to } = fixture('half-dome');
  const signal = { aborted: false };
  let pauses = 0;
  const res = await planRoute(sources, from, to, {
    signal,
    pause: async () => { pauses++; if (pauses === 3) signal.aborted = true; },
  });
  assert.equal(!res.ok && res.reason, 'cancelled');
  assert.ok(pauses >= 3);
});
