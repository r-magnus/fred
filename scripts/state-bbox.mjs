/**
 * The area a state's map covers: its Census boundary box plus a margin.
 *
 * Shared by build-state-map.mjs and build-state-contours.mjs so the basemap and
 * its contours always cover exactly the same ground.
 *
 * The margin keeps map under a fix near a border: the boundaries are the
 * 1:20M cartographic set, simplified by up to ~9 km on a coastline.
 *
 * Longitudes are clamped to -180..180. Alaska's box would otherwise start at
 * -189 because the Aleutians cross the antimeridian, which neither
 * `pmtiles extract` nor a Web Mercator tile range can take. The cost is the
 * westernmost Aleutians (Attu, Agattu, the Near Islands) have no map.
 */
import { STATE_BOUNDARIES } from '../packages/geo/src/us-states.ts';

export const PAD = 0.15;

export function stateBbox(state) {
  const b = STATE_BOUNDARIES[state.toUpperCase()];
  if (b === undefined) return undefined;
  const [minLon, minLat, maxLon, maxLat] = b.bbox;
  const clampLon = (v) => Math.min(180, Math.max(-180, v));
  return [clampLon(minLon - PAD), minLat - PAD, clampLon(maxLon + PAD), maxLat + PAD];
}

export const knownStates = () => Object.keys(STATE_BOUNDARIES).sort().join(' ');
