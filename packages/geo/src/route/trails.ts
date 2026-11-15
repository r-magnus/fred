/**
 * The walkable network: trails and roads from the basemap's `roads` layer,
 * joined into a graph the route search can walk (#223).
 *
 * The lines were drawn for a map, not for routing, so three repairs happen
 * here. Measured on the z14 state archives (comment on #223, 2026-11-15):
 *
 * 1. Tiles overlap by a small buffer, so every line near a tile edge appears
 *    twice. Each tile's lines are clipped to the tile's own square first; the
 *    two halves of a cut line then meet on the shared edge.
 * 2. Where two lines meet, they usually share a vertex (80–90% of line ends
 *    sit within 2 m of another line). Vertices within `MERGE_M` are merged.
 *    A line end that touches the middle of another line's segment without a
 *    shared vertex is joined there: "T-junctions".
 * 3. About 2–3% of line ends stop 2–10 m short of another line. Those are
 *    joined too, but the join is marked `guessed`, so the route can draw it in
 *    the warning colour: it is probably a junction, and it is not certain.
 *
 * Lines that cross without a shared vertex (a trail under a road bridge) stay
 * unconnected, which is right.
 */

import type { TileFeature } from './mvt.ts';
import { tileToWorld, type TileId } from './tiles.ts';

/** How a stretch of the network is walked. */
export type WayClass = 'trail' | 'road' | 'major-road';

export interface Way {
  readonly cls: WayClass;
  /** `kind_detail` from the basemap: path, track, footway, residential, primary... */
  readonly detail: string;
  readonly name: string | null;
}

export interface TrailEdge {
  readonly a: number;
  readonly b: number;
  /** Length in world units. */
  readonly length: number;
  /** Index into `ways`. */
  readonly way: number;
  /** A join the map does not quite draw (see 3. above). */
  readonly guessed: boolean;
}

export interface TrailNetwork {
  /** Node coordinates, world units, interleaved x,y. */
  readonly xy: Float64Array;
  readonly nodeCount: number;
  readonly edges: readonly TrailEdge[];
  readonly ways: readonly Way[];
  /** Per node, the indexes of its edges. */
  readonly adjacency: ReadonlyArray<readonly number[]>;
}

/** Basemap road kinds walked on foot, and how. `highway` (motorways) is left out: no walking. */
const KIND_CLASS: Readonly<Record<string, WayClass>> = {
  path: 'trail',
  minor_road: 'road',
  other: 'road',
  major_road: 'major-road',
};

/** A line cut at a tile edge whose two halves miss by up to this is rejoined. */
const EDGE_REJOIN_M = 20;

/** Path details that are not ways to walk: piers end in water. */
const SKIP_DETAIL = new Set(['pier']);

export function wayOf(tags: TileFeature['tags']): Way | null {
  const kind = typeof tags.kind === 'string' ? tags.kind : '';
  const cls = KIND_CLASS[kind];
  if (cls === undefined) return null;
  const detail = typeof tags.kind_detail === 'string' ? tags.kind_detail : kind;
  if (SKIP_DETAIL.has(detail)) return null;
  const name = typeof tags.name === 'string' && tags.name.length > 0 ? tags.name : null;
  return { cls, detail, name };
}

type Pt = [number, number];

/**
 * Clips a polyline to the square [0, size]², returning the pieces inside.
 * Liang–Barsky per segment; consecutive inside segments stay one piece.
 */
