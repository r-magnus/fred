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
 * 2. Trace contours per tile (tools/ingest/src/contours.ts): 200 m lines at
 *    z10, 100 m at z11, 40 m at z12, with 1000/500/200 m index lines flagged
 *    idx=1. Above z12 MapLibre overzooms the z12 tiles.
 * 3. Write gzipped MVT tiles to an MBTiles file and convert it with
 *    `pmtiles convert`.
 *
 * The bbox is build-state-map.mjs's (Census boundaries plus 0.15 degrees), so
 * contours cover exactly the area the basemap does.
 *
 * Needs the `pmtiles` CLI (github.com/protomaps/go-pmtiles) on PATH, or set
 * PMTILES_BIN. Elevation: Mapterhorn, attribution required on screen.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readSync, fstatSync, renameSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import { PMTiles } from 'pmtiles';
import { STATE_BOUNDARIES } from '../packages/geo/src/us-states.ts';
import { CONTOUR_LEVELS, encodeContourTile, terrariumToMetres, tileContours } from '../tools/ingest/src/contours.ts';

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const positional = args.filter((a) => !a.startsWith('--'));
const PAD = 0.15; // must match build-state-map.mjs

let name, bbox;
if (flag('bbox') !== undefined) {
  name = (flag('name') ?? 'test').toUpperCase();
  bbox = flag('bbox').split(',').map(Number);
  positional.unshift(undefined);
} else {
  const state = positional[0]?.toUpperCase();
  const b = state === undefined ? undefined : STATE_BOUNDARIES[state];
  if (b === undefined) {
    console.error('usage: build-state-contours.mjs <USPS> [out-dir]  |  --bbox=W,S,E,N --name=XX [out-dir]');
    process.exit(1);
  }
  name = state;
  const [w, s, e, n] = b.bbox;
  bbox = [w - PAD, s - PAD, e + PAD, n + PAD];
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

/** pmtiles' Source over a local file. */
class NodeFileSource {
  constructor(path) { this.path = path; this.fd = openSync(path, 'r'); this.size = fstatSync(this.fd).size; }
  getKey() { return this.path; }
  async getBytes(offset, length) {
    const n = Math.min(length, this.size - offset);
    const buf = Buffer.alloc(n);
    readSync(this.fd, buf, 0, n, offset);
    return { data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + n) };
  }
}
const dem = new PMTiles(new NodeFileSource(demPath));

const lonToX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const latToY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

// Decoded elevation tiles, keyed z/x/y. Rows are processed top to bottom, so
// only three rows need to stay decoded at a time.
const cache = new Map();
let size = 0;
async function elevation(z, x, y) {
  const key = `${z}/${x}/${y}`;
  if (cache.has(key)) return cache.get(key);
  const t = await dem.getZxy(z, x, y);
  let grid = null;
  if (t !== undefined) {
    const { data, info } = await sharp(Buffer.from(t.data)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    size = info.width;
    grid = terrariumToMetres(data, info.channels);
  }
  cache.set(key, grid);
  return grid;
}

// Pixels borrowed from each neighbour. Contours within this strip are traced
// from the same pixels by both tiles, so lines meet exactly at the edge.
const BORDER = 4;

async function gridWithBorder(z, x, y) {
  const centre = await elevation(z, x, y);
  if (centre === null) return null;
  const w = size + 2 * BORDER;
  const out = new Float32Array(w * w);
  const tiles = new Map();
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    tiles.set(`${dx},${dy}`, await elevation(z, x + dx, y + dy));
  }
  for (let j = 0; j < w; j++) {
    for (let i = 0; i < w; i++) {
      let px = i - BORDER, py = j - BORDER, dx = 0, dy = 0;
      if (px < 0) { dx = -1; px += size; } else if (px >= size) { dx = 1; px -= size; }
      if (py < 0) { dy = -1; py += size; } else if (py >= size) { dy = 1; py -= size; }
      let t = tiles.get(`${dx},${dy}`);
      if (t === null) {
        // No neighbour (edge of the extract): repeat the centre tile's edge.
        t = centre;
        px = Math.min(Math.max(i - BORDER, 0), size - 1);
        py = Math.min(Math.max(j - BORDER, 0), size - 1);
      }
      out[j * w + i] = t[py * size + px];
    }
  }
  return out;
}

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
  cache.clear();
  db.exec('BEGIN');
  for (let y = y0; y <= y1; y++) {
    for (const k of cache.keys()) { const ky = Number(k.split('/')[2]); if (ky < y - 1) cache.delete(k); }
    for (let x = x0; x <= x1; x++) {
      const grid = await gridWithBorder(z, x, y);
      if (grid === null) continue;
      const features = tileContours(grid, size, BORDER, interval, index);
      if (features.length === 0) continue;
      const data = gzipSync(encodeContourTile('contours', features));
      insert.run(z, x, 2 ** z - 1 - y, data);
      tilesWritten++; bytes += data.length;
    }
    if ((y - y0) % 10 === 0 || y === y1) {
      const s = (Date.now() - started) / 1000;
      process.stdout.write(`\r  z${z} row ${y - y0 + 1}/${rows}  ${tilesWritten} tiles  ${(bytes / 1e6).toFixed(1)} MB  ${s.toFixed(0)} s   `);
    }
  }
  db.exec('COMMIT');
  process.stdout.write('\n');
}

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
