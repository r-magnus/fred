/**
 * `planRoute`: from where you are to a dropped pin, on foot, offline (#223).
 *
 * Reads the state map archive (trails, roads, land cover, water, cliffs) and
 * the contours archive for the area between the two points, builds the trail
 * network and the ground grid, searches both together, and returns the route
 * as stretches. Each stretch says whether Fred is sure of it:
 *
 * - **sure**: along a mapped trail or road;
 * - **unsure**: off trail, or across a join the map doesn't quite draw.
 *
 * The app draws unsure stretches in the warning colour.
 *
 * The archives are reached through `RouteSources`, so this file has no idea
 * whether the bytes come from a phone's file handle or a test fixture.
 */

import { decodeTile, type TileLayer } from './mvt.ts';
import { COVER_FACTOR, OFF_PATH_FACTOR, OFF_TRAIL_WEIGHT, STEEP_GRADE, STREAM_CROSSING_S, climb, toblerSpeed, trailTime } from './cost.ts';
import {
  lonLatToWorld, metersPerUnit, tilesCovering, worldToLonLat, type TileId,
} from './tiles.ts';
import { buildNetwork, projectOnSegment, type TileLines, type Way, type WayClass } from './trails.ts';
import { buildGrid, cellAt, COVER, CELL_STREAM, type Grid, type TileFeatures } from './terrain.ts';
import {
  buildSearchGraph, search, walkableCell, SearchCancelled, VIA_CONNECT, VIA_GRID,
  type Endpoint, type Pacing, type SearchGraph,
} from './search.ts';

/** Decompressed tile bytes, or null where the archive has no tile. */
export type TileReader = (z: number, x: number, y: number) => Promise<Uint8Array | null>;

export interface RouteSources {
  /** The state basemap (z14 deepest). */
  readonly basemap: TileReader;
  /** The state contours (z12 deepest). Without it, routes assume flat ground. */
  readonly contours?: TileReader;
}

export interface LonLat { readonly lon: number; readonly lat: number }

export type RouteNote = 'steep' | 'stream' | 'wetland' | 'scrub' | 'rock' | 'major-road' | 'steps';

export interface RouteStretch {
  readonly kind: 'path' | 'off-trail' | 'guessed-join';
  readonly sure: boolean;
  /** For paths: the way's class, basemap detail and name. */
  readonly cls: WayClass | null;
  readonly detail: string | null;
  readonly name: string | null;
  readonly meters: number;
  readonly seconds: number;
  readonly ascent: number;
  readonly descent: number;
  readonly notes: readonly RouteNote[];
  /** [lon, lat] */
  readonly coords: ReadonlyArray<readonly [number, number]>;
}

export interface Route {
  readonly stretches: readonly RouteStretch[];
  readonly meters: number;
  readonly seconds: number;
  readonly ascent: number;
  readonly descent: number;
  readonly offTrailMeters: number;
  readonly unsureMeters: number;
  readonly straightMeters: number;
  /** Every note any stretch carries, once. */
  readonly notes: readonly RouteNote[];
  /** Whether heights came from contours (false: the climb figures are 0). */
  readonly hasElevation: boolean;
}

export type PlanFailure =
  | 'too-far'
  | 'no-map'
  | 'start-unwalkable'
  | 'destination-unwalkable'
  | 'no-route'
  | 'cancelled';

export interface PlanStats {
  readonly basemapTiles: number;
  readonly contourTiles: number;
  readonly cells: number;
  readonly trailNodes: number;
  /** Total, and by phase: reading + decoding tiles, building the graph, searching. */
  readonly ms: number;
  readonly readMs: number;
  readonly buildMs: number;
  readonly searchMs: number;
}

export type PlanResult =
  | { readonly ok: true; readonly route: Route; readonly stats: PlanStats }
  | { readonly ok: false; readonly reason: PlanFailure; readonly stats: PlanStats | null };

export interface PlanOptions {
  /** Straight-line limit. Default 25 km: past that, a walking route is not the answer. */
  readonly maxMeters?: number;
  /** Ground grid cell size. Default 30 m. */
  readonly cellMeters?: number;
  /** Grid cell budget; the cell grows to stay under it. Default 300 000. */
  readonly maxCells?: number;
  /** A point this close to a trail starts or ends on it. Default 25 m. */
  readonly snapMeters?: number;
  /** Basemap zoom to read. Default 14. */
  readonly zoom?: number;
  /** Contour zoom to read. Default 12. */
  readonly contourZoom?: number;
  /**
   * Abort a plan in progress (the pin moved, the sheet closed). Checked
   * between phases and every few thousand search steps.
   */
  readonly signal?: { readonly aborted: boolean };
  /**
   * How to give the event loop a turn. Default `setTimeout(0)`, which in React
   * Native lets touches and JS animations through between search chunks.
   */
  readonly pause?: () => Promise<void>;
}

