/**
 * Turn a state's region list (scripts/regions/<USPS>.json: counties grouped
 * into named regions) into the shapes a regional download needs (#224).
 *
 * Usage:
 *   node scripts/build-state-regions.mjs <USPS> <census-counties-base> [out-root]
 *
 * <census-counties-base> is the Census cartographic county file without its
 * extension, e.g. ~/census/cb_2023_us_county_500k (the .shp and .dbf beside it).
 * Public domain; https://www2.census.gov/geo/tiger/GENZ2023/shp/.
 *
 * Writes, under <out-root>/<USPS>/ (default dist/regions):
 *
 *   cut/<id>.geojson   each region's counties at full detail: the area
 *                      `pmtiles extract --region` cuts its map and contours to
 *   regions-<USPS>.json the outlines the app carries: each region's border,
 *                      simplified, and the lines it shares with its neighbours
 *
 * The outlines are simplified once per shared line and both neighbours use
 * that same line, so two regions drawn side by side meet exactly: no sliver
 * of "neither" or "both" along the border for a fix to fall into.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [stateArg, censusBase, outRoot = 'dist/regions'] = process.argv.slice(2);
const state = stateArg?.toUpperCase();
if (state === undefined || censusBase === undefined) {
  console.error('usage: build-state-regions.mjs <USPS> <census-counties-base> [out-root]');
  process.exit(1);
}
const ROOT = new URL('..', import.meta.url).pathname;
const spec = JSON.parse(readFileSync(join(ROOT, 'scripts', 'regions', `${state}.json`), 'utf8'));

// --- The Census shapefile: polygons (.shp) and their names (.dbf). ---------

function readDbf(path) {
  const d = readFileSync(path);
  const n = d.readUInt32LE(4), headerLen = d.readUInt16LE(8), recLen = d.readUInt16LE(10);
  const fields = [];
  for (let i = 32; d[i] !== 0x0d; i += 32) {
    fields.push({ name: d.toString('latin1', i, i + 11).replace(/\0.*$/, ''), len: d[i + 16] });
  }
  const recs = [];
  for (let r = 0; r < n; r++) {
    let o = headerLen + r * recLen + 1;
    const rec = {};
    for (const f of fields) { rec[f.name] = d.toString('latin1', o, o + f.len).trim(); o += f.len; }
    recs.push(rec);
  }
  return recs;
}

function readShp(path, recs, keep) {
  const s = readFileSync(path);
  const out = [];
  for (let i = 100, k = 0; i < s.length; k++) {
    const len = s.readUInt32BE(i + 4) * 2;
    const b = i + 8;
    i = b + len;
    if (!keep(recs[k])) continue;
    const nParts = s.readInt32LE(b + 36), nPts = s.readInt32LE(b + 40);
    const parts = [];
    for (let p = 0; p < nParts; p++) parts.push(s.readInt32LE(b + 44 + 4 * p));
    parts.push(nPts);
    const at = b + 44 + 4 * nParts;
    const rings = [];
    for (let p = 0; p < nParts; p++) {
      const ring = [];
      for (let j = parts[p]; j < parts[p + 1]; j++) ring.push([s.readDoubleLE(at + 16 * j), s.readDoubleLE(at + 16 * j + 8)]);
      rings.push(ring);
    }
    out.push({ name: recs[k].NAME, rings });
  }
  return out;
}

const recs = readDbf(`${censusBase}.dbf`);
const counties = readShp(`${censusBase}.shp`, recs, (r) => r.STATEFP === spec.stateFips);

// Every county in exactly one region, or the regions leave holes or overlap.
const named = new Map(counties.map((c) => [c.name, c]));
const listed = spec.regions.flatMap((r) => r.counties);
const unknown = listed.filter((n) => !named.has(n));
const unlisted = [...named.keys()].filter((n) => !listed.includes(n));
const twice = listed.filter((n, i) => listed.indexOf(n) !== i);
if (unknown.length + unlisted.length + twice.length > 0) {
  console.error(`${state}: counties not found ${JSON.stringify(unknown)}, in no region ${JSON.stringify(unlisted)}, in two ${JSON.stringify(twice)}`);
  process.exit(1);
}

// --- Each region's own border: the county edges no other county of it shares.

const key = ([x, y]) => `${x.toFixed(6)},${y.toFixed(6)}`;
const segKey = (a, b) => { const ka = key(a), kb = key(b); return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`; };

/** Region id -> its border as directed segments [from, to]. */
const borders = new Map();
for (const r of spec.regions) {
  const seen = new Map();
  for (const name of r.counties) {
    for (const ring of named.get(name).rings) {
      for (let i = 0; i + 1 < ring.length; i++) {
        const k = segKey(ring[i], ring[i + 1]);
        // A segment two counties of the region share is inside the region.
        if (seen.has(k)) seen.delete(k); else seen.set(k, [ring[i], ring[i + 1]]);
      }
    }
  }
  borders.set(r.id, seen);
}
/** Segment -> the regions whose border it is: one (coast, state line) or two (a shared border). */
const owners = new Map();
for (const [id, segs] of borders) for (const k of segs.keys()) owners.set(k, [...(owners.get(k) ?? []), id]);

