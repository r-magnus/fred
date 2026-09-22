import { test } from 'node:test';
import assert from 'node:assert/strict';
import { circleRing, distanceMeters } from '../src/index.ts';

// Yosemite Valley, the public landmark this repo's tests already use.
const LAT = 37.8651, LON = -119.5383;

test('every point sits at the requested radius', () => {
  for (const r of [10, 100, 1000, 25_000]) {
    for (const [lon, lat] of circleRing(LAT, LON, r, 32)) {
      const d = distanceMeters(LAT, LON, lat, lon);
      assert.ok(Math.abs(d - r) < r * 0.001, `radius ${r}: point at ${d.toFixed(2)} m`);
    }
  }
});

test('the ring closes, because GeoJSON and MapLibre both require it', () => {
  const ring = circleRing(LAT, LON, 500, 16);
  assert.equal(ring.length, 17);
  assert.deepEqual(ring[0], ring[ring.length - 1]);
});

test('a nonsensical radius yields no ring rather than a degenerate one', () => {
  // accuracyMeters is nullable on the platform, and 0 or NaN must not reach
  // the map as a zero-size polygon.
  assert.deepEqual(circleRing(LAT, LON, 0), []);
  assert.deepEqual(circleRing(LAT, LON, -5), []);
  assert.deepEqual(circleRing(LAT, LON, Number.NaN), []);
});

test('longitudes stay inside [-180, 180]', () => {
  // A ring crossing the antimeridian must not render as a band across the map.
  for (const [lon] of circleRing(51.5, 179.9, 50_000, 64)) {
    assert.ok(lon >= -180 && lon <= 180, `longitude out of range: ${lon}`);
  }
});

test('the ring is centred: opposite points straddle the centre', () => {
  const ring = circleRing(LAT, LON, 1000, 8);
  const [lonE, latE] = ring[0]!;
  const [lonW, latW] = ring[4]!;
  assert.ok(Math.abs((latE + latW) / 2 - LAT) < 1e-6);
  assert.ok(Math.abs((lonE + lonW) / 2 - LON) < 1e-6);
});

test('scaling longitude by cos(lat) would be wrong, and is not what this does', () => {
  // The naive approximation lands points short at high latitude. Check a far
  // northern circle still measures true.
  for (const [lon, lat] of circleRing(71.0, -156.0, 5000, 24)) {
    const d = distanceMeters(71.0, -156.0, lat, lon);
    assert.ok(Math.abs(d - 5000) < 5, `point at ${d.toFixed(1)} m, expected 5000`);
  }
});