const defaultPause = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

/** Read through a function: the signal changes while we await, and TS would narrow a direct read. */
const isCancelled = (opts: PlanOptions): boolean => opts.signal?.aborted === true;

const ROUTE_LAYERS = ['roads', 'landuse', 'water', 'earth'];

async function readTiles(
  reader: TileReader, tiles: readonly TileId[], layers: readonly string[],
): Promise<Array<{ tile: TileId; layers: Map<string, TileLayer> }>> {
  const out = await Promise.all(tiles.map(async (tile) => {
    const bytes = await reader(tile.z, tile.x, tile.y);
    return bytes === null ? null : { tile, layers: decodeTile(bytes, layers) };
  }));
  return out.filter((t): t is { tile: TileId; layers: Map<string, TileLayer> } => t !== null);
}

/** Douglas–Peucker on world points, for drawing the zigzag of grid steps. */
function simplify(pts: ReadonlyArray<readonly [number, number]>, tol: number): Array<readonly [number, number]> {
  if (pts.length <= 2) return [...pts];
  const keep = new Uint8Array(pts.length);
  keep[0] = 1; keep[pts.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [i, j] = stack.pop()!;
    let maxD = -1, at = -1;
    for (let k = i + 1; k < j; k++) {
      const [, d] = projectOnSegment(pts[k]![0], pts[k]![1], pts[i]![0], pts[i]![1], pts[j]![0], pts[j]![1]);
      if (d > maxD) { maxD = d; at = k; }
    }
    if (maxD > tol && at > 0) { keep[at] = 1; stack.push([i, at], [at, j]); }
  }
  return pts.filter((_, k) => keep[k] === 1);
}

interface Attach {
  readonly ends: Endpoint[];
  /** World points between the true point and each endpoint's node, true point first. */
  readonly legs: Map<number, Array<readonly [number, number]>>;
  /** Whether each endpoint's leg is on a trail (snapped) rather than off trail. */
  readonly onTrail: Map<number, boolean>;
}

/** Ways into the graph from a free point: onto a nearby trail, and/or into its cell. */
function attach(sg: SearchGraph, x: number, y: number, snapUnits: number): Attach {
  const { grid, net, mPerUnit } = sg;
  const cells = grid.cols * grid.rows;
  const ends: Endpoint[] = [];
  const legs = new Map<number, Array<readonly [number, number]>>();
  const onTrail = new Map<number, boolean>();

  // Nearest trail edge within the snap distance.
  let best = -1, bestT = 0, bestD = snapUnits;
  net.edges.forEach((e, i) => {
    const ax = net.xy[2 * e.a]!, ay = net.xy[2 * e.a + 1]!, bx = net.xy[2 * e.b]!, by = net.xy[2 * e.b + 1]!;
    if (Math.min(ax, bx) - snapUnits > x || Math.max(ax, bx) + snapUnits < x) return;
    if (Math.min(ay, by) - snapUnits > y || Math.max(ay, by) + snapUnits < y) return;
    const [t, d] = projectOnSegment(x, y, ax, ay, bx, by);
    if (d < bestD) { bestD = d; best = i; bestT = t; }
  });
  if (best >= 0) {
    const e = net.edges[best]!;
    const ax = net.xy[2 * e.a]!, ay = net.xy[2 * e.a + 1]!, bx = net.xy[2 * e.b]!, by = net.xy[2 * e.b + 1]!;
    const px = ax + bestT * (bx - ax), py = ay + bestT * (by - ay);
    const flat = toblerSpeed(0);
    for (const [node, frac] of [[e.a, bestT], [e.b, 1 - bestT]] as const) {
      const along = frac * e.length * mPerUnit;
      const t = bestD * mPerUnit / (flat * OFF_PATH_FACTOR) + along / flat;
      const id = cells + node;
      ends.push({ node: id, time: t, weight: t });
      legs.set(id, [[x, y], [px, py]]);
      onTrail.set(id, true);
    }
  }

  // Its cell, or the nearest walkable cell within ~100 m.
  let c = cellAt(grid, x, y);
  if (c < 0 || !walkableCell(grid, c)) {
    c = -1;
    const cx = Math.floor((x - grid.x0) / grid.cell), cy = Math.floor((y - grid.y0) / grid.cell);
    const reach = Math.ceil(100 / (grid.cell * mPerUnit));
    let bestCell = Infinity;
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= grid.cols || ny >= grid.rows) continue;
      const i = ny * grid.cols + nx;
      const d = dx * dx + dy * dy;
      if (d < bestCell && walkableCell(grid, i)) { bestCell = d; c = i; }
    }
  }
  if (c >= 0) {
    const ccx = c % grid.cols, ccy = (c - ccx) / grid.cols;
    const wx = grid.x0 + (ccx + 0.5) * grid.cell, wy = grid.y0 + (ccy + 0.5) * grid.cell;
    const meters = Math.hypot(wx - x, wy - y) * mPerUnit;
    const t = meters / (toblerSpeed(0) * OFF_PATH_FACTOR * (COVER_FACTOR[grid.cover[c]! as keyof typeof COVER_FACTOR] || 1));
    // Weighted like any off-trail time, so a trail within reach wins.
    ends.push({ node: c, time: t, weight: t * OFF_TRAIL_WEIGHT });
    legs.set(c, [[x, y], [wx, wy]]);
    onTrail.set(c, false);
  }
  return { ends, legs, onTrail };
}

