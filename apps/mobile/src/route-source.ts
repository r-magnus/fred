/**
 * The map archives on the phone as `RouteSources` for the route engine (#223).
 *
 * MapLibre reads the same .pmtiles files for drawing, natively. The route
 * engine needs the tile bytes in JS, so this opens the files itself and reads
 * byte ranges with expo-file-system's FileHandle (seek by `offset`, then
 * `readBytes`). The pmtiles library does the archive lookup; with no
 * DecompressionStream in Hermes it inflates tiles with fflate, which the app
 * already carries for coverage packs.
 *
 * Which files: every detailed map on the phone, whatever it covers. Today
 * that is one `map-<ST>-z14.pmtiles` per state; with regional downloads
 * (#224) it is `map-<ST>-<region>.pmtiles`, and a route near a region edge
 * needs tiles from two of them. So each tile is read from the first archive
 * whose bounds and zooms reach it; neighbouring regions overlap by a few km
 * and hold the same tiles there, so which one answers doesn't matter.
 * Overview maps (zoom 7–10) have no routing zoom and are skipped by their
 * header, not by their name.
 *
 * Handles are opened per route and closed after: a route reads tens of tiles,
 * once, and an open handle on a 600 MB file is not worth keeping around.
 */

import { File, Paths } from 'expo-file-system';
import { PMTiles } from 'pmtiles';
import type { RouteSources, TileReader } from '@fred/geo/route';

const BASEMAP = /^map-.+\.pmtiles$/;
const CONTOURS = /^contours-.+\.pmtiles$/;

interface Archive {
  readonly tiles: PMTiles;
  readonly minZoom: number;
  readonly maxZoom: number;
  /** Bounds, degrees. */
  readonly west: number; readonly south: number; readonly east: number; readonly north: number;
}

interface Opened { readonly archives: Archive[]; readonly handles: Array<{ close(): void }> }

/** A tile's bounds, degrees: [west, south, east, north]. */
function tileBounds(z: number, x: number, y: number): [number, number, number, number] {
  const n = 2 ** z;
  const lat = (row: number): number => (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / n)));
  return [(x / n) * 360 - 180, lat(y + 1), ((x + 1) / n) * 360 - 180, lat(y)];
}

async function openAll(pattern: RegExp, needZoom: number): Promise<Opened> {
  let names: string[] = [];
  try { names = Paths.document.list().map((f) => f.name).filter((n) => pattern.test(n)); } catch { names = []; }
  const archives: Archive[] = [];
  const handles: Array<{ close(): void }> = [];
  for (const name of names.sort()) {
    const file = new File(Paths.document, name);
    if (!file.exists) continue;
    const handle = file.open();
    const tiles = new PMTiles({
      getKey: () => file.uri,
      getBytes: async (offset: number, length: number) => {
        handle.offset = offset;
        const bytes = handle.readBytes(length);
        return { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
      },
    });
    try {
      const h = await tiles.getHeader();
      if (h.maxZoom < needZoom) { handle.close(); continue; }
      archives.push({ tiles, minZoom: h.minZoom, maxZoom: h.maxZoom, west: h.minLon, south: h.minLat, east: h.maxLon, north: h.maxLat });
      handles.push(handle);
    } catch {
      // A half-written or foreign file: not ours to route on.
      handle.close();
    }
  }
  return { archives, handles };
}

function readerOver(archives: readonly Archive[]): TileReader {
  return async (z, x, y) => {
    const [w, s, e, n] = tileBounds(z, x, y);
    for (const a of archives) {
      if (z < a.minZoom || z > a.maxZoom) continue;
      if (e < a.west || w > a.east || n < a.south || s > a.north) continue;
      const tile = await a.tiles.getZxy(z, x, y);
      if (tile !== undefined) return new Uint8Array(tile.data);
    }
    return null;
  };
}

/**
 * Every detailed map and contour archive on the phone, as route sources, or
 * null when there is no detailed map at all. Without contours, routes are
 * planned on flat ground and say so (`hasElevation: false`).
 */
export async function openRouteSources(
  basemapZoom = 14, contourZoom = 12,
): Promise<{ sources: RouteSources; close(): void } | null> {
  const base = await openAll(BASEMAP, basemapZoom);
  if (base.archives.length === 0) return null;
  const cont = await openAll(CONTOURS, contourZoom);
  const close = (): void => { for (const h of [...base.handles, ...cont.handles]) h.close(); };
  const sources: RouteSources = cont.archives.length === 0
    ? { basemap: readerOver(base.archives) }
    : { basemap: readerOver(base.archives), contours: readerOver(cont.archives) };
  return { sources, close };
}
