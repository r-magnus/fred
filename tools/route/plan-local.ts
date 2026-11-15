/**
 * Plans a walking route on the local state archives, for checking the engine
 * by hand (#223). Prints a summary and writes GeoJSON next to it.
 *
 *   node tools/route/plan-local.ts CA 37.7317,-119.5582 37.7459,-119.5332 [out.geojson]
 *
 * MAPS_DIR (default ~/fred-maps) holds map-<ST>-z14.pmtiles and contours-<ST>.pmtiles.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PMTiles } from 'pmtiles';
import { planRoute, type TileReader } from '../../packages/geo/src/route/index.ts';

function reader(file: string): TileReader | undefined {
  if (!fs.existsSync(file)) return undefined;
  const fd = fs.openSync(file, 'r');
  const p = new PMTiles({
    getKey: () => file,
    getBytes: async (offset: number, length: number) => {
      const b = Buffer.alloc(length);
      fs.readSync(fd, b, 0, length, offset);
      return { data: b.buffer.slice(b.byteOffset, b.byteOffset + length) as ArrayBuffer };
    },
  });
  return async (z, x, y) => {
    const t = await p.getZxy(z, x, y);
    return t === undefined ? null : new Uint8Array(t.data);
  };
}

const [st, a, b, out] = process.argv.slice(2);
if (st === undefined || a === undefined || b === undefined) {
  console.error('usage: plan-local.ts <ST> <lat,lon> <lat,lon> [out.geojson]');
  process.exit(2);
}
const dir = process.env.MAPS_DIR ?? path.join(os.homedir(), 'fred-maps');
const basemap = reader(path.join(dir, `map-${st}-z14.pmtiles`));
if (basemap === undefined) throw new Error(`no basemap for ${st} in ${dir}`);
const contours = reader(path.join(dir, `contours-${st}.pmtiles`));
const [alat, alon] = a.split(',').map(Number) as [number, number];
const [blat, blon] = b.split(',').map(Number) as [number, number];

const res = await planRoute(contours === undefined ? { basemap } : { basemap, contours }, { lat: alat, lon: alon }, { lat: blat, lon: blon });
console.log('stats', res.stats);
if (!res.ok) { console.log('FAILED', res.reason); process.exit(1); }
const r = res.route;
const km = (m: number) => (m / 1000).toFixed(2) + ' km';
const hm = (s: number) => `${Math.floor(s / 3600)}h${String(Math.round((s % 3600) / 60)).padStart(2, '0')}`;
console.log(`route ${km(r.meters)} (straight ${km(r.straightMeters)}), ${hm(r.seconds)}, +${Math.round(r.ascent)} m / -${Math.round(r.descent)} m, off-trail ${km(r.offTrailMeters)}, unsure ${km(r.unsureMeters)}, notes ${r.notes.join(',') || '-'}`);
for (const s of r.stretches) {
  console.log(`  ${s.sure ? '  ' : '!!'} ${s.kind.padEnd(12)} ${km(s.meters).padStart(9)} ${hm(s.seconds)}  ${s.cls ?? ''} ${s.detail ?? ''} ${s.name ?? ''} ${s.notes.join(',')}`);
}
if (out !== undefined) {
  fs.writeFileSync(out, JSON.stringify({
    type: 'FeatureCollection',
    features: r.stretches.map((s) => ({ type: 'Feature', properties: { kind: s.kind, sure: s.sure, name: s.name, meters: Math.round(s.meters), stroke: s.sure ? '#2b6cb0' : '#e07b00' }, geometry: { type: 'LineString', coordinates: s.coords } })),
  }));
  console.log('wrote', out);
}
