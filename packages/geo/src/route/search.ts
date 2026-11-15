/**
 * One search over trails and open ground together (#223).
 *
 * The graph has two kinds of node: every grid cell, and every node of the
 * trail network. Cells link to their eight neighbours (off-trail steps, costed
 * by slope and cover); trail nodes link along their edges (on-path steps); and
 * each trail node links to the cell it sits in (stepping on or off the trail).
 * A* over that finds routes that keep to trails where trails go, leave them
 * where they don't, and climb back onto the next trail when it pays.
 *
 * Node numbering: cells are 0..cells-1, trail node k is cells + k.
 */

import {
  COVER_FACTOR, GUESSED_JOIN_WEIGHT, LEAVE_TRAIL_WEIGHT_S, MAX_OFF_TRAIL_GRADE, MAX_SPEED, OFF_PATH_FACTOR,
  OFF_TRAIL_WEIGHT, STREAM_CROSSING_S, WAY_WEIGHT, toblerSpeed, trailTime,
} from './cost.ts';
import { CELL_BLOCKED, CELL_STREAM, cellAt, heightAt, type Grid } from './terrain.ts';
import type { TrailNetwork } from './trails.ts';

/** How a step was taken: a trail edge index (≥ 0), or one of these. */
export const VIA_GRID = -1;
export const VIA_CONNECT = -2;
export const VIA_START = -3;

export interface SearchGraph {
  readonly grid: Grid;
  readonly net: TrailNetwork;
  readonly mPerUnit: number;
  /** Height of each trail node, metres. */
  readonly nodeElev: Float32Array;
  /** CSR lists of the trail nodes inside each cell. */
  readonly cellNodeStart: Int32Array;
  readonly cellNodes: Int32Array;
}

export function buildSearchGraph(grid: Grid, net: TrailNetwork, mPerUnit: number): SearchGraph {
  const cells = grid.cols * grid.rows;
  const nodeElev = new Float32Array(net.nodeCount);
  const cellOf = new Int32Array(net.nodeCount);
  const counts = new Int32Array(cells + 1);
  for (let k = 0; k < net.nodeCount; k++) {
    const x = net.xy[2 * k]!, y = net.xy[2 * k + 1]!;
    nodeElev[k] = heightAt(grid, x, y);
    const c = cellAt(grid, x, y);
    cellOf[k] = c;
    if (c >= 0) counts[c + 1]!++;
  }
  for (let i = 0; i < cells; i++) counts[i + 1]! += counts[i]!;
  const cellNodes = new Int32Array(counts[cells]!);
  const fill = counts.slice(0, cells);
  for (let k = 0; k < net.nodeCount; k++) {
    const c = cellOf[k]!;
    if (c >= 0) cellNodes[fill[c]!++] = k;
  }
  return { grid, net, mPerUnit, nodeElev, cellNodeStart: counts, cellNodes };
}

/** Whether a cell can be stood in off trail. */
export function walkableCell(g: Grid, c: number): boolean {
  return (g.flags[c]! & CELL_BLOCKED) === 0 && COVER_FACTOR[g.cover[c]! as keyof typeof COVER_FACTOR] > 0;
}

/** Min-heap of (key, value), lazy deletion by the caller. */
class Heap {
  private keys = new Float64Array(1024);
  private vals = new Int32Array(1024);
  size = 0;
  push(k: number, v: number): void {
    if (this.size === this.keys.length) {
      const nk = new Float64Array(this.size * 2); nk.set(this.keys); this.keys = nk;
      const nv = new Int32Array(this.size * 2); nv.set(this.vals); this.vals = nv;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p]! <= k) break;
      this.keys[i] = this.keys[p]!; this.vals[i] = this.vals[p]!; i = p;
    }
    this.keys[i] = k; this.vals[i] = v;
  }
  /** Pops the smallest; returns its value, its key in `lastKey`. */
  lastKey = 0;
  pop(): number {
    const top = this.vals[0]!;
    this.lastKey = this.keys[0]!;
    const k = this.keys[--this.size]!, v = this.vals[this.size]!;
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.keys[c + 1]! < this.keys[c]!) c++;
      if (this.keys[c]! >= k) break;
      this.keys[i] = this.keys[c]!; this.vals[i] = this.vals[c]!; i = c;
    }
    this.keys[i] = k; this.vals[i] = v;
    return top;
  }
}

