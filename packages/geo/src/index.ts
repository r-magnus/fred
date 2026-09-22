/**
 * Turning a GPS fix into a place, offline.
 *
 * Fred cannot use Location.reverseGeocodeAsync for this. On Android that call
 * goes through the platform Geocoder, which needs a network round trip — so it
 * fails in the exact situation Fred is built for. Everything here is local
 * arithmetic over a bundled boundary table.
 *
 * Deliberately free of React Native so the eval harness and `node --test` can
 * use it; the expo-location wrapper lives in the app.
 */
import { STATE_BOUNDARIES } from './us-states.ts';

/** A ring is flattened [lon, lat, lon, lat, …] — it halves the generated file. */
export interface StateBoundary {
  /** [minLon, minLat, maxLon, maxLat] — a cheap reject before walking rings. */
  readonly bbox: readonly [number, number, number, number];
  readonly rings: readonly (readonly number[])[];
}

/** USPS code -> outline. Keys are what PackScope `us-state` carries. */
export type StateBoundaries = Readonly<Record<string, StateBoundary>>;

export { STATE_BOUNDARIES };

/**
 * Ray casting, counting crossings of a horizontal ray to the east.
 *
 * Treats longitude and latitude as plane coordinates. That is wrong in general,
 * but the error is in the *shape* of a degree cell, not in which cell a point
 * falls in, and ray casting only ever compares a point against edges near its
 * own latitude. Antimeridian crossings would break it; no US state has one.
 */
function ringContains(ring: readonly number[], lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i]!, yi = ring[i + 1]!;
    const xj = ring[j]!, yj = ring[j + 1]!;
    // Half-open in latitude, so a vertex exactly at `lat` is counted once.
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Mean Earth radius, km. */
const EARTH_KM = 6371;

/**
 * How far outside every polygon a point may be and still count as that state.
 *
 * The 1:20M coastline is simplified hard — Oahu is seven vertices, and Puget
 * Sound and the Chesapeake lose their inlets — so a real position on a beach or
 * an island lands outside every polygon. Measured shortfalls: Honolulu 4.5 km,
 * the San Juan Islands 0.2 km, the lower Chesapeake 8.5 km. 15 km covers those
 * with margin and still rejects Ensenada (79 km) and Ottawa (71 km).
 *
 * It cannot distinguish "offshore" from "just over an international border":
 * Tijuana sits 3.2 km from the simplified California outline and Windsor 2.5 km
 * from Michigan, so both resolve to the neighbouring US state. No threshold
 * fixes that — the data has no border concept — and for picking a
 * flora-and-fauna pack the neighbouring state is the right answer anyway.
 *
 * Containment always wins over the fallback, so it never overrides a state the
 * user is actually standing in.
 */
const SNAP_KM = 15;

/** Squared distance, km², from a point to a segment on a local flat projection. */
function segmentDistanceSq(
  lon: number, lat: number,
  aLon: number, aLat: number,
  bLon: number, bLat: number,
  lonScale: number,
): number {
  const px = (lon - aLon) * lonScale, py = lat - aLat;
  const vx = (bLon - aLon) * lonScale, vy = bLat - aLat;
  const len = vx * vx + vy * vy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, (px * vx + py * vy) / len));
  const dx = px - t * vx, dy = py - t * vy;
  const deg = (Math.PI / 180) * EARTH_KM;
  return (dx * dx + dy * dy) * deg * deg;
}

/**
 * The USPS code for a coordinate, or null when it is nowhere near a US state.
 *
 * Accuracy is the boundary set's, not the GPS fix's: a few hundred metres of
 * slop along a state line, so a user within sight of a border may get the
 * neighbour. For choosing which flora-and-fauna pack to search that is
 * harmless — the biology does not change at the line either — and it beats the
 * alternative of needing signal to know where you are.
 */
export function stateForCoords(
  latitude: number,
  longitude: number,
  boundaries: StateBoundaries = STATE_BOUNDARIES,
): string | null {
  let nearest: string | null = null;
  let nearestSq = SNAP_KM * SNAP_KM;
  // Longitude degrees shrink with latitude; without this, distances in Alaska
  // would be overstated by more than half.
  const lonScale = Math.cos((latitude * Math.PI) / 180);
  // A bbox grown by the snap distance, so the reject still admits candidates
  // the fallback could legitimately claim.
  const padLat = SNAP_KM / 111;
  const padLon = padLat / Math.max(lonScale, 0.1);

  for (const code in boundaries) {
    const b = boundaries[code]!;
    if (longitude < b.bbox[0] - padLon || longitude > b.bbox[2] + padLon) continue;
    if (latitude < b.bbox[1] - padLat || latitude > b.bbox[3] + padLat) continue;
    for (const ring of b.rings) {
      if (ringContains(ring, longitude, latitude)) return code;
      for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
        const d = segmentDistanceSq(
          longitude, latitude, ring[j]!, ring[j + 1]!, ring[i]!, ring[i + 1]!, lonScale);
        if (d < nearestSq) { nearestSq = d; nearest = code; }
      }
    }
  }
  return nearest;
}

/** How far the fallback reached, in km, or 0 when the point was contained. */
export const SNAP_DISTANCE_KM = SNAP_KM;

// Drive-test recording and fix selection — see fix.ts.
export {
  isBetterFix, meetsTarget, summariseTrack, toTrackRow, TRACK_HEADER,
  type Reading, type TrackSample, type TrackSummary,
} from './fix.ts';

// B-KR3 coverage search — see coverage.ts.
export {
  COVERAGE_RES, toCoverageIndex, nearestCoverage, describeBearing,
  type CoverageIndex, type NearestCoverage,
} from './coverage.ts';

export { encodeCells, decodeCells } from './coverage-codec.ts';