interface RawStep {
  kind: RouteStretch['kind'];
  way: number;
  meters: number;
  seconds: number;
  rise: number;
  /** Heights along the step's points (first point included). */
  profile: number[];
  notes: Set<RouteNote>;
  pts: Array<readonly [number, number]>;
}

function pointOf(sg: SearchGraph, v: number): readonly [number, number] {
  const g = sg.grid;
  const cells = g.cols * g.rows;
  if (v < cells) {
    const cx = v % g.cols, cy = (v - cx) / g.cols;
    return [g.x0 + (cx + 0.5) * g.cell, g.y0 + (cy + 0.5) * g.cell];
  }
  const k = v - cells;
  return [sg.net.xy[2 * k]!, sg.net.xy[2 * k + 1]!];
}

function elevAt(sg: SearchGraph, v: number): number {
  const cells = sg.grid.cols * sg.grid.rows;
  return v < cells ? sg.grid.elev[v]! : sg.nodeElev[v - cells]!;
}

function coverNotes(g: Grid, c: number, notes: Set<RouteNote>): void {
  const cover = g.cover[c]!;
  if (cover === COVER.wetland) notes.add('wetland');
  else if (cover === COVER.scrub) notes.add('scrub');
  else if (cover === COVER.rock) notes.add('rock');
  if ((g.flags[c]! & CELL_STREAM) !== 0) notes.add('stream');
}

export async function planRoute(
  sources: RouteSources, from: LonLat, to: LonLat, opts: PlanOptions = {},
): Promise<PlanResult> {
  const t0 = Date.now();
  const zoom = opts.zoom ?? 14;
  const contourZoom = opts.contourZoom ?? 12;
  const midLat = (from.lat + to.lat) / 2;
  const mPerUnit = metersPerUnit(midLat);
  const [fx, fy] = lonLatToWorld(from.lon, from.lat);
  const [tx, ty] = lonLatToWorld(to.lon, to.lat);
  const straightMeters = Math.hypot(tx - fx, ty - fy) * mPerUnit;
  if (straightMeters > (opts.maxMeters ?? 25_000)) return { ok: false, reason: 'too-far', stats: null };

  let margin = Math.max(1500, 0.35 * straightMeters);
  for (let attempt = 0; ; attempt++) {
    if (isCancelled(opts)) return { ok: false, reason: 'cancelled', stats: null };
    const result = await planWithin(sources, fx, fy, tx, ty, margin / mPerUnit, mPerUnit, straightMeters, zoom, contourZoom, opts, t0);
    // A detour the box was too small for: one retry with room to go round.
    if (result.ok || result.reason !== 'no-route' || attempt >= 1) return result;
    margin *= 2.5;
  }
}

