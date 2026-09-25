/**
 * Assemble one state's download: map, contours, coverage and the plants and
 * wildlife pack, with a manifest that lists every file by size and SHA-256.
 *
 * Usage: node scripts/build-state-bundle.mjs <USPS> [out-root]
 *
 * The bundle mirrors the app's Documents directory, so installing it is a copy:
 *
 *   <out-root>/<USPS>/
 *     bundle.json
 *     map-<USPS>-z14.pmtiles         basemap (build-state-map.mjs)
 *     contours-<USPS>.pmtiles        topo contours (build-state-contours.mjs)
 *     coverage-<USPS>-lte.bin        signal coverage (tools/ingest/src/coverage-pack.ts)
 *     packs/state-<USPS>-flora-fauna/  plants and wildlife (tools/ingest/src/feis-pack.ts)
 *
 * Map and contours are built on demand when missing from MAPS_DIR. Coverage
 * needs the FCC's shapefiles, which are downloaded by hand with an account, so
 * it is taken from MAPS_DIR if present and otherwise recorded as missing
 * rather than silently dropped. The flora pack comes from PACKS_DIR (packs/).
 *
 * bundle.json is what a download catalog points at; the app will verify each
 * file against it before swapping the bundle in (docs, HANDOFF item 2).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, linkSync } from 'node:fs';
import { join, relative } from 'node:path';

const [stateArg, outRoot = 'dist/states'] = process.argv.slice(2);
const state = stateArg?.toUpperCase();
if (state === undefined || !/^[A-Z]{2}$/.test(state)) {
  console.error('usage: build-state-bundle.mjs <USPS> [out-root]');
  process.exit(1);
}
const ROOT = new URL('..', import.meta.url).pathname;
const MAPS_DIR = process.env.MAPS_DIR ?? join(process.env.HOME, 'fred-maps');
const PACKS_DIR = process.env.PACKS_DIR ?? join(ROOT, 'packs');
mkdirSync(MAPS_DIR, { recursive: true });

const run = (script, args) => execFileSync(process.execPath, [join(ROOT, 'scripts', script), ...args], { stdio: 'inherit' });

// Components, built when missing.
const mapName = `map-${state}-z14.pmtiles`;
if (!existsSync(join(MAPS_DIR, mapName))) run('build-state-map.mjs', [state, '14', MAPS_DIR]);
const contoursName = `contours-${state}.pmtiles`;
if (!existsSync(join(MAPS_DIR, contoursName))) run('build-state-contours.mjs', [state, MAPS_DIR]);
const coverageName = `coverage-${state}-lte.bin`;
const haveCoverage = existsSync(join(MAPS_DIR, coverageName));

const floraDirs = readdirSync(PACKS_DIR).filter((d) => d.startsWith(`state-${state}-flora-fauna-v`)).sort();
const floraDir = floraDirs.at(-1);
if (floraDir === undefined) throw new Error(`no state-${state}-flora-fauna pack in ${PACKS_DIR}`);
const floraManifest = JSON.parse(readFileSync(join(PACKS_DIR, floraDir, 'manifest.json'), 'utf8'));

// Assemble. Hard links where the filesystem allows, so a bundle of 700 MB of
// maps does not cost another 700 MB of disk.
const dir = join(outRoot, state);
rmSync(dir, { recursive: true, force: true });
mkdirSync(join(dir, 'packs'), { recursive: true });
const place = (src, dest) => { try { linkSync(src, dest); } catch { cpSync(src, dest); } };
place(join(MAPS_DIR, mapName), join(dir, mapName));
place(join(MAPS_DIR, contoursName), join(dir, contoursName));
if (haveCoverage) place(join(MAPS_DIR, coverageName), join(dir, coverageName));
// Installed under its id without the version, as the app and stage-phone.sh expect.
cpSync(join(PACKS_DIR, floraDir), join(dir, 'packs', floraManifest.id), { recursive: true });

const sha256 = (path) => new Promise((resolve, reject) => {
  const h = createHash('sha256');
  createReadStream(path).on('data', (b) => h.update(b)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
const files = [];
for (const f of walk(dir).sort()) {
  const path = relative(dir, f);
  files.push({ path, bytes: statSync(f).size, sha256: await sha256(f) });
}

const pmtilesVersion = (() => {
  try { return execFileSync(process.env.PMTILES_BIN ?? 'pmtiles', ['version'], { encoding: 'utf8' }).trim(); } catch { return 'unknown'; }
})();
const bundle = {
  schemaVersion: 1,
  state,
  builtAt: new Date().toISOString(),
  components: {
    basemap: { path: mapName, source: process.env.PMTILES_SOURCE ?? 'https://build.protomaps.com/20260920.pmtiles', maxzoom: 14 },
    contours: { path: contoursName, source: 'https://download.mapterhorn.com/planet.pmtiles', intervals: '200 m z10, 100 m z11, 40 m z12' },
    coverage: haveCoverage ? { path: coverageName, source: 'FCC Broadband Data Collection' } : null,
    flora: { path: `packs/${floraManifest.id}`, id: floraManifest.id, version: floraManifest.version, encoder: floraManifest.embedding.modelId },
  },
  missing: haveCoverage ? [] : ['coverage'],
  files,
  bytes: files.reduce((s, f) => s + f.bytes, 0),
  attribution: [
    '© OpenStreetMap contributors (basemap, via Protomaps)',
    '© Mapterhorn (terrain for contours; US data USGS 3DEP)',
    'USFS Fire Effects Information System (plants and wildlife)',
    ...(haveCoverage ? ['FCC Broadband Data Collection (coverage)'] : []),
  ],
  tool: { pmtiles: pmtilesVersion },
};
writeFileSync(join(dir, 'bundle.json'), JSON.stringify(bundle, null, 2) + '\n');
const mb = (n) => (n / 1e6).toFixed(1);
console.log(`${state}: ${files.length} files, ${mb(bundle.bytes)} MB` +
  ` (map ${mb(files.find((f) => f.path === mapName).bytes)}, contours ${mb(files.find((f) => f.path === contoursName).bytes)})` +
  (haveCoverage ? '' : '  [coverage missing]'));
