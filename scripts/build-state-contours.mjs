/**
 * Build one state's contour lines as a PMTiles archive, to sit beside its
 * basemap (docs/results-topo-research.md, option B).
 *
 * Usage: node scripts/build-state-contours.mjs <USPS> [out-dir]
 *        node scripts/build-state-contours.mjs --bbox=W,S,E,N --name=XX [out-dir]
 *
 * 1. Extract the state's elevation tiles (zooms 10-12) from Mapterhorn's planet
 *    archive with `pmtiles extract`, the same range-request workflow
 *    build-state-map.mjs uses. Cached in the work directory, so a re-run does
 *    not download again.
 * 2. Trace contours per tile (tools/ingest/src/contours.ts), across worker
 *    threads (contour-worker.mjs): 200 m lines at
 *    z10, 100 m at z11, 40 m at z12, with 1000/500/200 m index lines flagged
 *    idx=1. Above z12 MapLibre overzooms the z12 tiles.
 * 3. Write gzipped MVT tiles to an MBTiles file and convert it with
 *    `pmtiles convert`.
 *
 * The bbox comes from state-bbox.mjs, shared with build-state-map.mjs, so
 * contours cover exactly the area the basemap does.
 *
 * Needs the `pmtiles` CLI (github.com/protomaps/go-pmtiles) on PATH, or set
 * PMTILES_BIN. Elevation: Mapterhorn, attribution required on screen.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { stateBbox } from './state-bbox.mjs';
import { CONTOUR_LEVELS } from '../tools/ingest/src/contours.ts';

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const positional = args.filter((a) => !a.startsWith('--'));

let name, bbox;
if (flag('bbox') !== undefined) {
  name = (flag('name') ?? 'test').toUpperCase();
  bbox = flag('bbox').split(',').map(Number);
  positional.unshift(undefined);
} else {
  const state = positional[0]?.toUpperCase();
  const box = state === undefined ? undefined : stateBbox(state);
  if (box === undefined) {
    console.error('usage: build-state-contours.mjs <USPS> [out-dir]  |  --bbox=W,S,E,N --name=XX [out-dir]');
    process.exit(1);
  }
  name = state;
  bbox = box; // shared with build-state-map.mjs (state-bbox.mjs)
}
const outDir = positional[1] ?? '.';
const workDir = process.env.CONTOUR_WORK ?? `${outDir}/.contours-work`;
mkdirSync(workDir, { recursive: true });
const PMTILES = process.env.PMTILES_BIN ?? 'pmtiles';
const DEM_SOURCE = process.env.DEM_SOURCE ?? 'https://download.mapterhorn.com/planet.pmtiles';
const bboxArg = bbox.map((v) => v.toFixed(4)).join(',');

// 1. Elevation tiles.
// Written under a temporary name and renamed only when `pmtiles extract`
// succeeds: a download that dies near the end leaves a file of nearly the
// right size, and "the file exists" must not mean "the download finished".
const demPath = `${workDir}/dem-${name}-z10-12.pmtiles`;
if (!existsSync(demPath)) {
  const partial = `${demPath}.partial`;
  for (let attempt = 1; ; attempt++) {
    console.log(`${name}  extracting elevation z10-12  bbox=${bboxArg}  (attempt ${attempt})`);
    rmSync(partial, { force: true });
    try {
      execFileSync(PMTILES, ['extract', DEM_SOURCE, partial, `--bbox=${bboxArg}`, '--minzoom=10', '--maxzoom=12'], { stdio: 'inherit' });
      renameSync(partial, demPath);
      break;
    } catch (e) {
      if (attempt >= 4) throw e;
      console.log(`  extract failed; retrying in ${attempt * 30} s`);
      execFileSync('sleep', [String(attempt * 30)]);
    }
  }
}

const lonToX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const latToY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

// 2. Trace, in parallel: contour-worker.mjs does the decoding and tracing for
// blocks of rows; this process only writes. CONTOUR_THREADS overrides.
const THREADS = Number(process.env.CONTOUR_THREADS ?? Math.max(1, availableParallelism() - 1));
const workers = Array.from({ length: THREADS }, () => new Worker(new URL('./contour-worker.mjs', import.meta.url)));
const ROWS_PER_BLOCK = 4;

// 3. Output.
const mbtilesPath = `${workDir}/contours-${name}.mbtiles`;
rmSync(mbtilesPath, { force: true });
const db = new DatabaseSync(mbtilesPath);
db.exec(`PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;
  CREATE TABLE metadata (name TEXT, value TEXT);
  CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);
  CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);`);
const insert = db.prepare('INSERT INTO tiles VALUES (?, ?, ?, ?)');

const started = Date.now();
let tilesWritten = 0, bytes = 0;
for (const zs of Object.keys(CONTOUR_LEVELS)) {
  const z = Number(zs);
  const { interval, index } = CONTOUR_LEVELS[z];
  const [x0, x1] = [lonToX(bbox[0], z), lonToX(bbox[2], z)];
  const [y0, y1] = [latToY(bbox[3], z), latToY(bbox[1], z)];
  const rows = y1 - y0 + 1;
  const blocks = [];
  for (let y = y0; y <= y1; y += ROWS_PER_BLOCK) blocks.push([y, Math.min(y + ROWS_PER_BLOCK - 1, y1)]);
  let rowsDone = 0;
  db.exec('BEGIN');
  await Promise.all(workers.map((w) => new Promise((resolve, reject) => {
    const next = () => {
      const b = blocks.shift();
      if (b === undefined) { w.removeAllListeners('message'); w.removeAllListeners('error'); resolve(); return; }
      w.postMessage({ demPath, z, interval, index, x0, x1, yStart: b[0], yEnd: b[1] });
    };
    w.on('message', (m) => {
      if (m.done) { next(); return; }
      if (m.row) {
        rowsDone++;
        if (rowsDone % 10 === 0 || rowsDone === rows) {
          const s = (Date.now() - started) / 1000;
          process.stdout.write(`\r  z${z} row ${rowsDone}/${rows}  ${tilesWritten} tiles  ${(bytes / 1e6).toFixed(1)} MB  ${s.toFixed(0)} s   `);
        }
        return;
      }
      insert.run(m.z, m.x, 2 ** m.z - 1 - m.y, new Uint8Array(m.data));
      tilesWritten++; bytes += m.data.byteLength;
    });
    w.on('error', reject);
    next();
  })));
  db.exec('COMMIT');
  process.stdout.write('\n');
}
await Promise.all(workers.map((w) => w.terminate()));

const meta = {
  name: `contours-${name}`,
  format: 'pbf',
  minzoom: '10',
  maxzoom: '12',
  bounds: bboxArg,
  attribution: '<a href="https://mapterhorn.com/attribution">© Mapterhorn</a>',
  description: '200 m (z10), 100 m (z11), 40 m (z12) contours; idx=1 on 1000/500/200 m lines',
  json: JSON.stringify({ vector_layers: [{ id: 'contours', fields: { ele: 'Number', idx: 'Number' }, minzoom: 10, maxzoom: 12 }] }),
};
const m = db.prepare('INSERT INTO metadata VALUES (?, ?)');
for (const [k, v] of Object.entries(meta)) m.run(k, v);
db.close();

const out = `${outDir}/contours-${name}.pmtiles`;
rmSync(out, { force: true });
execFileSync(PMTILES, ['convert', mbtilesPath, out], { stdio: 'inherit' });
rmSync(mbtilesPath);
console.log(`wrote ${out}: ${tilesWritten} tiles, ${(bytes / 1e6).toFixed(1)} MB of tile data, ${((Date.now() - started) / 1000).toFixed(0)} s`);
