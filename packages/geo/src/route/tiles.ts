/**
 * Tile and projection arithmetic for the route engine (#223).
 *
 * Everything is worked in one flat frame: Web Mercator "world units", where the
 * whole world is 2^26 units across. That is a z14 tile (the basemap's deepest
 * zoom) at its 4096 extent, so basemap tile coordinates map to world units by
 * one add, and z12 contour tiles by one multiply. Near a route — tens of km at
 * most — Mercator is locally conformal, and one metres-per-unit scale taken at
 * the area's middle latitude is within half a percent everywhere in it.
 */

export const WORLD_ZOOM = 14;
export const WORLD_EXTENT = 4096;
export const WORLD_SIZE = 2 ** WORLD_ZOOM * WORLD_EXTENT;
const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

export type XY = readonly [number, number];

export function lonLatToWorld(lon: number, lat: number): [number, number] {
  const x = ((lon + 180) / 360) * WORLD_SIZE;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * WORLD_SIZE;
  return [x, y];
}

export function worldToLonLat(x: number, y: number): [number, number] {
  const lon = (x / WORLD_SIZE) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / WORLD_SIZE;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return [lon, lat];
}

/** Metres per world unit at a latitude. */
export function metersPerUnit(lat: number): number {
  return (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / WORLD_SIZE;
}

export interface TileId { readonly z: number; readonly x: number; readonly y: number }

/** World units per tile at zoom z. */
export const unitsPerTile = (z: number): number => WORLD_SIZE / 2 ** z;

/** The tiles at zoom z that cover a world-unit box. */
export function tilesCovering(z: number, minX: number, minY: number, maxX: number, maxY: number): TileId[] {
  const span = unitsPerTile(z);
  const n = 2 ** z;
  const x0 = Math.max(0, Math.floor(minX / span));
  const y0 = Math.max(0, Math.floor(minY / span));
  const x1 = Math.min(n - 1, Math.floor(maxX / span));
  const y1 = Math.min(n - 1, Math.floor(maxY / span));
  const out: TileId[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ z, x, y });
  return out;
}

/** Maps a tile-local coordinate (0..extent) to world units. */
export function tileToWorld(t: TileId, extent: number, px: number, py: number): [number, number] {
  const span = unitsPerTile(t.z);
  return [t.x * span + (px / extent) * span, t.y * span + (py / extent) * span];
}