async function planWithin(
  sources: RouteSources, fx: number, fy: number, tx: number, ty: number, marginUnits: number,
  mPerUnit: number, straightMeters: number, zoom: number, contourZoom: number, opts: PlanOptions, t0: number,
): Promise<PlanResult> {
  const box = {
    minX: Math.min(fx, tx) - marginUnits, minY: Math.min(fy, ty) - marginUnits,
    maxX: Math.max(fx, tx) + marginUnits, maxY: Math.max(fy, ty) + marginUnits,
  };
  const area = ((box.maxX - box.minX) * mPerUnit) * ((box.maxY - box.minY) * mPerUnit);
  const cellMeters = Math.max(opts.cellMeters ?? 30, Math.sqrt(area / (opts.maxCells ?? 300_000)));

  const tRead = Date.now();
  const baseTiles = await readTiles(sources.basemap, tilesCovering(zoom, box.minX, box.minY, box.maxX, box.maxY), ROUTE_LAYERS);
  const contourTiles = sources.contours === undefined ? []
    : await readTiles(sources.contours, tilesCovering(contourZoom, box.minX, box.minY, box.maxX, box.maxY), ['contours']);

  const lines: TileLines[] = [];
  const ground: TileFeatures[] = [];
  for (const { tile, layers } of baseTiles) {
    for (const [name, layer] of layers) {
      if (name === 'roads') lines.push({ tile, extent: layer.extent, features: layer.features });
      else ground.push({ tile, extent: layer.extent, layer: name, features: layer.features });
    }
  }
  const contours: TileFeatures[] = [];
  for (const { tile, layers } of contourTiles) {
    const layer = layers.get('contours');
    if (layer !== undefined) contours.push({ tile, extent: layer.extent, layer: 'contours', features: layer.features });
  }

  const pause = opts.pause ?? defaultPause;
  const tBuild = Date.now();
  const net = buildNetwork(lines, { mPerUnit });
  await pause();
  if (isCancelled(opts)) return { ok: false, reason: 'cancelled', stats: null };
  const grid = buildGrid({ box, cell: cellMeters / mPerUnit, basemap: ground, contours });
  await pause();
  const sg = buildSearchGraph(grid, net, mPerUnit);
  const tSearch = Date.now();
  let searchMs = 0;
  const stats = (): PlanStats => ({
    basemapTiles: baseTiles.length, contourTiles: contourTiles.length,
    cells: grid.cols * grid.rows, trailNodes: net.nodeCount, ms: Date.now() - t0,
    readMs: tBuild - tRead, buildMs: tSearch - tBuild, searchMs,
  });
  if (baseTiles.length === 0) return { ok: false, reason: 'no-map', stats: stats() };

  const snap = (opts.snapMeters ?? 25) / mPerUnit;
  const start = attach(sg, fx, fy, snap);
  const goal = attach(sg, tx, ty, snap);
  if (start.ends.length === 0) return { ok: false, reason: 'start-unwalkable', stats: stats() };
  if (goal.ends.length === 0) return { ok: false, reason: 'destination-unwalkable', stats: stats() };

  const pacing: Pacing = { pause: opts.pause ?? defaultPause, every: 4096, signal: opts.signal };
  await pacing.pause();
  if (isCancelled(opts)) return { ok: false, reason: 'cancelled', stats: stats() };
  let found;
  try {
    found = await search(sg, start.ends, goal.ends, tx, ty, pacing);
  } catch (e) {
    if (e instanceof SearchCancelled) return { ok: false, reason: 'cancelled', stats: stats() };
    throw e;
  }
  searchMs = Date.now() - tSearch;
  if (found === null) return { ok: false, reason: 'no-route', stats: stats() };

  const route = assemble(sg, found.nodes, found.via, start, goal, straightMeters);
  return { ok: true, route, stats: stats() };
}