export function clipPolyline(line: ReadonlyArray<readonly [number, number]>, size: number): Pt[][] {
  const pieces: Pt[][] = [];
  let current: Pt[] | null = null;
  for (let i = 1; i < line.length; i++) {
    const [x0, y0] = line[i - 1]!;
    const [x1, y1] = line[i]!;
    const dx = x1 - x0;
    const dy = y1 - y0;
    let t0 = 0;
    let t1 = 1;
    let keep = true;
    for (const [p, q] of [[-dx, x0], [dx, size - x0], [-dy, y0], [dy, size - y0]] as const) {
      if (p === 0) {
        if (q < 0) { keep = false; break; }
      } else {
        const r = q / p;
        if (p < 0) { if (r > t1) { keep = false; break; } if (r > t0) t0 = r; }
        else { if (r < t0) { keep = false; break; } if (r < t1) t1 = r; }
      }
    }
    if (!keep) { current = null; continue; }
    const a: Pt = [x0 + t0 * dx, y0 + t0 * dy];
    const b: Pt = [x0 + t1 * dx, y0 + t1 * dy];
    if (current === null || t0 > 0) {
      current = [a];
      pieces.push(current);
    }
    current.push(b);
    if (t1 < 1) current = null;
  }
  return pieces.filter((p) => p.length >= 2);
}

/** A uniform grid of buckets for nearby-point and nearby-segment lookups. */
class Buckets {
  private readonly cells = new Map<number, number[]>();
  private readonly size: number;
  constructor(size: number) { this.size = size; }
  private key(cx: number, cy: number): number { return cx * 1_048_576 + cy; }
  add(x: number, y: number, id: number): void {
    const k = this.key(Math.floor(x / this.size), Math.floor(y / this.size));
    const list = this.cells.get(k);
    if (list === undefined) this.cells.set(k, [id]); else list.push(id);
  }
  addBox(x0: number, y0: number, x1: number, y1: number, id: number): void {
    const cx0 = Math.floor(Math.min(x0, x1) / this.size), cx1 = Math.floor(Math.max(x0, x1) / this.size);
    const cy0 = Math.floor(Math.min(y0, y1) / this.size), cy1 = Math.floor(Math.max(y0, y1) / this.size);
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
      const k = this.key(cx, cy);
      const list = this.cells.get(k);
      if (list === undefined) this.cells.set(k, [id]); else list.push(id);
    }
  }
  near(x: number, y: number, r: number, visit: (id: number) => void): void {
    const cx0 = Math.floor((x - r) / this.size), cx1 = Math.floor((x + r) / this.size);
    const cy0 = Math.floor((y - r) / this.size), cy1 = Math.floor((y + r) / this.size);
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
      const list = this.cells.get(this.key(cx, cy));
      if (list !== undefined) for (const id of list) visit(id);
    }
  }
}

/** Closest point on segment ab to p, as [t, distance]. */
export function projectOnSegment(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): [number, number] {
  const vx = bx - ax, vy = by - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
  return [t, Math.hypot(px - ax - t * vx, py - ay - t * vy)];
}

export interface NetworkOptions {
  /** Metres per world unit in this area. */
  readonly mPerUnit: number;
  /** Vertices closer than this are one node. Default 1 m. */
  readonly mergeM?: number;
  /** A line end this close to another line joins it for sure. Default 2 m. */
  readonly touchM?: number;
  /** A line end this close joins as a guess. Default 10 m. */
  readonly guessM?: number;
}

export interface TileLines {
  readonly tile: TileId;
  readonly extent: number;
  readonly features: readonly TileFeature[];
}

/** Mutable builder; `buildNetwork` is the entry point. */
class NetworkBuilder {
  readonly xs: number[] = [];
  readonly ys: number[] = [];
  readonly edges: Array<{ a: number; b: number; way: number; guessed: boolean }> = [];
  readonly ways: Way[] = [];
  private readonly wayIndex = new Map<string, number>();
  private readonly nodeBuckets: Buckets;
  private readonly merge: number;

  constructor(merge: number) {
    this.merge = merge;
    this.nodeBuckets = new Buckets(Math.max(merge * 4, 1));
  }

  wayId(w: Way): number {
    const key = `${w.cls}|${w.detail}|${w.name ?? ''}`;
    let id = this.wayIndex.get(key);
    if (id === undefined) {
      id = this.ways.length;
      this.ways.push(w);
      this.wayIndex.set(key, id);
    }
    return id;
  }

