/**
 * Assemble a state's regional downloads (#224): one state-wide part, and one
 * download per region (scripts/regions/<USPS>.json).
 *
 * Usage: node scripts/build-region-bundles.mjs <USPS> [out-root]
 *
 * Needs build-state-regions.mjs run first (its cut/ shapes and outline file in
 * <out-root>/<USPS>/), the state's whole map and contours in MAPS_DIR (the
 * same files build-state-bundle.mjs uses), and the `pmtiles` CLI.
 *
 *   <out-root>/<USPS>/base/      what every region of the state needs, once:
 *     map-<USPS>-overview.pmtiles  the whole state to zoom 10: roads and towns
 *                                  where no region is downloaded
 *     coverage-<USPS>-voice.bin    carrier coverage (state-wide; ~1 MB)
 *     regions-<USPS>.json          the region outlines
 *     packs/state-<USPS>-flora-fauna/  the plant and animal guide
 *   <out-root>/<USPS>/<id>/      one region:
 *     map-<USPS>-<id>.pmtiles      zoom 11-14, cut to the region's counties
 *     contours-<USPS>-<id>.pmtiles every contour zoom, cut the same way
 *
 * The detail starts at zoom 11 because the overview already carries 0-10.
 * pmtiles keeps every tile that touches the region, so neighbours overlap by
 * the width of a tile (up to ~2.4 km at zoom 14) and meet without a gap.
 *
 * Each part gets a bundle.json in the format index.json uses, and every file
 * is also linked into <out-root>/assets/ under its release name, flat, the way
 * a GitHub release holds them. build-test-index.mjs serves that folder.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, createReadStream, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const [stateArg, outRoot = 'dist/regions'] = process.argv.slice(2);
const state = stateArg?.toUpperCase();
if (state === undefined || !/^[A-Z]{2}$/.test(state)) {
  console.error('usage: build-region-bundles.mjs <USPS> [out-root]');
  process.exit(1);
}
const ROOT = new URL('..', import.meta.url).pathname;
const MAPS_DIR = process.env.MAPS_DIR ?? join(process.env.HOME, 'fred-maps');
const PACKS_DIR = process.env.PACKS_DIR ?? join(ROOT, 'packs');
const PMTILES = process.env.PMTILES_BIN ?? 'pmtiles';
const spec = JSON.parse(readFileSync(join(ROOT, 'scripts', 'regions', `${state}.json`), 'utf8'));
const stateDir = join(outRoot, state);
const outline = join(stateDir, `regions-${state}.json`);
if (!existsSync(outline)) {
  console.error(`${outline} is missing: run build-state-regions.mjs ${state} first.`);
  process.exit(1);
}
const wholeMap = join(MAPS_DIR, `map-${state}-z14.pmtiles`);
const wholeContours = join(MAPS_DIR, `contours-${state}.pmtiles`);
for (const f of [wholeMap, wholeContours]) {
  if (!existsSync(f)) { console.error(`${f} is missing: build the state map first.`); process.exit(1); }
}

const extract = (src, dest, ...args) =>
  execFileSync(PMTILES, ['extract', src, dest, ...args], { stdio: ['ignore', 'ignore', 'inherit'] });
const place = (src, dest) => { try { linkSync(src, dest); } catch { cpSync(src, dest); } };
const hash = (path, algo) => new Promise((resolve, reject) => {
  const h = createHash(algo);
  createReadStream(path).on('data', (b) => h.update(b)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);

const assets = join(outRoot, 'assets');
mkdirSync(assets, { recursive: true });

/** List a part's files with sizes and hashes, link them into assets/, write its bundle.json. */
async function finish(name, dir, extra, missing = []) {
  const files = [];
  for (const f of walk(dir).filter((p) => !p.endsWith('bundle.json')).sort()) {
    const path = relative(dir, f);
    const asset = `${name}--${path.replaceAll('/', '--')}`;
    rmSync(join(assets, asset), { force: true });
    place(f, join(assets, asset));
    files.push({ path, asset, bytes: statSync(f).size, sha256: await hash(f, 'sha256'), md5: await hash(f, 'md5') });
  }
  const bundle = { ...extra, builtAt: new Date().toISOString(), missing, files, bytes: files.reduce((a, f) => a + f.bytes, 0) };
  writeFileSync(join(dir, 'bundle.json'), JSON.stringify(bundle, null, 2) + '\n');
  return bundle;
}

// The state-wide part.
const baseDir = join(stateDir, 'base');
rmSync(baseDir, { recursive: true, force: true });
mkdirSync(join(baseDir, 'packs'), { recursive: true });
extract(wholeMap, join(baseDir, `map-${state}-overview.pmtiles`), '--maxzoom=10');
const coverage = join(MAPS_DIR, `coverage-${state}-voice.bin`);
if (existsSync(coverage)) place(coverage, join(baseDir, `coverage-${state}-voice.bin`));
place(outline, join(baseDir, `regions-${state}.json`));
const floraDir = readdirSync(PACKS_DIR).filter((d) => d.startsWith(`state-${state}-flora-fauna-v`)).sort().at(-1);
if (floraDir !== undefined) {
  const id = JSON.parse(readFileSync(join(PACKS_DIR, floraDir, 'manifest.json'), 'utf8')).id;
  cpSync(join(PACKS_DIR, floraDir), join(baseDir, 'packs', id), { recursive: true });
}
const base = await finish(`${state}-base`, baseDir, { state, part: 'base' }, [
  ...(existsSync(coverage) ? [] : ['coverage']), ...(floraDir === undefined ? ['flora'] : []),
]);

// One download per region.
const regions = {};
for (const r of spec.regions) {
  const dir = join(stateDir, r.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const cut = `--region=${join(stateDir, 'cut', `${r.id}.geojson`)}`;
  extract(wholeMap, join(dir, `map-${state}-${r.id}.pmtiles`), cut, '--minzoom=11', '--maxzoom=14');
  extract(wholeContours, join(dir, `contours-${state}-${r.id}.pmtiles`), cut);
  regions[r.id] = await finish(`${state}-${r.id}`, dir, { state, part: r.id, name: r.name });
}

const fragment = {
  state,
  base,
  regions,
  outline: JSON.parse(readFileSync(outline, 'utf8')),
};
writeFileSync(join(outRoot, `index-${state}.json`), JSON.stringify(fragment) + '\n');

const mb = (n) => `${(n / 1e6).toFixed(0)} MB`;
console.log(`${state} state-wide part: ${mb(base.bytes)}${base.missing.length === 0 ? '' : `  [${base.missing.join(', ')} missing]`}`);
for (const [id, b] of Object.entries(regions)) console.log(`  ${id.padEnd(8)} ${b.name}: ${mb(b.bytes)}  (with the state-wide part ${mb(b.bytes + base.bytes)})`);