export interface Step {
  /** Seconds, honest estimate. */
  readonly time: number;
  /** Search ranking cost. */
  readonly weight: number;
}

const DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

/** Off-trail step between two points, or null when it can't be walked. */
export function offTrailStep(
  meters: number, rise: number, cover: number, stream: boolean, gradeOver = meters,
): Step | null {
  // `gradeOver` floors the run the grade is measured over. Steps between a
  // trail point and its cell centre are a few metres long, and the height
  // difference between them is interpolation, not terrain: over 5 m it reads
  // as a cliff. Measured over one cell, it reads as the slope it is.
  const run = Math.max(meters, gradeOver);
  const grade = run > 0 ? rise / run : 0;
  if (Math.abs(grade) > MAX_OFF_TRAIL_GRADE) return null;
  const factor = COVER_FACTOR[cover as keyof typeof COVER_FACTOR];
  if (!(factor > 0)) return null;
  const time = meters / (toblerSpeed(grade) * OFF_PATH_FACTOR * factor) + (stream ? STREAM_CROSSING_S : 0);
  return { time, weight: time * OFF_TRAIL_WEIGHT };
}

export interface SearchResult {
  /** Node sequence, start first. */
  readonly nodes: number[];
  /** How each node was reached (`via[0]` is VIA_START). */
  readonly via: number[];
  readonly time: number;
}

export interface Endpoint {
  /** A graph node, and the cost already spent reaching it from the true point. */
  readonly node: number;
  readonly time: number;
  readonly weight: number;
}

