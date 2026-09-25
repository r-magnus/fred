/**
 * Worker for build-state-contours.mjs: traces a block of tiles.
 *
 * Receives { demPath, z, interval, index, xStart, xEnd, yStart, yEnd } and posts
 * one { z, x, y, data } message per non-empty tile (gzipped MVT, transferred),
 * then { done: true }. Each worker opens the elevation archive itself and keeps
 * its own decoded-tile cache for the block; the ring of tiles around a block is
 * decoded twice, which is the whole cost of splitting.
 *
 * Blocks are bounded in both directions because a decoded tile is 1 MB
 * (512 x 512 Float32) and the cache holds three rows of the block: full-width
 * rows of Alaska at z12 (571 tiles) came to ~1.7 GB per worker and froze a
 * 15 GB machine.
 */
import { parentPort } from 'node:worker_threads';
import { openSync, readSync, fstatSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import sharp from 'sharp';
import { PMTiles } from 'pmtiles';
import { encodeContourTile, terrariumToMetres, tileContours } from '../tools/ingest/src/contours.ts';

// Each worker already runs in parallel; libvips threads on top of that only
// contend for the same cores.
sharp.concurrency(1);

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

// Pixels borrowed from each neighbour. Contours within this strip are traced
// from the same pixels by both tiles, so lines meet exactly at the edge.
const BORDER = 4;

let dem = null, demPath = null;
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

parentPort.on('message', async (job) => {
  if (job.demPath !== demPath) { dem = new PMTiles(new NodeFileSource(job.demPath)); demPath = job.demPath; }
  cache.clear();
  const { z, interval, index, xStart, xEnd, yStart, yEnd } = job;
  for (let y = yStart; y <= yEnd; y++) {
    for (const k of cache.keys()) { if (Number(k.split('/')[2]) < y - 1) cache.delete(k); }
    for (let x = xStart; x <= xEnd; x++) {
      const grid = await gridWithBorder(z, x, y);
      if (grid === null) continue;
      const features = tileContours(grid, size, BORDER, interval, index);
      if (features.length === 0) continue;
      const data = gzipSync(encodeContourTile('contours', features));
      const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      parentPort.postMessage({ z, x, y, data: ab }, [ab]);
    }
  }
  cache.clear();
  parentPort.postMessage({ done: true });
});
