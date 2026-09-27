/**
 * B-KR3 — where to walk for signal, offline.
 *
 * `docs/beta-service-coverage.md` settled the data question: FCC Broadband Data
 * Collection publishes mobile coverage on the H3 grid at resolution 9, and
 * truncating those cells to **resolution 7** matches B-KR3's ±1 km rubric
 * almost exactly (~1.2 km edge) while costing 49x fewer cells. California lands
 * well under 100 KB.
 *
 * Everything here is arithmetic over integers and runs with no network, which
 * is the entire point of the product. h3-js is pure JavaScript with zero
 * dependencies — chosen deliberately after the onnxruntime autolinking bug cost
 * this project several days (`docs/results-m3.md`).
 */
import { cellToParent, gridDisk, greatCircleDistance, cellToLatLng, UNITS } from 'h3-js';
import type { CoveragePack } from './coverage-codec.ts';

/** H3 resolution B-KR3 stores and searches at. ~5.16 km², ~1.2 km edge. */
export const COVERAGE_RES = 7;

/**
 * A set of res-7 cell ids with reported coverage: one carrier's, or every
 * carrier's together (`anyCarrier`). Packs keep carriers apart
 * (`CoveragePack`); the search works on whichever set the question is about.
 */
export type CoverageIndex = ReadonlySet<string>;

/**
 * Collapse source cells to the storage resolution.
 *
 * The FCC publishes res 9. Truncation is exact in H3 — a child has exactly one
 * parent — so this is aggregation, not resampling, and a res-7 cell is marked
 * covered when *any* res-9 child under it is. That is deliberately optimistic
 * in the same direction the source data already leans, which is why callers
 * must present this as "carriers report coverage here", never as "you will have
 * signal here".
 */
export function toCoverageIndex(sourceCells: Iterable<string>): CoverageIndex {
  const out = new Set<string>();
  for (const c of sourceCells) out.add(cellToParent(c, COVERAGE_RES));
  return out;
}

export interface NearestCoverage {
  /** Rings walked. Zero means the origin cell itself is covered. */
  readonly rings: number;
  /** Straight-line metres to the nearest covered cell's centre. */
  readonly meters: number;
  /** Compass bearing to walk, degrees from true north. */
  readonly bearing: number;
  /** The covered cell found. */
  readonly cell: string;
  /** Every covered cell within the rings searched, for shading the map. */
  readonly covered: readonly string[];
}

/** Degrees from true north, origin to target. */
function bearingBetween(from: [number, number], to: [number, number]): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const [lat1, lon1] = [toRad(from[0]), toRad(from[1])];
  const [lat2, lon2] = [toRad(to[0]), toRad(to[1])];
  const dLon = lon2 - lon1;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Breadth-first walk outward until a covered cell appears.
 *
 * `gridDisk(origin, k)` is a primitive in H3, so this needs no routing engine,
 * no road network and no network access — it is a search over a few thousand
 * integers. Each ring step is roughly 1.2 km, so `k` is itself a distance
 * estimate.
 *
 * Returns null when nothing is found inside `maxRings`, which is the honest
 * answer: "no reported coverage within N km" beats inventing a direction.
 */
export function nearestCoverage(
  originCell: string,
  index: CoverageIndex,
  maxRings = 25,
): NearestCoverage | null {
  const origin = cellToLatLng(originCell) as [number, number];
  const covered = new Set<string>();
  let found: { cell: string; meters: number; rings: number } | null = null;

  for (let k = 0; k <= maxRings; k++) {
    for (const cell of gridDisk(originCell, k)) {
      if (!index.has(cell) || covered.has(cell)) continue;
      covered.add(cell);
      if (found !== null) continue;
      const m = greatCircleDistance(origin, cellToLatLng(cell) as [number, number], UNITS.m);
      found = { cell, meters: m, rings: k };
    }
    // One extra ring past the hit, so the map has context around the answer
    // rather than a single lonely hexagon at the edge of the search.
    if (found !== null && k >= found.rings + 1) break;
  }
  if (found === null) return null;
  return {
    rings: found.rings,
    meters: found.meters,
    bearing: bearingBetween(origin, cellToLatLng(found.cell) as [number, number]),
    cell: found.cell,
    covered: [...covered],
  };
}

/**
 * What the map says about one cell, for one carrier (issue #58).
 *
 * - `no-service`: no carrier reports coverage. The only place Fred warns that
 *   even 911 may not connect: an emergency call uses any carrier's tower.
 * - `carrier-gap`: your carrier reports nothing, another carrier does. Your
 *   own calls and texts likely fail; 911 may still connect.
 * - `covered`: assumed to have signal, and drawn as nothing.
 *
 * All three are about *reported* coverage: FCC filings are carriers' own
 * propagation models, optimistic in the canyons and timber Fred is for.
 */
export type Zone = 'covered' | 'carrier-gap' | 'no-service';

const unions = new WeakMap<CoveragePack, CoverageIndex>();

/** Every carrier's cells together: where anyone at all reports coverage. */
export function anyCarrier(pack: CoveragePack): CoverageIndex {
  let u = unions.get(pack);
  if (u === undefined) {
    const all = new Set<string>();
    for (const c of pack.carriers) for (const cell of c.cells) all.add(cell);
    unions.set(pack, all);
    u = all;
  }
  return u;
}

/**
 * The carrier's own footprint, or null when the pack has none for it: an
 * unknown carrier, or one that files nothing in this state and roams there.
 * Null means no carrier-gap claim can be made, not that there is no signal.
 */
export function carrierCells(pack: CoveragePack, carrierId: string | null): CoverageIndex | null {
  if (carrierId === null) return null;
  return pack.carriers.find((c) => c.id === carrierId)?.cells ?? null;
}

export function zoneOf(cell: string, pack: CoveragePack, carrierId: string | null): Zone {
  if (!anyCarrier(pack).has(cell)) return 'no-service';
  const mine = carrierCells(pack, carrierId);
  return mine === null || mine.has(cell) ? 'covered' : 'carrier-gap';
}

export interface ZonesNear {
  readonly carrierGap: readonly string[];
  readonly noService: readonly string[];
}

/**
 * The warning cells within `rings` of the origin (25 rings is ~30 km).
 *
 * `inArea` bounds the claim: a state's pack only knows cells inside that
 * state, so outside it (the sea, the next state) absence is not evidence.
 * It receives a cell centre as latitude, longitude.
 */
export function zonesNear(
  originCell: string,
  pack: CoveragePack,
  carrierId: string | null,
  inArea: (latitude: number, longitude: number) => boolean,
  rings = 25,
): ZonesNear {
  const carrierGap: string[] = [];
  const noService: string[] = [];
  for (const cell of gridDisk(originCell, rings)) {
    const zone = zoneOf(cell, pack, carrierId);
    if (zone === 'covered') continue;
    const [lat, lng] = cellToLatLng(cell);
    if (!inArea(lat, lng)) continue;
    (zone === 'no-service' ? noService : carrierGap).push(cell);
  }
  return { carrierGap, noService };
}

/** "north-east", for an instruction a person can act on without a compass rose. */
export function describeBearing(deg: number): string {
  const names = ['north', 'north-east', 'east', 'south-east',
    'south', 'south-west', 'west', 'north-west'];
  return names[Math.round(((deg % 360) + 360) % 360 / 45) % 8]!;
}