/** A* from any of `starts` to any of `goals`. */
export function search(
  sg: SearchGraph, starts: readonly Endpoint[], goals: readonly Endpoint[], goalX: number, goalY: number,
): SearchResult | null {
  const { grid, net, mPerUnit, nodeElev } = sg;
  const cells = grid.cols * grid.rows;
  const total = cells + net.nodeCount;
  const best = new Float64Array(total).fill(Infinity);
  const time = new Float64Array(total);
  const prev = new Int32Array(total).fill(-1);
  const via = new Int32Array(total).fill(VIA_START);
  const done = new Uint8Array(total);
  const goalExtra = new Map<number, Endpoint>();
  for (const g of goals) {
    const old = goalExtra.get(g.node);
    if (old === undefined || g.weight < old.weight) goalExtra.set(g.node, g);
  }

  const posOf = (v: number): [number, number] => {
    if (v < cells) {
      const cx = v % grid.cols, cy = (v - cx) / grid.cols;
      return [grid.x0 + (cx + 0.5) * grid.cell, grid.y0 + (cy + 0.5) * grid.cell];
    }
    const k = v - cells;
    return [net.xy[2 * k]!, net.xy[2 * k + 1]!];
  };
  const h = (v: number): number => {
    const [x, y] = posOf(v);
    return (Math.hypot(x - goalX, y - goalY) * mPerUnit) / MAX_SPEED;
  };

  const cellMeters = grid.cell * mPerUnit;
  const heap = new Heap();
  for (const s of starts) {
    if (s.weight < best[s.node]!) {
      best[s.node] = s.weight; time[s.node] = s.time; prev[s.node] = -1; via[s.node] = VIA_START;
      heap.push(s.weight + h(s.node), s.node);
    }
  }

  let bestGoal = -1;
  let bestGoalWeight = Infinity;
  const relax = (u: number, v: number, step: Step, how: number): void => {
    const w = best[u]! + step.weight;
    if (w < best[v]!) {
      best[v] = w; time[v] = time[u]! + step.time; prev[v] = u; via[v] = how;
      heap.push(w + h(v), v);
    }
  };

  while (heap.size > 0) {
    const u = heap.pop();
    if (done[u]) continue;
    if (heap.lastKey >= bestGoalWeight) break;
    done[u] = 1;
    const ge = goalExtra.get(u);
    if (ge !== undefined && best[u]! + ge.weight < bestGoalWeight) {
      bestGoalWeight = best[u]! + ge.weight;
      bestGoal = u;
    }
    if (u < cells) {
      // Off-trail neighbours.
      const cx = u % grid.cols, cy = (u - cx) / grid.cols;
      for (const [dx, dy, len] of DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= grid.cols || ny >= grid.rows) continue;
        const v = ny * grid.cols + nx;
        if (done[v] || !walkableCell(grid, v)) continue;
        // No cutting a corner past a blocked cell (a cliff drawn diagonally).
        if (dx !== 0 && dy !== 0 && (!walkableCell(grid, cy * grid.cols + nx) || !walkableCell(grid, ny * grid.cols + cx))) continue;
        const meters = len * grid.cell * mPerUnit;
        const step = offTrailStep(meters, grid.elev[v]! - grid.elev[u]!, grid.cover[v]!, (grid.flags[v]! & CELL_STREAM) !== 0);
        if (step !== null) relax(u, v, step, VIA_GRID);
      }
      // Onto a trail in this cell.
      for (let p = sg.cellNodeStart[u]!; p < sg.cellNodeStart[u + 1]!; p++) {
        const v = cells + sg.cellNodes[p]!;
        if (done[v]) continue;
        const [ux, uy] = posOf(u), [vx, vy] = posOf(v);
        const step = offTrailStep(Math.hypot(ux - vx, uy - vy) * mPerUnit, nodeElev[v - cells]! - grid.elev[u]!, grid.cover[u]!, false, cellMeters);
        if (step !== null) relax(u, v, step, VIA_CONNECT);
      }
    } else {
      const k = u - cells;
      for (const ei of net.adjacency[k]!) {
        const e = net.edges[ei]!;
        const other = e.a === k ? e.b : e.a;
        const v = cells + other;
        if (done[v]) continue;
        const meters = e.length * mPerUnit;
        const way = net.ways[e.way]!;
        const t = trailTime(meters, nodeElev[other]! - nodeElev[k]!, way.detail);
        relax(u, v, { time: t, weight: t * WAY_WEIGHT[way.cls] * (e.guessed ? GUESSED_JOIN_WEIGHT : 1) }, ei);
      }
      // Off the trail into its cell. A trail point in a cell that can't be
      // stood in (a bridge end on a river's cells, a path along a cliff line)
      // may step to the walkable cells around it instead; without that, a map
      // that draws the bridge but not the last few metres beyond it strands
      // the route on the bridge (Kaibab Suspension Bridge, Grand Canyon).
      const [ux, uy] = posOf(u);
      const own = cellAt(grid, ux, uy);
      if (own >= 0) {
        const ox = own % grid.cols, oy = (own - ox) / grid.cols;
        const reach = walkableCell(grid, own) ? 0 : 1;
        for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
          const nx = ox + dx, ny = oy + dy;
          if (nx < 0 || ny < 0 || nx >= grid.cols || ny >= grid.rows) continue;
          const c = ny * grid.cols + nx;
          if (done[c] || !walkableCell(grid, c)) continue;
          const [cxw, cyw] = posOf(c);
          const step = offTrailStep(Math.hypot(ux - cxw, uy - cyw) * mPerUnit, grid.elev[c]! - nodeElev[k]!, grid.cover[c]!, false, cellMeters);
          if (step !== null) relax(u, c, { time: step.time, weight: step.weight + LEAVE_TRAIL_WEIGHT_S }, VIA_CONNECT);
        }
      }
    }
  }
  if (bestGoal < 0) return null;

  const nodes: number[] = [];
  const how: number[] = [];
  for (let v = bestGoal; v >= 0; v = prev[v]!) { nodes.push(v); how.push(via[v]!); }
  nodes.reverse();
  how.reverse();
  return { nodes, via: how, time: time[bestGoal]! + goalExtra.get(bestGoal)!.time };
}
