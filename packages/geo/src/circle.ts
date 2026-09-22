/**
 * The "roughly here" ring — B-KR2's estimated location zone.
 *
 * B-KR2 asks for "a map with an estimated location zone", and the honest zone
 * is the one the GPS itself reports: `accuracyMeters` is a 68% confidence
 * radius, so a circle of that radius is a claim the hardware already stands
 * behind rather than one invented for the display.
 *
 * Pure geometry, no map library, so `node --test` can check it. The app turns
 * the result into GeoJSON for MapLibre.
 */

/** Mean Earth radius, metres. Spherical is ample: a ±10 m circle does not need an ellipsoid. */
const R = 6_371_008.8;

const toRad = (d: number): number => (d * Math.PI) / 180;
const toDeg = (r: number): number => (r * 180) / Math.PI;

/**
 * A closed ring of [lon, lat] points approximating a circle on the sphere.
 *
 * Points are computed by walking a fixed distance along successive bearings,
 * rather than by scaling longitude by cos(latitude) — the cheap version visibly
 * skews near the poles and is wrong by a metre or two even in California, which
 * is a tenth of the accuracy being drawn.
 *
 * The ring closes explicitly: GeoJSON requires the first and last position to
 * be identical, and MapLibre renders an unclosed polygon with a seam.
 */
export function circleRing(
  latitude: number,
  longitude: number,
  radiusMeters: number,
  points = 64,
): [number, number][] {
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) return [];
  const lat1 = toRad(latitude);
  const lon1 = toRad(longitude);
  const d = radiusMeters / R;
  const ring: [number, number][] = [];
  for (let i = 0; i < points; i++) {
    const brng = (2 * Math.PI * i) / points;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng),
    );
    const lon2 = lon1 + Math.atan2(
      Math.sin(brng) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
    // Normalise into [-180, 180] so a ring spanning the antimeridian does not
    // render as a band across the whole world.
    ring.push([((toDeg(lon2) + 540) % 360) - 180, toDeg(lat2)]);
  }
  if (ring.length > 0) ring.push(ring[0]!);
  return ring;
}

/** Great-circle distance in metres, for checking a ring is the radius it claims. */
export function distanceMeters(
  aLat: number, aLon: number, bLat: number, bLon: number,
): number {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
