/**
 * The nationwide overview map (#224): every state to zoom 7, so the map is
 * never blank, even where nothing has been downloaded. Highways, cities, big
 * rivers and lakes; no trails. Drawn under every downloaded map.
 *
 * Usage: node scripts/build-us-overview.mjs [out-root]
 *
 * Cut from the Protomaps daily build (PMTILES_SOURCE; old builds are deleted,
 * so pass a current one) to the states' own outlines rather than one box, so
 * it leaves out most of Canada and Mexico. Writes <out-root>/US/ with a
 * bundle.json, and links the file into <out-root>/assets/ like
 * build-region-bundles.mjs.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, createReadStream, linkSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_BOUNDARIES } from '../packages/geo/src/us-states.ts';

const [outRoot = 'dist/regions'] = process.argv.slice(2);
const SOURCE = process.env.PMTILES_SOURCE;
if (SOURCE === undefined) {
  console.error('Set PMTILES_SOURCE to a current Protomaps build, e.g. https://build.protomaps.com/20261115.pmtiles');
  process.exit(1);
}
const MAXZOOM = 7;
const dir = join(outRoot, 'US');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

// Every ring of every state, longitudes kept inside -180..180 (the Aleutians
// cross the antimeridian; state-bbox.mjs makes the same cut).
const clamp = (v) => Math.min(180, Math.max(-180, v));
const polygons = Object.values(STATE_BOUNDARIES).flatMap((b) => b.rings.map((flat) => {
  const ring = [];
  for (let i = 0; i < flat.length; i += 2) ring.push([clamp(flat[i]), flat[i + 1]]);
  if (ring.length > 0 && (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1])) ring.push(ring[0]);
  return [ring];
}));
const cut = join(dir, 'us.geojson');
writeFileSync(cut, JSON.stringify({ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: polygons } }));

const name = 'map-US-overview.pmtiles';
execFileSync(process.env.PMTILES_BIN ?? 'pmtiles',
  ['extract', SOURCE, join(dir, name), `--region=${cut}`, `--maxzoom=${MAXZOOM}`], { stdio: ['ignore', 'ignore', 'inherit'] });
rmSync(cut);

const hash = (path, algo) => new Promise((resolve, reject) => {
  const h = createHash(algo);
  createReadStream(path).on('data', (b) => h.update(b)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});
const file = join(dir, name);
const asset = `US-overview--${name}`;
mkdirSync(join(outRoot, 'assets'), { recursive: true });
rmSync(join(outRoot, 'assets', asset), { force: true });
try { linkSync(file, join(outRoot, 'assets', asset)); } catch { cpSync(file, join(outRoot, 'assets', asset)); }
const files = [{ path: name, asset, bytes: statSync(file).size, sha256: await hash(file, 'sha256'), md5: await hash(file, 'md5') }];
const bundle = {
  part: 'us-overview', builtAt: new Date().toISOString(), source: SOURCE, maxzoom: MAXZOOM,
  missing: [], files, bytes: files[0].bytes,
};
writeFileSync(join(dir, 'bundle.json'), JSON.stringify(bundle, null, 2) + '\n');
console.log(`US overview to zoom ${MAXZOOM}: ${(bundle.bytes / 1e6).toFixed(1)} MB`);
