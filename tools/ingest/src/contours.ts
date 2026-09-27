/**
 * Contour lines from elevation tiles, as Mapbox Vector Tiles.
 *
 * The topographic map (docs/results-topo-research.md, option B) draws contour
 * lines from a separate `contours-<STATE>.pmtiles`. Nothing hosts contours as
 * tiles, so they are traced here from Mapterhorn's Terrarium elevation tiles.
 * This replaces the trial's throwaway Python (scikit-image, shapely,
 * mapbox-vector-tile) with the three small pieces it needed: marching squares,
 * Douglas-Peucker, and an MVT encoder.
 *
 * Tiles are traced independently, each on its own 512 px grid plus a border of
 * pixels borrowed from its neighbours. Neighbouring tiles see identical pixels
 * in the overlap, so their lines meet exactly at the edge, and no tile ever has
 * to hold a whole state in memory.
 */

/** Terrarium encoding: metres = R * 256 + G + B / 256 - 32768. */
export function terrariumToMetres(rgb: Uint8Array | Buffer, channels: number): Float32Array {
  const n = rgb.length / channels;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * channels;
    out[i] = rgb[o]! * 256 + rgb[o + 1]! + rgb[o + 2]! / 256 - 32768;
  }
  return out;
}

export type Point = [number, number];
export type Line = Point[];

/**
 * Trace one elevation level through a grid with marching squares.
 *
 * Grid values sit at pixel centres: value (i, j) is at x = i + 0.5, y = j + 0.5
 * in grid coordinates. Returns polylines in the same coordinates, stitched
 * across cells; closed loops repeat their first point at the end.
 */
