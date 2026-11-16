/**
 * B-KR3 on the map: where your carrier reports nothing, where no carrier does,
 * and which way to walk (issue #58).
 *
 * Loads the coverage pack written by scripts/build-state-coverage.mjs (the
 * FCC's mobile voice layer, carriers kept apart, a few KB per state) and turns
 * the cells near the user into two warning shapes. Everywhere else is assumed
 * to have signal and is drawn as nothing.
 *
 * This imports h3-js, which needs scripts/patch-h3-hermes.mjs to load at all
 * under Hermes. Kept in its own module, and off '@fred/geo''s barrel, so the
 * chat path never pulls it in.
 */
import { File, Paths } from 'expo-file-system';
import { gunzipSync } from 'fflate';
import { cellToLatLng, cellsToMultiPolygon, latLngToCell } from 'h3-js';
import { insideState, MAJOR_CARRIERS } from '@fred/geo';
import { loadCarrier } from './carrier.ts';
import {
  decodePack, nearestCoverage, describeBearing, zoneOf, zonesNear, anyCarrier, carrierCells,
  COVERAGE_RES, type CoveragePack, type NearestCoverage,
} from '@fred/geo/coverage';

/** Staged per state, like the flora packs. */
export const coverageFile = (state: string): string => `coverage-${state}-voice.bin`;

/**
 * Read and decode a state's coverage pack. Null when it is not on the device,
 * or is an old single-layer pack the app can no longer read.
 */
export async function loadCoverage(state: string): Promise<CoveragePack | null> {
  const f = new File(Paths.document, coverageFile(state));
  if (!f.exists) return null;
  try {
    return decodePack(gunzipSync(new Uint8Array(await f.arrayBuffer())));
  } catch {
    return null;
  }
}

/** GeoJSON MultiPolygon coordinates: polygons, rings, [lng, lat] points. */
type MultiPolygon = number[][][][];

export interface CoverageView {
  /** Your carrier reports nothing here; another carrier does. */
  readonly carrierGap: MultiPolygon;
  /** No carrier reports anything: 911 may not connect. */
  readonly noService: MultiPolygon;
  /** Human-readable answer for where the user stands. */
  readonly advice: string;
  /** Name of the carrier the gaps are drawn for, or null when none is. */
  readonly carrierName: string | null;
  /**
   * Where the nearest reported coverage is, when there is none here: the
   * centre of the nearest covered cell, for any carrier when no carrier
   * reports this spot (911), for your own carrier when only it is missing.
   * Null when you have coverage, or none is found within the search. The map
   * suggests a walking route to it for someone who is lost (#226).
   */
  readonly signalAt: { readonly latitude: number; readonly longitude: number; readonly meters: number } | null;
}

/** A carrier's display name: the pack's, then the national list's. */
export function carrierName(pack: CoveragePack | null, id: string | null): string | null {
  if (id === null) return null;
  return pack?.carriers.find((c) => c.id === id)?.name ?? MAJOR_CARRIERS[id] ?? null;
}

const walk = (n: NearestCoverage | null, rings: number): string => n === null
  ? `none within about ${Math.round(rings * 1.2)} km`
  : `about ${(n.meters / 1000).toFixed(1)} km ${describeBearing(n.bearing)}`;

/**
 * What to draw and what to say, for a position.
 *
 * `cellsToMultiPolygon(cells, true)` merges neighbouring hexagons into one
 * outline and returns [lng, lat] pairs, which is GeoJSON order: the
 * non-obvious argument, and getting it wrong silently puts California in the
 * Indian Ocean.
 */
export function coverageNear(
  latitude: number,
  longitude: number,
  state: string,
  pack: CoveragePack,
  carrierId: string | null,
  rings = 25,
): CoverageView {
  const origin = latLngToCell(latitude, longitude, COVERAGE_RES);
  const mine = carrierCells(pack, carrierId);
  const name = carrierName(pack, carrierId);
  // A carrier the pack does not list gets no gap zone: it files nothing in
  // this state, and its phones roam on whoever is there.
  const gapFor = mine === null ? null : carrierId;
  const zones = zonesNear(origin, pack, gapFor, (lat, lng) => insideState(lat, lng, state), rings);
  const shape = (cells: readonly string[]): MultiPolygon =>
    cells.length === 0 ? [] : cellsToMultiPolygon([...cells], true);

  // Deliberately "reports", never "you will have signal": the source is the
  // carriers' own propagation models, least reliable in the canyons and
  // timber Fred is for.
  let advice: string;
  let target: NearestCoverage | null = null;
  const here = zoneOf(origin, pack, gapFor);
  if (here === 'no-service') {
    target = nearestCoverage(origin, anyCarrier(pack), rings);
    advice = 'No carrier reports coverage here, so 911 calls may not connect. '
      + 'Satellite SOS may still work if your phone has it. '
      + `Nearest reported coverage: ${walk(target, rings)}.`
      // For 911 any carrier will do; for your own calls and texts, only yours.
      + (mine === null ? '' : ` ${name}: ${walk(nearestCoverage(origin, mine, rings), rings)}.`);
  } else if (here === 'carrier-gap') {
    target = nearestCoverage(origin, mine!, rings);
    advice = `${name} reports no coverage here. Other carriers do, so 911 may still connect. `
      + `${name} coverage: ${walk(target, rings)}.`;
  } else if (mine !== null) {
    advice = `${name} reports coverage here.`;
  } else if (name !== null) {
    advice = `${name} reports no coverage of its own in ${state}; shown is only where no carrier does.`;
  } else {
    advice = 'A carrier reports coverage here. Set your carrier to see its gaps.';
  }
  return {
    carrierGap: shape(zones.carrierGap),
    noService: shape(zones.noService),
    advice,
    carrierName: gapFor === null ? null : name,
    signalAt: target === null || target.rings === 0 ? null : (() => {
      const [lat, lng] = cellToLatLng(target.cell);
      return { latitude: lat, longitude: lng, meters: target.meters };
    })(),
  };
}

/**
 * The map's advice for a position, for a chat reply to a signal question
 * (#77): the same sentence the map shows, so the two cannot disagree. Null
 * when the position is outside every state or its coverage pack is not on
 * the phone.
 */
export async function signalAdvice(
  fix: { readonly latitude: number; readonly longitude: number; readonly state: string | null },
): Promise<string | null> {
  if (fix.state === null) return null;
  const [pack, carrier] = await Promise.all([loadCoverage(fix.state), loadCarrier()]);
  return pack === null ? null : coverageNear(fix.latitude, fix.longitude, fix.state, pack, carrier.id).advice;
}
