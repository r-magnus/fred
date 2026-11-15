/**
 * The ground between the trails: a grid of cells, each with a height, a cover
 * type and whether it can be walked at all (#223).
 *
 * Built from what the state map files already carry, nothing new:
 *
 * - **Height** from the 40 m contour lines (contours archive, z12). Cells on a
 *   contour take its height; cells between take a height interpolated between
 *   the nearest contour and the nearest contour of the *neighbouring* level.
 *   The trick that makes that cheap: neighbouring levels always differ in
 *   parity (…, 1200, 1240, 1280 → index 30, 31, 32), so two distance
 *   transforms, one seeded with even-index lines and one with odd, give both
 *   in O(cells). The interpolation is the standard contour-to-surface one,
 *   d1 / (d1 + d2) along the gradient.
 * - **Cover** from basemap `landuse` (forest, scrub, rock, wetland, glacier…)
 *   and `water` polygons.
 * - **Barriers** from cliff lines (`earth` lines) and river lines (`water`
 *   lines of kind river/canal). Cells they pass through cannot be entered off
 *   trail; a trail that crosses one (a bridge, a cut) still can.
 *   Streams are crossable, at a cost and a warning.
 */

import type { TileFeature } from './mvt.ts';
import { tileToWorld, type TileId } from './tiles.ts';

export const COVER = {
  open: 0,
  forest: 1,
  scrub: 2,
  rock: 3,
  wetland: 4,
  sand: 5,
  glacier: 6,
  water: 7,
} as const;
export type Cover = typeof COVER[keyof typeof COVER];

/** Cell flags. */
export const CELL_BLOCKED = 1;
export const CELL_STREAM = 2;

const LANDUSE_COVER: Readonly<Record<string, Cover>> = {
  forest: COVER.forest, wood: COVER.forest,
  scrub: COVER.scrub, heath: COVER.scrub,
  bare_rock: COVER.rock, scree: COVER.rock,
  wetland: COVER.wetland, marsh: COVER.wetland, swamp: COVER.wetland, bog: COVER.wetland,
  beach: COVER.sand, sand: COVER.sand,
  glacier: COVER.glacier,
  meadow: COVER.open, grassland: COVER.open, grass: COVER.open, farmland: COVER.open,
};

const BARRIER_WATER_LINES = new Set(['river', 'canal']);

export interface Grid {
  /** World-unit position of cell (0,0)'s top-left corner. */
  readonly x0: number;
  readonly y0: number;
  /** World units per cell. */
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  /** Metres. */
  readonly elev: Float32Array;
  readonly cover: Uint8Array;
  readonly flags: Uint8Array;
  /** Whether any contour reached the area; without them heights are all 0. */
  readonly hasElevation: boolean;
}

export interface GridBox { readonly minX: number; readonly minY: number; readonly maxX: number; readonly maxY: number }

export interface TileFeatures {
  readonly tile: TileId;
  readonly extent: number;
  /** The tile layer the features came from. */
  readonly layer: string;
  readonly features: readonly TileFeature[];
}

export interface TerrainInput {
  readonly box: GridBox;
  readonly cell: number;
  /** Basemap `landuse`, `water` and `earth` layers, one entry per tile and layer. */
  readonly basemap: readonly TileFeatures[];
  /** Contour tiles' `contours` features (lines tagged `ele`, metres). */
  readonly contours: readonly TileFeatures[];
}

type Pt = readonly [number, number];

function toWorld(t: TileFeatures, ring: ReadonlyArray<readonly [number, number]>): Pt[] {
  return ring.map(([x, y]) => tileToWorld(t.tile, t.extent, x, y));
}

class GridWriter {
  readonly g: { x0: number; y0: number; cell: number; cols: number; rows: number };
  constructor(box: GridBox, cell: number) {
    const cols = Math.max(1, Math.ceil((box.maxX - box.minX) / cell));
    const rows = Math.max(1, Math.ceil((box.maxY - box.minY) / cell));
    this.g = { x0: box.minX, y0: box.minY, cell, cols, rows };
  }