function assemble(
  sg: SearchGraph, nodes: readonly number[], via: readonly number[], start: Attach, goal: Attach, straightMeters: number,
): Route {
  const { grid, net, mPerUnit } = sg;
  const steps: RawStep[] = [];
  const first = nodes[0]!, last = nodes[nodes.length - 1]!;

  const legStep = (pts: ReadonlyArray<readonly [number, number]>, trail: boolean): RawStep => {
    let meters = 0;
    for (let i = 1; i < pts.length; i++) meters += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]) * mPerUnit;
    return {
      kind: trail ? 'path' : 'off-trail', way: -1, meters,
      seconds: meters / (toblerSpeed(0) * (trail ? 1 : OFF_PATH_FACTOR)), rise: 0, profile: [], notes: new Set(), pts: [...pts],
    };
  };

  const startLeg = start.legs.get(first) ?? [];
  if (startLeg.length > 0) steps.push(legStep(startLeg, start.onTrail.get(first) === true));

  for (let i = 1; i < nodes.length; i++) {
    const u = nodes[i - 1]!, v = nodes[i]!, how = via[i]!;
    const a = pointOf(sg, u), b = pointOf(sg, v);
    const meters = Math.hypot(b[0] - a[0], b[1] - a[1]) * mPerUnit;
    const rise = elevAt(sg, v) - elevAt(sg, u);
    const grade = meters > 0 ? rise / meters : 0;
    const notes = new Set<RouteNote>();
    if (how === VIA_GRID || how === VIA_CONNECT) {
      const c = v < grid.cols * grid.rows ? v : u;
      coverNotes(grid, c, notes);
      if (Math.abs(grade) > STEEP_GRADE) notes.add('steep');
      const f = COVER_FACTOR[grid.cover[c]! as keyof typeof COVER_FACTOR] || 1;
      steps.push({
        kind: 'off-trail', way: -1, meters, rise, profile: [elevAt(sg, u), elevAt(sg, v)], notes, pts: [a, b],
        seconds: meters / (toblerSpeed(grade) * OFF_PATH_FACTOR * f) + (notes.has('stream') && how === VIA_GRID ? STREAM_CROSSING_S : 0),
      });
    } else {
      const e = net.edges[how]!;
      const way: Way = net.ways[e.way]!;
      if (way.cls === 'major-road') notes.add('major-road');
      if (way.detail === 'steps') notes.add('steps');
      steps.push({
        kind: e.guessed ? 'guessed-join' : 'path', way: e.way, meters, rise, profile: [elevAt(sg, u), elevAt(sg, v)], notes, pts: [a, b],
        seconds: trailTime(meters, rise, way.detail),
      });
    }
  }

  const goalLeg = goal.legs.get(last);
  if (goalLeg !== undefined) steps.push(legStep([...goalLeg].reverse(), goal.onTrail.get(last) === true));

  // Merge steps into stretches. A snapped start/end leg (way -1, path) joins
  // the trail stretch next to it rather than standing alone.
  const merged: RawStep[] = [];
  for (const s of steps) {
    if (s.meters === 0 && s.kind !== 'guessed-join') continue;
    const prev = merged[merged.length - 1];
    const sameWay = prev !== undefined && prev.kind === s.kind
      && (prev.way === s.way || (s.kind === 'path' && (prev.way === -1 || s.way === -1)));
    if (prev !== undefined && sameWay) {
      prev.meters += s.meters; prev.seconds += s.seconds;
      if (prev.way === -1) prev.way = s.way;
      for (const n of s.notes) prev.notes.add(n);
      prev.pts.push(...s.pts.slice(1));
      prev.profile.push(...s.profile.slice(prev.profile.length > 0 ? 1 : 0));
    } else {
      merged.push({ ...s, notes: new Set(s.notes), pts: [...s.pts], profile: [...s.profile] });
    }
  }

  const stretches: RouteStretch[] = merged.map((s) => {
    const way = s.way >= 0 ? net.ways[s.way]! : null;
    const tol = s.kind === 'off-trail' ? grid.cell * 0.6 : 0.5;
    const coords = simplify(s.pts, tol).map(([x, y]) => worldToLonLat(x, y) as readonly [number, number]);
    const { up, down } = climb(s.profile);
    return {
      kind: s.kind,
      sure: s.kind === 'path',
      cls: way?.cls ?? null,
      detail: way?.detail ?? null,
      name: way?.name ?? null,
      meters: s.meters,
      seconds: s.seconds,
      ascent: up,
      descent: down,
      notes: [...s.notes],
      coords,
    };
  });

  const sum = (f: (s: RouteStretch) => number): number => stretches.reduce((a, s) => a + f(s), 0);
  const notes = new Set<RouteNote>();
  for (const s of stretches) for (const n of s.notes) notes.add(n);
  const whole = climb(merged.flatMap((s) => s.profile));
  return {
    stretches,
    meters: sum((s) => s.meters),
    seconds: sum((s) => s.seconds),
    ascent: whole.up,
    descent: whole.down,
    offTrailMeters: sum((s) => (s.kind === 'off-trail' ? s.meters : 0)),
    unsureMeters: sum((s) => (s.sure ? 0 : s.meters)),
    straightMeters,
    notes: [...notes],
    hasElevation: grid.hasElevation,
  };
}
