import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeContourTile, simplify, terrariumToMetres, tileContours, traceLevel } from '../src/contours.ts';

function cone(w: number, peak: number): Float32Array {
  const g = new Float32Array(w * w);
  const c = w / 2;
  for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) {
    g[j * w + i] = peak - Math.hypot(i + 0.5 - c, j + 0.5 - c) * 10;
  }
  return g;
}

test('terrarium decoding', () => {
  // 32768 + 1500.5 m -> R=133 (34048), G=... : build it from the formula.
  const m = 1500.5 + 32768;
  const r = Math.floor(m / 256), g = Math.floor(m - r * 256), b = Math.round((m - r * 256 - g) * 256);
  assert.equal(terrariumToMetres(Uint8Array.from([r, g, b]), 3)[0], 1500.5);
});

test('a cone traces one closed loop at the right radius', () => {
  const w = 40, peak = 1000;
  const lines = traceLevel(cone(w, peak), w, w, 900); // radius 10 px
  assert.equal(lines.length, 1);
  const line = lines[0]!;
  assert.deepEqual(line[0], line[line.length - 1], 'closed');
  for (const [x, y] of line) {
    const r = Math.hypot(x - w / 2, y - w / 2);
    assert.ok(Math.abs(r - 10) < 0.2, `radius ${r}`);
  }
});

test('a ramp traces one straight open line across the grid', () => {
  const w = 20; const g = new Float32Array(w * w);
  for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) g[j * w + i] = i * 10;
  const lines = traceLevel(g, w, w, 55);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.length, w);
  for (const [x] of lines[0]!) assert.ok(Math.abs(x - 6) < 1e-9); // 55 lies between columns 5 and 6: x = 5.5 + 0.5
  assert.equal(simplify(lines[0]!, 0.5).length, 2);
});

test('neighbouring tiles meet exactly at their shared edge', () => {
  // One elevation surface, cut into two tiles with a border borrowed from each other.
  const size = 16, border = 2, W = size * 2;
  const full = (x: number, y: number): number => 300 + 40 * Math.sin(x / 5) + 30 * Math.cos(y / 4) + x * 3;
  const tile = (ox: number): Float32Array => {
    const w = size + 2 * border; const g = new Float32Array(w * w);
    for (let j = 0; j < w; j++) for (let i = 0; i < w; i++) g[j * w + i] = full(ox + i - border, j - border);
    return g;
  };
  void W;
  const left = tileContours(tile(0), size, border, 20, 100, 4096, 0);
  const right = tileContours(tile(size), size, border, 20, 100, 4096, 0);
  // Lines reach into the border, so both tiles trace the strip around their
  // shared edge from the same pixels. Every vertex the left tile has there must
  // also be a vertex of the right tile, shifted by one tile width.
  const ext = 4096, strip = (border - 1) * (ext / size);
  const verts = (fs: typeof left, lo: number, hi: number, shift: number): Set<string> => new Set(
    fs.flatMap((f) => f.line.filter(([x]) => x > lo && x < hi).map(([x, y]) => `${f.ele}:${x + shift},${y}`)));
  const fromLeft = verts(left, ext - strip, ext + strip, -ext);
  const fromRight = verts(right, -strip, strip, 0);
  assert.ok(fromLeft.size > 0);
  for (const v of fromLeft) assert.ok(fromRight.has(v), `missing ${v}`);
});

// Minimal MVT reader: enough to check the encoder's output.
function readVarint(b: Uint8Array, o: { i: number }): number {
  let v = 0, s = 1;
  for (;;) { const x = b[o.i++]!; v += (x & 0x7f) * s; if (x < 0x80) return v; s *= 128; }
}
function fields(b: Uint8Array): { f: number; v: number | Uint8Array }[] {
  const out: { f: number; v: number | Uint8Array }[] = []; const o = { i: 0 };
  while (o.i < b.length) {
    const t = readVarint(b, o); const f = t >> 3, wt = t & 7;
    if (wt === 0) out.push({ f, v: readVarint(b, o) });
    else { const n = readVarint(b, o); out.push({ f, v: b.subarray(o.i, o.i + n) }); o.i += n; }
  }
  return out;
}
const packed = (b: Uint8Array): number[] => { const o = { i: 0 }, r: number[] = []; while (o.i < b.length) r.push(readVarint(b, o)); return r; };
const unzig = (n: number): number => (n >>> 1) ^ -(n & 1);

test('encoded tile decodes back to the same lines and attributes', () => {
  const tileBytes = encodeContourTile('contours', [
    { line: [[0, 0], [100, 50], [90, 200]], ele: 1200, idx: 0 },
    { line: [[10, 10], [20, -5]], ele: 1000, idx: 1 },
  ]);
  const [layerF] = fields(tileBytes);
  assert.equal(layerF!.f, 3);
  const layer = fields(layerF!.v as Uint8Array);
  assert.equal(new TextDecoder().decode(layer.find((x) => x.f === 1)!.v as Uint8Array), 'contours');
  assert.equal(layer.find((x) => x.f === 5)!.v, 4096);
  const keys = layer.filter((x) => x.f === 3).map((x) => new TextDecoder().decode(x.v as Uint8Array));
  const values = layer.filter((x) => x.f === 4).map((x) => fields(x.v as Uint8Array)[0]!.v as number);
  const feats = layer.filter((x) => x.f === 2).map((x) => fields(x.v as Uint8Array));
  const decoded = feats.map((ff) => {
    const tags = packed(ff.find((x) => x.f === 2)!.v as Uint8Array);
    const attrs: Record<string, number> = {};
    for (let k = 0; k < tags.length; k += 2) attrs[keys[tags[k]!]!] = values[tags[k + 1]!]!;
    const g = packed(ff.find((x) => x.f === 4)!.v as Uint8Array);
    const pts: [number, number][] = []; let x = 0, y = 0, k = 0;
    while (k < g.length) {
      const cmd = g[k]! & 7, n = g[k]! >> 3; k++;
      for (let c = 0; c < n; c++) { x += unzig(g[k++]!); y += unzig(g[k++]!); pts.push([x, y]); }
      void cmd;
    }
    return { attrs, pts, type: ff.find((x) => x.f === 3)!.v };
  });
  assert.deepEqual(decoded, [
    { attrs: { ele: 1200, idx: 0 }, pts: [[0, 0], [100, 50], [90, 200]], type: 2 },
    { attrs: { ele: 1000, idx: 1 }, pts: [[10, 10], [20, -5]], type: 2 },
  ]);
});
