/**
 * Extract one state's basemap from the Protomaps planet.
 *
 * Usage: node scripts/build-state-map.mjs CA [maxzoom] [out-dir]
 *
 * Bounds come from packages/geo's bundled Census boundaries, so the same table
 * that decides which state a GPS fix is in decides what a state's map covers —
 * one source of truth rather than a hand-copied bbox per state.
 *
 * Needs the `pmtiles` CLI on PATH (github.com/protomaps/go-pmtiles). It pulls a
 * region out of the ~120 GB planet archive over HTTP range requests, so nothing
 * downloads the planet: California at z14 took under a minute at an overfetch
 * of 0.05.
 *
 * Sizes are real, measured for California: z12 95 MB, z13 250 MB, z14 598 MB,
 * z15 1417 MB. z14 is the shipping choice — see docs/results-map-research.md.
 * Those predate PAD below. This script's California z14 is 641 MB: its header
 * bounds are the Census bbox plus exactly PAD, about 6% more area.
 */
import { execFileSync } from 'node:child_process';
import { STATE_BOUNDARIES } from '../packages/geo/src/us-states.ts';

const [state, zoomArg, outDir = '.'] = process.argv.slice(2);
if (state === undefined) {
  console.error('usage: build-state-map.mjs <USPS> [maxzoom] [out-dir]');
  process.exit(1);
}
const maxzoom = Number(zoomArg ?? 14);
const b = STATE_BOUNDARIES[state.toUpperCase()];
if (b === undefined) {
  console.error(`unknown state ${state}; known: ${Object.keys(STATE_BOUNDARIES).sort().join(' ')}`);
  process.exit(1);
}

// A little margin so a fix near the border still has map under it — the
// boundaries are the 1:20M cartographic set and are simplified by up to ~9 km
// on a coastline, which is exactly where someone stands and looks at a map.
const PAD = 0.15;
const [minLon, minLat, maxLon, maxLat] = b.bbox;
const bbox = [minLon - PAD, minLat - PAD, maxLon + PAD, maxLat + PAD].map((n) => n.toFixed(4));

const SOURCE = process.env.PMTILES_SOURCE
  ?? 'https://build.protomaps.com/20260920.pmtiles';
const out = `${outDir}/map-${state.toUpperCase()}-z${maxzoom}.pmtiles`;

console.log(`${state.toUpperCase()}  bbox=${bbox.join(',')}  maxzoom=${maxzoom}`);
execFileSync('pmtiles', [
  'extract', SOURCE, out, `--bbox=${bbox.join(',')}`, `--maxzoom=${maxzoom}`,
], { stdio: 'inherit' });
console.log(`\nwrote ${out}`);
