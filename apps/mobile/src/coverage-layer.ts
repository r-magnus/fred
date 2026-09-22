/**
 * B-KR3 on the map: where carriers report signal, and which way to walk.
 *
 * Loads the coverage pack written by tools/ingest/src/coverage-pack.ts —
 * gzipped delta varints, 7.1 KB for California's three major LTE carriers —
 * and turns the cells near the user into polygons MapLibre can shade.
 *
 * This imports h3-js, which needs scripts/patch-h3-hermes.mjs to load at all
 * under Hermes. Kept in its own module, and off '@fred/geo''s barrel, so the
 * chat path never pulls it in.
 */
import { File, Paths } from 'expo-file-system';
import { gunzipSync } from 'fflate';
import { cellToBoundary, latLngToCell } from 'h3-js';
import {
  decodeCells, nearestCoverage, describeBearing, COVERAGE_RES,
  type CoverageIndex,
} from '@fred/geo/coverage';

/** Staged per state, like the flora packs. */
export const coverageFile = (state: string): string => `coverage-${state}-lte.bin`;

/**
 * Read and decode a state's coverage pack. Null when it is not on the device.
 *
 * Async because SDK 57's File is Blob-like and its reads return promises. The
 * pack is a few kilobytes, so this is one await at screen open, not per frame.
 */
export async function loadCoverage(state: string): Promise<CoverageIndex | null> {
  const f = new File(Paths.document, coverageFile(state));
  if (!f.exists) return null;
  return new Set(decodeCells(gunzipSync(new Uint8Array(await f.arrayBuffer()))));
}

export interface CoverageView {
  /** GeoJSON ring per covered cell near the user, for shading. */
  readonly polygons: [number, number][][];
  /** Human-readable answer: null when nothing is in range. */
  readonly advice: string | null;
  /** Metres to the nearest covered cell, for the caller to render distinctly. */
  readonly meters: number | null;
}

/**
 * What to draw and what to say, for a position.
 *
 * `cellToBoundary(cell, true)` returns [lng, lat] pairs, which is GeoJSON order
 * — the non-obvious argument, and getting it wrong silently puts California in
 * the Indian Ocean.
 */
export function coverageNear(
  latitude: number,
  longitude: number,
  index: CoverageIndex,
  maxRings = 25,
): CoverageView {
  const origin = latLngToCell(latitude, longitude, COVERAGE_RES);
  const found = nearestCoverage(origin, index, maxRings);
  if (found === null) {
    const km = Math.round((maxRings * 1.2));
    return { polygons: [], advice: `No reported signal within about ${km} km.`, meters: null };
  }
  const polygons = found.covered.map(
    (c) => cellToBoundary(c, true) as [number, number][],
  );
  // Deliberately "carriers report", not "you will have signal": the source is
  // modelled propagation, least reliable in the canyons and timber Fred is for.
  const advice = found.rings === 0
    ? 'Carriers report signal where you are standing.'
    : `Carriers report signal about ${(found.meters / 1000).toFixed(1)} km `
      + `${describeBearing(found.bearing)}.`;
  return { polygons, advice, meters: found.meters };
}
