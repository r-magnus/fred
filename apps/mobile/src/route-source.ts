/**
 * The state map archives as `RouteSources` for the route engine (#223).
 *
 * MapLibre reads the same .pmtiles files for drawing, natively. The route
 * engine needs the tile bytes in JS, so this opens the file itself and reads
 * byte ranges with expo-file-system's FileHandle (seek by `offset`, then
 * `readBytes`). The pmtiles library does the archive lookup; with no
 * DecompressionStream in Hermes it inflates tiles with fflate, which the app
 * already carries for coverage packs.
 *
 * Handles are opened per route and closed after: a route reads tens of tiles,
 * once, and an open handle on a 600 MB file is not worth keeping around.
 */

import { File, Paths } from 'expo-file-system';
import { PMTiles } from 'pmtiles';
import type { RouteSources, TileReader } from '@fred/geo/route';
import { mapFile } from './map-probe.tsx';

export const contoursFile = (state: string): string => `contours-${state}.pmtiles`;

interface Opened {
  readonly reader: TileReader;
  close(): void;
}

function openArchive(name: string): Opened | null {
  const file = new File(Paths.document, name);
  if (!file.exists) return null;
  const handle = file.open();
  const archive = new PMTiles({
    getKey: () => file.uri,
    getBytes: async (offset: number, length: number) => {
      handle.offset = offset;
      const bytes = handle.readBytes(length);
      return { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    },
  });
  return {
    reader: async (z, x, y) => {
      const tile = await archive.getZxy(z, x, y);
      return tile === undefined ? null : new Uint8Array(tile.data);
    },
    close: () => handle.close(),
  };
}

/**
 * The archives for a state, or null when its map is not downloaded. Contours
 * are optional: without them routes are planned on flat ground, and the route
 * says so (`hasElevation: false`).
 */
export function openRouteSources(state: string): { sources: RouteSources; close(): void } | null {
  const basemap = openArchive(mapFile(state));
  if (basemap === null) return null;
  const contours = openArchive(contoursFile(state));
  return {
    sources: contours === null ? { basemap: basemap.reader } : { basemap: basemap.reader, contours: contours.reader },
    close: () => { basemap.close(); contours?.close(); },
  };
}