  node(x: number, y: number): number {
    let found = -1;
    let best = this.merge;
    this.nodeBuckets.near(x, y, this.merge, (id) => {
      const d = Math.hypot(this.xs[id]! - x, this.ys[id]! - y);
      if (d <= best) { best = d; found = id; }
    });
    if (found >= 0) return found;
    const id = this.xs.length;
    this.xs.push(x);
    this.ys.push(y);
    this.nodeBuckets.add(x, y, id);
    return id;
  }

  edge(a: number, b: number, way: number, guessed: boolean): void {
    if (a !== b) this.edges.push({ a, b, way, guessed });
  }
}

/** Builds the walkable network from the `roads` layers of a set of z14 tiles. */
export function buildNetwork(tiles: readonly TileLines[], opts: NetworkOptions): TrailNetwork {
  const unit = (m: number): number => m / opts.mPerUnit;
  const merge = unit(opts.mergeM ?? 1);
  const touch = unit(opts.touchM ?? 2);
  const guess = unit(opts.guessM ?? 10);
  const nb = new NetworkBuilder(merge);

  // Where each line piece ends, so the junction repair knows which ends lie
  // on a tile edge (cut there, joined by the neighbour) and which are real.
  const ends: Array<{ node: number; onEdge: boolean; way: number }> = [];

  for (const { tile, extent, features } of tiles) {
    for (const f of features) {
      if (f.type !== 2) continue;
      const way = wayOf(f.tags);
      if (way === null) continue;
      const wayId = nb.wayId(way);
      for (const part of f.geometry) {
        for (const piece of clipPolyline(part, extent)) {
          let prev = -1;
          piece.forEach(([px, py], i) => {
            const [x, y] = tileToWorld(tile, extent, px, py);
            const id = nb.node(x, y);
            if (prev >= 0) nb.edge(prev, id, wayId, false);
            prev = id;
            if (i === 0 || i === piece.length - 1) {
              const onEdge = px <= 0.001 || py <= 0.001 || px >= extent - 0.001 || py >= extent - 0.001;
              ends.push({ node: id, onEdge, way: wayId });
            }
          });
        }
      }
    }
  }

  // Junction repair. Degrees first: an end that already meets another line
  // (shared vertex, merged) needs nothing.
  const degree = new Map<number, number>();
  for (const e of nb.edges) {
    degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
    degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
  }
  const segBuckets = new Buckets(Math.max(guess * 2, 1));
  nb.edges.forEach((e, i) => segBuckets.addBox(nb.xs[e.a]!, nb.ys[e.a]!, nb.xs[e.b]!, nb.ys[e.b]!, i));

  // Splits are collected first and applied after, so edge indexes stay valid
  // while searching.
  const splits = new Map<number, Array<{ t: number; node: number }>>();
  const extra: Array<{ a: number; b: number; way: number; guessed: boolean }> = [];
  // Ends cut at a tile edge normally merge with the neighbour tile's cut end.
  // When the two tiles simplified the line differently, the cuts land a few
  // metres apart; the same way, cut at the same edge, within `EDGE_REJOIN_M`
  // is the same line and is rejoined for sure.
  const edgeBuckets = new Buckets(Math.max(unit(EDGE_REJOIN_M), 1));
  const edgeEnds = ends.filter((e) => e.onEdge && (degree.get(e.node) ?? 0) === 1);
  edgeEnds.forEach((e, i) => edgeBuckets.add(nb.xs[e.node]!, nb.ys[e.node]!, i));
  const rejoined = new Set<number>();
  edgeEnds.forEach((e, i) => {
    if (rejoined.has(i)) return;
    const x = nb.xs[e.node]!, y = nb.ys[e.node]!;
    let best = -1, bestD = unit(EDGE_REJOIN_M);
    edgeBuckets.near(x, y, bestD, (j) => {
      const o = edgeEnds[j]!;
      if (j === i || rejoined.has(j) || o.way !== e.way || o.node === e.node) return;
      const d = Math.hypot(nb.xs[o.node]! - x, nb.ys[o.node]! - y);
      if (d < bestD) { bestD = d; best = j; }
    });
    if (best >= 0) {
      rejoined.add(i); rejoined.add(best);
      nb.edge(e.node, edgeEnds[best]!.node, e.way, false);
      degree.set(e.node, 2);
      degree.set(edgeEnds[best]!.node, 2);
    }
  });

  for (const end of ends) {
    if (end.onEdge || (degree.get(end.node) ?? 0) !== 1) continue;
    const x = nb.xs[end.node]!, y = nb.ys[end.node]!;
    let bestEdge = -1, bestT = 0, bestD = guess;
    segBuckets.near(x, y, guess, (i) => {
      const e = nb.edges[i]!;
      if (e.a === end.node || e.b === end.node) return;
      const [t, d] = projectOnSegment(x, y, nb.xs[e.a]!, nb.ys[e.a]!, nb.xs[e.b]!, nb.ys[e.b]!);
      if (d < bestD) { bestD = d; bestEdge = i; bestT = t; }
    });
    if (bestEdge < 0) continue;
    const e = nb.edges[bestEdge]!;
    // Join at the nearest existing vertex if the projection lands on one.
    let target: number;
    if (bestT <= 0.0001) target = e.a;
    else if (bestT >= 0.9999) target = e.b;
    else {
      const px = nb.xs[e.a]! + bestT * (nb.xs[e.b]! - nb.xs[e.a]!);
      const py = nb.ys[e.a]! + bestT * (nb.ys[e.b]! - nb.ys[e.a]!);
      target = nb.xs.length;
      nb.xs.push(px);
      nb.ys.push(py);
      const list = splits.get(bestEdge) ?? [];
      list.push({ t: bestT, node: target });
      splits.set(bestEdge, list);
    }
    if (bestD <= touch) {
      // Touching: same place, so the end and the target become one by a
      // zero-length sure link.
      extra.push({ a: end.node, b: target, way: end.way, guessed: false });
    } else {
      extra.push({ a: end.node, b: target, way: end.way, guessed: true });
    }
  }

  const edges: Array<{ a: number; b: number; way: number; guessed: boolean }> = [];
  nb.edges.forEach((e, i) => {
    const list = splits.get(i);
    if (list === undefined) { edges.push(e); return; }
    list.sort((p, q) => p.t - q.t);
    let from = e.a;
    for (const s of list) { if (s.node !== from) edges.push({ ...e, a: from, b: s.node }); from = s.node; }
    if (from !== e.b) edges.push({ ...e, a: from, b: e.b });
  });
  edges.push(...extra);

  const nodeCount = nb.xs.length;
  const xy = new Float64Array(nodeCount * 2);
  for (let i = 0; i < nodeCount; i++) { xy[2 * i] = nb.xs[i]!; xy[2 * i + 1] = nb.ys[i]!; }

  // Drop exact duplicates (the same segment from two overlapping tiles that
  // both survived clipping, e.g. lines running along a tile edge).
  const seen = new Set<string>();
  const out: TrailEdge[] = [];
  for (const e of edges) {
    const lo = Math.min(e.a, e.b), hi = Math.max(e.a, e.b);
    const k = `${lo},${hi}`;
    if (lo === hi || seen.has(k)) continue;
    seen.add(k);
    const length = Math.hypot(xy[2 * e.a]! - xy[2 * e.b]!, xy[2 * e.a + 1]! - xy[2 * e.b + 1]!);
    out.push({ a: e.a, b: e.b, length, way: e.way, guessed: e.guessed });
  }
  const adjacency: number[][] = Array.from({ length: nodeCount }, () => []);
  out.forEach((e, i) => { adjacency[e.a]!.push(i); adjacency[e.b]!.push(i); });
  return { xy, nodeCount, edges: out, ways: nb.ways, adjacency };
}
