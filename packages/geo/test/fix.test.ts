import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isBetterFix, meetsTarget, summariseTrack, toTrackRow, TRACK_HEADER,
  type TrackSample,
} from '../src/index.ts';

const r = (accuracyMeters: number | null) => ({ accuracyMeters });

test('anything beats having no fix at all', () => {
  assert.equal(isBetterFix(null, r(75)), true);
  assert.equal(isBetterFix(null, r(null)), true);
});

test('a tighter fix wins and a looser one does not', () => {
  assert.equal(isBetterFix(r(75), r(20)), true);
  assert.equal(isBetterFix(r(20), r(75)), false);
});

test('an equal fix does not displace the one already held', () => {
  // Ties go to the incumbent, so a stationary phone stops churning the best.
  assert.equal(isBetterFix(r(20), r(20)), false);
});

test('an unmeasurable reading never displaces a measured one', () => {
  // The regression this guards: one null-accuracy update late in the 15 s
  // window used to be able to throw away the best reading of the whole run.
  assert.equal(isBetterFix(r(8), r(null)), false);
  assert.equal(isBetterFix(r(500), r(null)), false);
});

test('an unmeasurable reading is replaced by anything, including another', () => {
  assert.equal(isBetterFix(r(null), r(75)), true);
  assert.equal(isBetterFix(r(null), r(null)), true);
});

test('the early exit needs a real number, not a missing one', () => {
  assert.equal(meetsTarget(r(10), 10), true);
  assert.equal(meetsTarget(r(9.9), 10), true);
  assert.equal(meetsTarget(r(10.1), 10), false);
  assert.equal(meetsTarget(r(null), 10), false);
});

const sample = (o: Partial<TrackSample> = {}): TrackSample => ({
  elapsedMs: 0, timestamp: 1_700_000_000_000,
  latitude: 37.8651, longitude: -119.5383,
  accuracyMeters: 20, altitudeMeters: null, speedMps: null,
  state: 'CA', improved: false, mocked: false, ...o,
});

test('a CSV row has one field per header column', () => {
  assert.equal(
    toTrackRow(sample()).split(',').length,
    TRACK_HEADER.split(',').length,
  );
});

test('missing numbers are written as empty fields, not as the string null', () => {
  const row = toTrackRow(sample({ accuracyMeters: null, altitudeMeters: null, speedMps: null }));
  assert.equal(row.includes('null'), false);
  assert.equal(row, '0,1700000000000,37.8651,-119.5383,,,,CA,false,false');
});

test('summary reports the median accuracy, which is how B-KR1 is stated', () => {
  const s = summariseTrack([
    sample({ accuracyMeters: 75 }), sample({ accuracyMeters: 8 }),
    sample({ accuracyMeters: 20 }),
  ], 10);
  assert.equal(s.medianAccuracyMeters, 20);
  assert.equal(s.bestAccuracyMeters, 8);
  assert.equal(s.samples, 3);
});

test('an even number of readings takes the mean of the middle pair', () => {
  const s = summariseTrack([
    sample({ accuracyMeters: 10 }), sample({ accuracyMeters: 20 }),
    sample({ accuracyMeters: 30 }), sample({ accuracyMeters: 40 }),
  ], 5);
  assert.equal(s.medianAccuracyMeters, 25);
});

test('readings with no accuracy are left out of the median, not counted as zero', () => {
  const s = summariseTrack([
    sample({ accuracyMeters: null }), sample({ accuracyMeters: 20 }),
    sample({ accuracyMeters: 40 }),
  ], 10);
  assert.equal(s.medianAccuracyMeters, 30);
  assert.equal(s.samples, 3);
});

test('time to target is the first sample that met it', () => {
  const s = summariseTrack([
    sample({ elapsedMs: 0, accuracyMeters: 75 }),
    sample({ elapsedMs: 4000, accuracyMeters: 9 }),
    sample({ elapsedMs: 9000, accuracyMeters: 5 }),
  ], 10);
  assert.equal(s.timeToTargetMs, 4000);
});

test('time to target is null when the window never got there', () => {
  // The indoor case: the 10 m early exit never fires, so the watch runs long.
  const s = summariseTrack([sample({ accuracyMeters: 64 }), sample({ accuracyMeters: 75 })], 10);
  assert.equal(s.timeToTargetMs, null);
});

test('a track with no usable readings summarises to nulls, not to a crash', () => {
  const s = summariseTrack([sample({ accuracyMeters: null })], 10);
  assert.equal(s.medianAccuracyMeters, null);
  assert.equal(s.bestAccuracyMeters, null);
  assert.equal(s.timeToTargetMs, null);
  assert.deepEqual(summariseTrack([], 10).states, []);
});

test('states appear once each, in the order first seen', () => {
  const s = summariseTrack([
    sample({ state: 'CA' }), sample({ state: 'CA' }),
    sample({ state: 'OR' }), sample({ state: 'CA' }), sample({ state: null }),
  ], 10);
  assert.deepEqual(s.states, ['CA', 'OR']);
});

test('a mocked reading anywhere marks the whole track', () => {
  // B-KR1 is graded from this file, so a faked run must not read as a real one.
  assert.equal(summariseTrack([sample(), sample({ mocked: true })], 10).anyMocked, true);
  assert.equal(summariseTrack([sample(), sample()], 10).anyMocked, false);
});