  /**
   * Every cell a segment passes through (a "supercover" walk), so a barrier
   * line is never one diagonal step thin.
   */
  segment(a: Pt, b: Pt, visit: (i: number) => void): void {
    const { x0, y0, cell, cols, rows } = this.g;
    let cx = Math.floor((a[0] - x0) / cell), cy = Math.floor((a[1] - y0) / cell);
    const ex = Math.floor((b[0] - x0) / cell), ey = Math.floor((b[1] - y0) / cell);
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const sx = Math.sign(dx), sy = Math.sign(dy);
    const tdx = dx === 0 ? Infinity : Math.abs(cell / dx);
    const tdy = dy === 0 ? Infinity : Math.abs(cell / dy);
    const fx = (a[0] - x0) / cell - cx, fy = (a[1] - y0) / cell - cy;
    let tmx = dx === 0 ? Infinity : (sx > 0 ? 1 - fx : fx) * tdx;
    let tmy = dy === 0 ? Infinity : (sy > 0 ? 1 - fy : fy) * tdy;
    const steps = Math.abs(ex - cx) + Math.abs(ey - cy);
    for (let s = 0; s <= steps; s++) {
      if (cx >= 0 && cy >= 0 && cx < cols && cy < rows) visit(cy * cols + cx);
      if (tmx < tmy) { tmx += tdx; cx += sx; } else { tmy += tdy; cy += sy; }
    }
  }

  /** Even-odd scanline fill of rings, at cell-centre rows. */
  fill(rings: readonly Pt[][], visit: (i: number) => void): void {
    const { x0, y0, cell, cols, rows } = this.g;
    let minY = Infinity, maxY = -Infinity;
    for (const r of rings) for (const p of r) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
    const r0 = Math.max(0, Math.floor((minY - y0) / cell));
    const r1 = Math.min(rows - 1, Math.floor((maxY - y0) / cell));
    if (r1 < r0) return;
    // Each ring edge adds its crossing to only the rows it spans, rather than
    // every row testing every edge: big forest polygons have thousands of
    // vertices and the grid hundreds of rows.
    const crossings: number[][] = Array.from({ length: r1 - r0 + 1 }, () => []);
    for (const ring of rings) {
      for (let i = 1; i < ring.length; i++) {
        const [ax, ay] = ring[i - 1]!, [bx, by] = ring[i]!;
        if (ay === by) continue;
        const lo = Math.min(ay, by), hi = Math.max(ay, by);
        // Rows whose centre yc satisfies lo < yc <= hi (half-open, so a vertex
        // shared by two edges is counted once).
        const first = Math.max(r0, Math.ceil((lo - y0) / cell - 0.5));
        const last = Math.min(r1, Math.floor((hi - y0) / cell - 0.5));
        for (let row = first; row <= last; row++) {
          const yc = y0 + (row + 0.5) * cell;
          if (yc <= lo || yc > hi) continue;
          crossings[row - r0]!.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
        }
      }
    }
    for (let row = r0; row <= r1; row++) {
      const xsAt = crossings[row - r0]!;
      if (xsAt.length < 2) continue;
      xsAt.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xsAt.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xsAt[k]! - x0) / cell - 0.5));
        const c1 = Math.min(cols - 1, Math.floor((xsAt[k + 1]! - x0) / cell - 0.5));
        for (let c = c0; c <= c1; c++) visit(row * cols + c);
      }
    }
  }
}

/**
 * Two-pass chamfer distance transform, carrying the seed's value along.
 * Weights 1 and √2: within a few percent of Euclidean, which is ample when the
 * heights it interpolates are themselves 40 m steps.
 */
function distanceTransform(
  cols: number, rows: number, seedValue: Float32Array, hasSeed: Uint8Array,
): { dist: Float32Array; value: Float32Array } {
  const n = cols * rows;
  const dist = new Float32Array(n).fill(Infinity);
  const value = new Float32Array(n).fill(NaN);
  for (let i = 0; i < n; i++) if (hasSeed[i]) { dist[i] = 0; value[i] = seedValue[i]!; }
  const D = Math.SQRT2;
  const relax = (i: number, j: number, w: number): void => {
    const d = dist[j]! + w;
    if (d < dist[i]!) { dist[i] = d; value[i] = value[j]!; }
  };
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x;
    if (x > 0) relax(i, i - 1, 1);
    if (y > 0) {
      relax(i, i - cols, 1);
      if (x > 0) relax(i, i - cols - 1, D);
      if (x < cols - 1) relax(i, i - cols + 1, D);
    }
  }
  for (let y = rows - 1; y >= 0; y--) for (let x = cols - 1; x >= 0; x--) {
    const i = y * cols + x;
    if (x < cols - 1) relax(i, i + 1, 1);
    if (y < rows - 1) {
      relax(i, i + cols, 1);
      if (x < cols - 1) relax(i, i + cols + 1, D);
      if (x > 0) relax(i, i + cols - 1, D);
    }
  }
  return { dist, value };
}

