/**
 * Saves the tiles one route reads into a fixture folder, so a test can replay
 * that route without the 100s-of-MB state archives (#223).
 *
 *   node tools/route/make-fixture.ts CA 37.7317,-119.5582 37.7459,-119.5332 packages/geo/test/fixtures/route/half-dome
 *
 * Tiles are stored gzipped, as the archives hold them, one file per tile:
 * basemap/z-x-y.mvt.gz and contours/z-x-y.mvt.gz.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { PMTiles } from 'pmtiles';
import { planRoute, type TileReader } from '../../packages/geo/src/route/index.ts';

function open(file: string): PMTiles {
  const fd = fs.openSync(file, 'r');
  return new PMTiles({
    getKey: () => file,
    getBytes: async (offset: number, length: number) => {
      const b = Buffer.alloc(length);
      fs.readSync(fd, b, 0, length, offset);
      return { data: b.buffer.slice(b.byteOffset, b.byteOffset + length) as ArrayBuffer };
    },
  });
}

const [st, a, b, outDir] = process.argv.slice(2);
if (st === undefined || a === undefined || b === undefined || outDir === undefined) {
  console.error('usage: make-fixture.ts <ST> <lat,lon> <lat,lon> <out-dir>');
  process.exit(2);
}
const dir = process.env.MAPS_DIR ?? path.join(os.homedir(), 'fred-maps');
const recording = (p: PMTiles, sub: string): TileReader => async (z, x, y) => {
  const t = await p.getZxy(z, x, y);
  if (t === undefined) return null;
  const bytes = new Uint8Array(t.data);
  fs.mkdirSync(path.join(outDir, sub), { recursive: true });
  fs.writeFileSync(path.join(outDir, sub, `${z}-${x}-${y}.mvt.gz`), zlib.gzipSync(bytes, { level: 9 }));
  return bytes;
};
const [alat, alon] = a.split(',').map(Number) as [number, number];
const [blat, blon] = b.split(',').map(Number) as [number, number];
const res = await planRoute(
  { basemap: recording(open(path.join(dir, `map-${st}-z14.pmtiles`)), 'basemap'), contours: recording(open(path.join(dir, `contours-${st}.pmtiles`)), 'contours') },
  { lat: alat, lon: alon }, { lat: blat, lon: blon },
);
fs.writeFileSync(path.join(outDir, 'route.json'), JSON.stringify({ state: st, from: { lat: alat, lon: alon }, to: { lat: blat, lon: blon } }, null, 2) + '\n');
console.log(res.ok ? `ok ${Math.round(res.route.meters)} m` : `failed ${res.reason}`, res.stats);