export function traceLevel(grid: Float32Array, width: number, height: number, level: number): Line[] {
  // Segment endpoints lie on cell edges. An edge id is unique per edge, so two
  // segments that share an endpoint share an id, which is how they are joined.
  const hId = (i: number, j: number): number => (j * width + i) * 2; // edge (i,j)-(i+1,j)
  const vId = (i: number, j: number): number => (j * width + i) * 2 + 1; // edge (i,j)-(i,j+1)
  const at = (i: number, j: number): number => grid[j * width + i]!;
  const pos = new Map<number, Point>();
  const lerp = (a: number, b: number): number => (level - a) / (b - a);
  const hPoint = (i: number, j: number): number => {
    const id = hId(i, j);
    if (!pos.has(id)) pos.set(id, [i + 0.5 + lerp(at(i, j), at(i + 1, j)), j + 0.5]);
    return id;
  };
  const vPoint = (i: number, j: number): number => {
    const id = vId(i, j);
    if (!pos.has(id)) pos.set(id, [i + 0.5, j + 0.5 + lerp(at(i, j), at(i, j + 1))]);
    return id;
  };

  const segs: [number, number][] = [];
  for (let j = 0; j < height - 1; j++) {
    for (let i = 0; i < width - 1; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      // Corners at or above the level count as "in". The same rule everywhere
      // means a level passing exactly through a pixel value is still consistent.
      const code = (a >= level ? 8 : 0) | (b >= level ? 4 : 0) | (c >= level ? 2 : 0) | (d >= level ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const top = (): number => hPoint(i, j);
      const right = (): number => vPoint(i + 1, j);
      const bottom = (): number => hPoint(i, j + 1);
      const left = (): number => vPoint(i, j);
      switch (code) {
        case 1: case 14: segs.push([left(), bottom()]); break;
        case 2: case 13: segs.push([bottom(), right()]); break;
        case 3: case 12: segs.push([left(), right()]); break;
        case 4: case 11: segs.push([top(), right()]); break;
        case 6: case 9: segs.push([top(), bottom()]); break;
        case 7: case 8: segs.push([left(), top()]); break;
        case 5: case 10: {
          // Saddle: the cell centre decides which pair of corners connects.
          const centreIn = (a + b + c + d) / 4 >= level;
          if ((code === 5) === centreIn) { segs.push([left(), top()]); segs.push([bottom(), right()]); }
          else { segs.push([left(), bottom()]); segs.push([top(), right()]); }
          break;
        }
      }
    }
  }

  // Join segments into polylines through their shared edge points.
  const byEnd = new Map<number, number[]>();
  segs.forEach(([p, q], k) => {
    for (const e of [p, q]) {
      const list = byEnd.get(e);
      if (list === undefined) byEnd.set(e, [k]); else list.push(k);
    }
  });
  const used = new Uint8Array(segs.length);
  const next = (end: number, from: number): number | undefined =>
    byEnd.get(end)?.find((k) => k !== from && used[k] === 0);
  const lines: Line[] = [];
  for (let s = 0; s < segs.length; s++) {
    if (used[s] === 1) continue;
    used[s] = 1;
    const ids = [segs[s]![0], segs[s]![1]];
    // Grow forwards from the tail, then backwards from the head.
    for (let dir = 0; dir < 2; dir++) {
      let prev = s;
      for (;;) {
        const end = dir === 0 ? ids[ids.length - 1]! : ids[0]!;
        const k = next(end, prev);
        if (k === undefined) break;
        used[k] = 1;
        const [p, q] = segs[k]!;
        const other = p === end ? q : p;
        if (dir === 0) ids.push(other); else ids.unshift(other);
        prev = k;
        if (other === (dir === 0 ? ids[0] : ids[ids.length - 1])) break; // closed loop
      }
    }
    lines.push(ids.map((id) => pos.get(id)!));
  }
  return lines;
}

/** Douglas-Peucker, iterative. Keeps both ends. */
export function simplify(line: Line, tolerance: number): Line {
  if (line.length <= 2) return line;
  const keep = new Uint8Array(line.length);
  keep[0] = 1; keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  const t2 = tolerance * tolerance;
  while (stack.length > 0) {
    const [s, e] = stack.pop()!;
    const [x1, y1] = line[s]!, [x2, y2] = line[e]!;
    const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
    let worst = -1, worstD = t2;
    for (let k = s + 1; k < e; k++) {
      const [x, y] = line[k]!;
      let d2: number;
      if (len2 === 0) d2 = (x - x1) ** 2 + (y - y1) ** 2;
      else {
        const cross = dx * (y - y1) - dy * (x - x1);
        d2 = (cross * cross) / len2;
      }
      if (d2 > worstD) { worstD = d2; worst = k; }
    }
    if (worst !== -1) { keep[worst] = 1; stack.push([s, worst], [worst, e]); }
  }
  return line.filter((_, k) => keep[k] === 1);
}

// ---- Mapbox Vector Tile encoding (spec 2.1), just enough for one line layer.

class Writer {
  private buf: number[] = [];
  varint(v: number): void {
    let n = v;
    while (n > 0x7f) { this.buf.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
    this.buf.push(n);
  }
  tag(field: number, wire: number): void { this.varint((field << 3) | wire); }
  bytes(field: number, b: Uint8Array): void { this.tag(field, 2); this.varint(b.length); for (const x of b) this.buf.push(x); }
  string(field: number, s: string): void { this.bytes(field, new TextEncoder().encode(s)); }
  uint(field: number, v: number): void { this.tag(field, 0); this.varint(v); }
  packed(field: number, vs: readonly number[]): void {
    const w = new Writer(); for (const v of vs) w.varint(v); this.bytes(field, w.done());
  }
  done(): Uint8Array { return Uint8Array.from(this.buf); }
}

const zigzag = (n: number): number => (n << 1) ^ (n >> 31);

export interface ContourFeature {
  /** Tile coordinates, 0..extent, already rounded to integers. */
  readonly line: readonly Point[];
  readonly ele: number;
  /** 1 for index contours (drawn heavier), 0 otherwise. */
  readonly idx: 0 | 1;
}

/** Encode one layer of line features as an uncompressed MVT. */
export function encodeContourTile(layerName: string, features: readonly ContourFeature[], extent = 4096): Uint8Array {
  const keys = ['ele', 'idx'];
  const values: number[] = [];
  const valueIndex = new Map<number, number>();
  const vi = (v: number): number => {
    let k = valueIndex.get(v);
    if (k === undefined) { k = values.length; values.push(v); valueIndex.set(v, k); }
    return k;
  };
  const layer = new Writer();
  layer.uint(15, 2); // version
  layer.string(1, layerName);
  for (const f of features) {
    if (f.line.length < 2) continue;
    const geom: number[] = [];
    let cx = 0, cy = 0;
    const [x0, y0] = f.line[0]!;
    geom.push((1 << 3) | 1, zigzag(x0 - cx), zigzag(y0 - cy)); // MoveTo, 1
    cx = x0; cy = y0;
    geom.push(((f.line.length - 1) << 3) | 2); // LineTo, n-1
    for (let k = 1; k < f.line.length; k++) {
      const [x, y] = f.line[k]!;
      geom.push(zigzag(x - cx), zigzag(y - cy));
      cx = x; cy = y;
    }
    const feat = new Writer();
    feat.packed(2, [0, vi(f.ele), 1, vi(f.idx)]); // tags
    feat.uint(3, 2); // type LINESTRING
    feat.packed(4, geom);
    layer.bytes(2, feat.done());
  }
  for (const k of keys) layer.string(3, k);
  for (const v of values) {
    const w = new Writer();
    // Elevations are whole metres and non-negative (levels at or below sea
    // level are skipped), so uint_value (field 5) covers every value.
    w.uint(5, v);
    layer.bytes(4, w.done());
  }
  layer.uint(5, extent);
  const tile = new Writer();
  tile.bytes(3, layer.done());
  return tile.done();
}

/** Contour interval and index interval for each output zoom (the trial's). */
export const CONTOUR_LEVELS: Readonly<Record<number, { interval: number; index: number }>> = {
  10: { interval: 200, index: 1000 },
  11: { interval: 100, index: 500 },
  12: { interval: 40, index: 200 },
};

/**
 * Contour features for one tile.
 *
 * `grid` is the tile's pixels plus `border` pixels from its neighbours on
 * every side, so it is (size + 2 * border) square. Levels at or below sea level
 * are skipped: Mapterhorn has no bathymetry, and a 0 m line would trace the
 * noise along every coast.
 */
export function tileContours(
  grid: Float32Array, size: number, border: number, interval: number, index: number,
  extent = 4096, tolerancePx = 0.5,
): ContourFeature[] {
  const w = size + 2 * border;
  let lo = Infinity, hi = -Infinity;
  for (const v of grid) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const scale = extent / size;
  const out: ContourFeature[] = [];
  for (let level = Math.max(interval, Math.ceil(lo / interval) * interval); level <= hi; level += interval) {
    for (const raw of traceLevel(grid, w, w, level)) {
      // Grid coordinates to tile coordinates: drop the border, scale to extent.
      const line = simplify(raw, tolerancePx).map(([x, y]): Point => [
        Math.round((x - border) * scale), Math.round((y - border) * scale),
      ]);
      const dedup = line.filter((p, k) => k === 0 || p[0] !== line[k - 1]![0] || p[1] !== line[k - 1]![1]);
      if (dedup.length >= 2) out.push({ line: dedup, ele: level, idx: level % index === 0 ? 1 : 0 });
    }
  }
  return out;
}