export function buildGrid(input: TerrainInput): Grid {
  const w = new GridWriter(input.box, input.cell);
  const { cols, rows } = w.g;
  const n = cols * rows;
  const cover = new Uint8Array(n);
  const flags = new Uint8Array(n);

  // Cover. Water last, so a lake inside a forest polygon stays water.
  const waterRings: Pt[][][] = [];
  for (const t of input.basemap) {
    for (const f of t.features) {
      const kind = typeof f.tags.kind === 'string' ? f.tags.kind : '';
      if (f.type === 3) {
        const rings = f.geometry.map((r) => toWorld(t, r));
        if (t.layer === 'water') { waterRings.push(rings); continue; }
        if (t.layer !== 'landuse') continue;
        const c = LANDUSE_COVER[kind];
        if (c !== undefined) w.fill(rings, (i) => { cover[i] = c; });
      } else if (f.type === 2) {
        const isCliff = t.layer === 'earth' && (kind === '' || kind === 'cliff');
        const isRiver = t.layer === 'water' && BARRIER_WATER_LINES.has(kind);
        const isStream = t.layer === 'water' && !isRiver;
        if (!isCliff && !isRiver && !isStream) continue;
        for (const part of f.geometry) {
          const pts = toWorld(t, part);
          for (let k = 1; k < pts.length; k++) {
            w.segment(pts[k - 1]!, pts[k]!, (i) => { flags[i]! |= isStream ? CELL_STREAM : CELL_BLOCKED; });
          }
        }
      }
    }
  }
  for (const rings of waterRings) w.fill(rings, (i) => { cover[i] = COVER.water; });

  // Height.
  const levels: number[] = [];
  const seeds: Array<{ i: number; ele: number }> = [];
  for (const t of input.contours) {
    for (const f of t.features) {
      if (f.type !== 2 || typeof f.tags.ele !== 'number') continue;
      const ele = f.tags.ele;
      levels.push(ele);
      for (const part of f.geometry) {
        const pts = toWorld(t, part);
        for (let k = 1; k < pts.length; k++) w.segment(pts[k - 1]!, pts[k]!, (i) => seeds.push({ i, ele }));
      }
    }
  }
  const elev = new Float32Array(n);
  const hasElevation = seeds.length > 0;
  if (hasElevation) {
    const sorted = [...new Set(levels)].sort((a, b) => a - b);
    let interval = Infinity;
    for (let k = 1; k < sorted.length; k++) interval = Math.min(interval, sorted[k]! - sorted[k - 1]!);
    if (!Number.isFinite(interval) || interval <= 0) interval = 40;
    const evenVal = new Float32Array(n), oddVal = new Float32Array(n);
    const evenSeed = new Uint8Array(n), oddSeed = new Uint8Array(n);
    for (const { i, ele } of seeds) {
      if (Math.round(ele / interval) % 2 === 0) { evenSeed[i] = 1; evenVal[i] = ele; }
      else { oddSeed[i] = 1; oddVal[i] = ele; }
    }
    const even = distanceTransform(cols, rows, evenVal, evenSeed);
    const odd = distanceTransform(cols, rows, oddVal, oddSeed);
    for (let i = 0; i < n; i++) {
      const de = even.dist[i]!, dodd = odd.dist[i]!;
      const ve = even.value[i]!, vo = odd.value[i]!;
      if (!Number.isFinite(de)) elev[i] = Number.isFinite(dodd) ? vo : 0;
      else if (!Number.isFinite(dodd)) elev[i] = ve;
      else if (de + dodd === 0) elev[i] = ve;
      else elev[i] = ve + ((vo - ve) * de) / (de + dodd);
    }
  }

  return { ...w.g, elev, cover, flags, hasElevation };
}

/** The cell index containing a world point, or -1 outside the grid. */
export function cellAt(g: Grid, x: number, y: number): number {
  const cx = Math.floor((x - g.x0) / g.cell), cy = Math.floor((y - g.y0) / g.cell);
  if (cx < 0 || cy < 0 || cx >= g.cols || cy >= g.rows) return -1;
  return cy * g.cols + cx;
}

/** Height at a world point, bilinear between cell centres. */
export function heightAt(g: Grid, x: number, y: number): number {
  const fx = Math.min(Math.max((x - g.x0) / g.cell - 0.5, 0), g.cols - 1);
  const fy = Math.min(Math.max((y - g.y0) / g.cell - 0.5, 0), g.rows - 1);
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, g.cols - 1), y1 = Math.min(y0 + 1, g.rows - 1);
  const tx = fx - x0, ty = fy - y0;
  const e = g.elev;
  const top = e[y0 * g.cols + x0]! * (1 - tx) + e[y0 * g.cols + x1]! * tx;
  const bot = e[y1 * g.cols + x0]! * (1 - tx) + e[y1 * g.cols + x1]! * tx;
  return top * (1 - ty) + bot * ty;
}
