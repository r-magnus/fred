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
 */
import { execFileSync } from 'node:child_process';
import { knownStates, stateBbox } from './state-bbox.mjs';

const [state, zoomArg, outDir = '.'] = process.argv.slice(2);
if (state === undefined) {
  console.error('usage: build-state-map.mjs <USPS> [maxzoom] [out-dir]');
  process.exit(1);
}
const maxzoom = Number(zoomArg ?? 14);
const box = stateBbox(state);
if (box === undefined) {
  console.error(`unknown state ${state}; known: ${knownStates()}`);
  process.exit(1);
}
// Census box plus a margin, shared with the contours (state-bbox.mjs).
const bbox = box.map((n) => n.toFixed(4));

const SOURCE = process.env.PMTILES_SOURCE
  ?? 'https://build.protomaps.com/20260920.pmtiles';
const out = `${outDir}/map-${state.toUpperCase()}-z${maxzoom}.pmtiles`;

console.log(`${state.toUpperCase()}  bbox=${bbox.join(',')}  maxzoom=${maxzoom}`);
execFileSync(process.env.PMTILES_BIN ?? 'pmtiles', [
  'extract', SOURCE, out, `--bbox=${bbox.join(',')}`, `--maxzoom=${maxzoom}`,
], { stdio: 'inherit' });
console.log(`\nwrote ${out}`);
