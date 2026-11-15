/**
 * Regions of a state (#224): which one a position is in, how far it is to the
 * edge of what is downloaded, and where to put a region's name on the map.
 *
 * Pure, so it is tested on the desktop (test/regions.test.ts). The outlines
 * come from scripts/build-state-regions.mjs: each region's border as flat
 * [lon, lat, ...] rings, and each border two regions share, once, as a line.
 * Both neighbours use the very same points along a shared border, so a
 * position is in one region or the other, never neither.
 */

export interface RegionOutline {
  readonly id: string;
  readonly name: string;
  /** Flat [lon, lat, lon, lat, ...] closed rings: the mainland and any islands. */
  readonly rings: readonly (readonly number[])[];
}
export interface RegionEdge {
  /** The two regions either side, by id. */
  readonly a: string;
  readonly b: string;
  /** Flat [lon, lat, ...] line. */
  readonly line: readonly number[];
}
export interface RegionOutlines {
  readonly schemaVersion: number;
  readonly state: string;
  readonly regions: readonly RegionOutline[];
  readonly edges: readonly RegionEdge[];
}

/** A download place: a whole state ("NV") or one region of one ("CA/south"). */
export const placeKey = (state: string, region?: string | null): string =>
  (region == null ? state : `${state}/${region}`);
export function splitKey(key: string): { readonly state: string; readonly region: string | null } {
  const at = key.indexOf('/');
  return at < 0 ? { state: key, region: null } : { state: key.slice(0, at), region: key.slice(at + 1) };
}

/** Even-odd test of one flat ring. */
function ringContains(ring: readonly number[], lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i]!, yi = ring[i + 1]!, xj = ring[j]!, yj = ring[j + 1]!;
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The region a position is in, or null outside them all (offshore, or another state). */
export function regionAt(outlines: RegionOutlines, lon: number, lat: number): RegionOutline | null {
  return outlines.regions.find((r) => r.rings.some((ring) => ringContains(ring, lon, lat))) ?? null;
}

/**
 * Kilometres from a position to a flat line, on a flat map centred on the
 * position. Good to well under 1% at the tens of kilometres this is used for.
 */
export function kmToLine(lon: number, lat: number, line: readonly number[]): number {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
  const ky = 110.57;
  let best = Infinity;
  for (let i = 0; i + 3 < line.length; i += 2) {
    const ax = (line[i]! - lon) * kx, ay = (line[i + 1]! - lat) * ky;
    const bx = (line[i + 2]! - lon) * kx, by = (line[i + 3]! - lat) * ky;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

/** How near the edge of the downloaded map has to be before Fred says so. */
export const EDGE_WARN_KM = 10;

export interface EdgeAhead {
  /** The region the position is in: downloaded. */
  readonly from: RegionOutline;
  /** The neighbour across the nearest border: not downloaded. */
  readonly to: RegionOutline;
  readonly km: number;
}

/**
 * The nearest border to a region that is not on the phone, when the position
 * is inside one that is and that border is within `withinKm`. Null when there
 * is nothing to warn about: outside every region, in a region that is not
 * downloaded (that is said another way), or far from any missing neighbour.
 */
export function edgeAhead(
  outlines: RegionOutlines, lon: number, lat: number, have: ReadonlySet<string>, withinKm = EDGE_WARN_KM,
): EdgeAhead | null {
  const from = regionAt(outlines, lon, lat);
  if (from === null || !have.has(from.id)) return null;
  let best: EdgeAhead | null = null;
  for (const e of outlines.edges) {
    const other = e.a === from.id ? e.b : e.b === from.id ? e.a : null;
    if (other === null || have.has(other)) continue;
    const km = kmToLine(lon, lat, e.line);
    if (km <= withinKm && (best === null || km < best.km)) {
      const to = outlines.regions.find((r) => r.id === other);
      if (to !== undefined) best = { from, to, km };
    }
  }
  return best;
}

/** "about 8 km", "under 1 km": rounded, because the border itself is drawn to ~200 m. */
export const roughKm = (km: number): string => (km < 1 ? 'under 1 km' : `about ${Math.round(km)} km`);

/**
 * Where a region's name goes: the point of its biggest ring that is farthest
 * from that ring's edge, found on a grid. The middle of the bounding box can
 * fall outside a curved region (or in the sea), and a name there points at
 * the wrong place.
 */
export function labelPoint(region: RegionOutline, steps = 24): readonly [number, number] {
  const area = (r: readonly number[]): number => {
    let a = 0;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += r[j]! * r[i + 1]! - r[i]! * r[j + 1]!;
    return Math.abs(a / 2);
  };
  const ring = [...region.rings].sort((x, y) => area(y) - area(x))[0];
  if (ring === undefined || ring.length < 2) return [0, 0];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    minX = Math.min(minX, ring[i]!); maxX = Math.max(maxX, ring[i]!);
    minY = Math.min(minY, ring[i + 1]!); maxY = Math.max(maxY, ring[i + 1]!);
  }
  let best: readonly [number, number] = [ring[0]!, ring[1]!];
  let far = -1;
  for (let ix = 1; ix < steps; ix++) {
    for (let iy = 1; iy < steps; iy++) {
      const x = minX + ((maxX - minX) * ix) / steps, y = minY + ((maxY - minY) * iy) / steps;
      if (!ringContains(ring, x, y)) continue;
      const d = kmToLine(x, y, ring);
      if (d > far) { far = d; best = [x, y]; }
    }
  }
  return best;
}