/** Chain a region's segments into closed rings. */
function rings(segs) {
  const from = new Map();
  for (const [k, [a, b]] of segs) {
    for (const [p, q] of [[a, b], [b, a]]) {
      const list = from.get(key(p)) ?? [];
      list.push({ k, to: q });
      from.set(key(p), list);
    }
  }
  const used = new Set();
  const out = [];
  for (const [k0, [a0, b0]] of segs) {
    if (used.has(k0)) continue;
    used.add(k0);
    const ring = [a0, b0];
    for (;;) {
      const next = (from.get(key(ring.at(-1))) ?? []).find((e) => !used.has(e.k));
      if (next === undefined) break;
      used.add(next.k);
      ring.push(next.to);
    }
    out.push(ring);
  }
  return out;
}

// --- Simplify once per shared line, so neighbours keep meeting exactly. ----

/** Douglas-Peucker; the two ends always stay. */
function simplify(pts, tol) {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [s, e] = stack.pop();
    const [x1, y1] = pts[s], [x2, y2] = pts[e];
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
    let best = -1, far = tol;
    for (let i = s + 1; i < e; i++) {
      const [x, y] = pts[i];
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
      const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
      if (d > far) { far = d; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([s, best], [best, e]); }
  }
  return pts.filter((_, i) => keep[i] === 1);
}

/** ~200 m: well inside what a hiker can see, and it keeps the file small. */
const TOL = 0.002;
const neighbourOf = (id, a, b) => (owners.get(segKey(a, b)) ?? []).find((o) => o !== id) ?? null;
const arcs = new Map();
const round = (p) => [Number(p[0].toFixed(4)), Number(p[1].toFixed(4))];

/** One ring, cut where the neighbour changes, each piece simplified through the shared cache. */
function simplifyRing(id, ring) {
  const label = (i) => neighbourOf(id, ring[i], ring[i + 1]);
  // Start the walk where the neighbour changes, so no piece wraps past the ring's start.
  let start = 0;
  for (let i = 1; i + 1 < ring.length; i++) if (label(i) !== label(i - 1)) { start = i; break; }
  const loop = [...ring.slice(start, -1), ...ring.slice(0, start), ring[start]];
  const out = [];
  const lines = [];
  let s = 0;
  for (let i = 1; i < loop.length; i++) {
    if (i < loop.length - 1 && neighbourOf(id, loop[i], loop[i + 1]) === neighbourOf(id, loop[s], loop[s + 1])) continue;
    const piece = loop.slice(s, i + 1);
    const who = neighbourOf(id, loop[s], loop[s + 1]);
    const [lo, hi] = [key(piece[0]), key(piece.at(-1))].sort();
    const k = who === null ? null : `${[id, who].sort().join('|')}|${lo}|${hi}|${piece.length}`;
    let simple;
    if (k !== null && arcs.has(k)) {
      const cached = arcs.get(k);
      simple = key(cached[0]) === key(piece[0]) ? cached : [...cached].reverse();
    } else {
      simple = simplify(piece, TOL).map(round);
      if (k !== null) arcs.set(k, simple);
    }
    out.push(...(out.length === 0 ? simple : simple.slice(1)));
    if (who !== null && id < who) lines.push({ a: id, b: who, line: simple });
    s = i;
  }
  return { ring: out, lines };
}

const outDir = join(outRoot, state);
mkdirSync(join(outDir, 'cut'), { recursive: true });

const regionsOut = [];
const edges = [];
for (const r of spec.regions) {
  // Full detail for cutting the map: the counties themselves.
  const polys = r.counties.flatMap((n) => named.get(n).rings.map((ring) => [ring]));
  writeFileSync(join(outDir, 'cut', `${r.id}.geojson`), JSON.stringify({
    type: 'Feature', properties: { state, id: r.id, name: r.name },
    geometry: { type: 'MultiPolygon', coordinates: polys },
  }));
  const outlines = rings(borders.get(r.id)).map((ring) => simplifyRing(r.id, ring));
  for (const o of outlines) edges.push(...o.lines);
  regionsOut.push({
    id: r.id, name: r.name,
    // Flat [lon, lat, lon, lat, ...] rings: half the JSON of pairs.
    rings: outlines.filter((o) => o.ring.length >= 4).map((o) => o.ring.flat()),
  });
}

const file = {
  schemaVersion: 1,
  state,
  source: 'US Census cartographic boundary counties 1:500k (public domain), grouped in scripts/regions/' + `${state}.json`,
  regions: regionsOut,
  // Each shared border once: what the edge warning measures to.
  edges: edges.map((e) => ({ a: e.a, b: e.b, line: e.line.flat() })),
};
writeFileSync(join(outDir, `regions-${state}.json`), JSON.stringify(file) + '\n');

const shared = [...owners.values()].filter((o) => o.length === 2).length;
console.log(`${state}: ${spec.regions.length} regions from ${counties.length} counties; ` +
  `${shared} shared border segments; outline file ${(JSON.stringify(file).length / 1024).toFixed(0)} KB`);
for (const r of regionsOut) console.log(`  ${r.id.padEnd(8)} ${r.name}: ${r.rings.length} ring(s), ${r.rings.reduce((a, x) => a + x.length / 2, 0)} points`);
