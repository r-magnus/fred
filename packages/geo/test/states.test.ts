import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stateForCoords, STATE_BOUNDARIES } from '../src/index.ts';

test('resolves well-inside points to the right state', () => {
  const cases: readonly (readonly [number, number, string])[] = [
    [37.8651, -119.5383, 'CA'], // Yosemite Valley
    [36.1699, -115.1398, 'NV'], // Las Vegas
    [39.7392, -104.9903, 'CO'], // Denver
    [44.4280, -110.5885, 'WY'], // Yellowstone
    [47.6062, -122.3321, 'WA'], // Seattle
    [30.2672, -97.7431, 'TX'],  // Austin
    [25.7617, -80.1918, 'FL'],  // Miami
    [42.3601, -71.0589, 'MA'],  // Boston
    [61.2181, -149.9003, 'AK'], // Anchorage
    [19.8207, -155.4681, 'HI'], // Mauna Kea
  ];
  for (const [lat, lon, want] of cases) {
    assert.equal(stateForCoords(lat, lon), want, `${lat},${lon}`);
  }
});

test('returns null outside the United States', () => {
  assert.equal(stateForCoords(19.4326, -99.1332), null);  // Mexico City
  assert.equal(stateForCoords(45.4215, -75.6972), null);  // Ottawa
  assert.equal(stateForCoords(36.9741, -122.0308 - 2), null); // Pacific, off Santa Cruz
});

/**
 * The 1:20M boundary set is coarse, so this pins down *how* coarse rather than
 * pretending it is exact. If a future higher-resolution table is swapped in,
 * these should get tighter, not break.
 */
test('is accurate to roughly a kilometre near a state line', () => {
  // Lake Tahoe's CA/NV line runs along 120°W. Step east and west of it.
  const lat = 39.0968;
  assert.equal(stateForCoords(lat, -120.05), 'CA', '5 km west of the line');
  assert.equal(stateForCoords(lat, -119.95), 'NV', '5 km east of the line');
});

test('every region has a bbox that contains its own rings', () => {
  for (const [code, b] of Object.entries(STATE_BOUNDARIES)) {
    assert.ok(b.rings.length > 0, `${code} has no rings`);
    for (const ring of b.rings) {
      assert.equal(ring.length % 2, 0, `${code} ring is not lon/lat pairs`);
      for (let i = 0; i < ring.length; i += 2) {
        assert.ok(ring[i]! >= b.bbox[0] && ring[i]! <= b.bbox[2], `${code} lon out of bbox`);
        assert.ok(ring[i + 1]! >= b.bbox[1] && ring[i + 1]! <= b.bbox[3], `${code} lat out of bbox`);
      }
    }
  }
});

/**
 * Coastal points that the simplified outline excludes. These are the reason the
 * nearest-boundary fallback exists; without it they all resolve to null.
 */
test('snaps coastal and island points onto their state', () => {
  assert.equal(stateForCoords(21.3069, -157.8583), 'HI', 'Honolulu, seven-vertex Oahu');
  assert.equal(stateForCoords(48.5382, -123.0290), 'WA', 'San Juan Islands');
  assert.equal(stateForCoords(38.0293, -76.0000), 'MD', 'lower Chesapeake Bay');
});

test('the fallback is bounded, so it does not claim a distant foreign point', () => {
  assert.equal(stateForCoords(31.8667, -116.5964), null, 'Ensenada, 79 km out');
  assert.equal(stateForCoords(45.4215, -75.6972), null, 'Ottawa, 71 km out');
});

/**
 * Documenting a known limit rather than asserting something untrue: the
 * boundary set has no notion of an international border, and territory just
 * across one is closer to a US outline than the Chesapeake is. See SNAP_KM.
 */
test('territory just across a border resolves to the neighbouring state', () => {
  assert.equal(stateForCoords(32.5149, -117.0382), 'CA', 'Tijuana, 3.2 km out');
  assert.equal(stateForCoords(42.3149, -83.0364), 'MI', 'Windsor, 2.5 km out');
});
