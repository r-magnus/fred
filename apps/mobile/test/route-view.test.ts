import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Route, RouteStretch } from '@fred/geo/route';
import {
  ALWAYS_CAVEAT, climbWords, failureStep, warningTags, distanceWords, failureWords, routeBounds, routeGeoJSON, routeWarnings, timeWords, trailNames,
} from '../src/route-view.ts';

const stretch = (over: Partial<RouteStretch>): RouteStretch => ({
  kind: 'path', sure: true, cls: 'trail', detail: 'path', name: null, meters: 1000, seconds: 720,
  ascent: 0, descent: 0, notes: [], coords: [[-119.55, 37.73], [-119.54, 37.735]], ...over,
});

const route = (stretches: RouteStretch[], over: Partial<Route> = {}): Route => ({
  stretches,
  meters: stretches.reduce((a, s) => a + s.meters, 0),
  seconds: stretches.reduce((a, s) => a + s.seconds, 0),
  ascent: 0, descent: 0,
  offTrailMeters: stretches.reduce((a, s) => a + (s.kind === 'off-trail' ? s.meters : 0), 0),
  unsureMeters: stretches.reduce((a, s) => a + (s.sure ? 0 : s.meters), 0),
  straightMeters: 1000,
  notes: [...new Set(stretches.flatMap((s) => s.notes))],
  hasElevation: true,
  ...over,
});

test('distances read the way a trail sign does', () => {
  assert.equal(distanceWords(4), '10 m');
  assert.equal(distanceWords(437), '440 m');
  assert.equal(distanceWords(2310), '2.3 km');
  assert.equal(distanceWords(11_394), '11 km');
});

test('times are a range, never one confident number', () => {
  assert.equal(timeWords(20 * 60), 'about 20–30 min');
  // Half Dome: Tobler says 4 h 17; the card says 4½–6½ h, which brackets the 5–6 h hikers are told.
  assert.equal(timeWords(4 * 3600 + 17 * 60), 'about 4½–6½ h');
  assert.equal(timeWords(40 * 60), 'about 40 min–1 h');
});

test('climb is rounded, and missing heights say nothing rather than "0 m"', () => {
  assert.equal(climbWords(route([stretch({})], { ascent: 1575, descent: 169 })), '1,580 m up, 170 m down');
  assert.equal(climbWords(route([stretch({})], { ascent: 8, descent: 4 })), 'Mostly level');
  assert.equal(climbWords(route([stretch({})], { hasElevation: false })), null);
});

test('an all-trail route has no warnings beyond the standing caveat', () => {
  assert.deepEqual(routeWarnings(route([stretch({ name: 'Mist Trail' })])), []);
  assert.match(ALWAYS_CAVEAT, /private land/);
});

test('off-trail and guessed parts are named, with the colour they are drawn in', () => {
  const r = route([
    stretch({}),
    stretch({ kind: 'off-trail', sure: false, meters: 470, notes: ['steep', 'stream'] }),
    stretch({ kind: 'guessed-join', sure: false, meters: 6 }),
  ]);
  const w = routeWarnings(r);
  // Everything drawn in orange is one sentence, so the warning box stays short.
  assert.match(w[0]!, /^470 m has no trail on the map, and Fred guessed where some paths join \(shown in orange\)\. Go slowly/);
  assert.equal(w.filter((x) => /orange/.test(x)).length, 1);
  assert.ok(w.includes('Steep ground off the trail.'));
  assert.ok(w.includes('Crosses a stream with no bridge on the map.'));
  for (const line of w) assert.match(line, /[.)]$/);
});

test('warning tags: short, same order as the sentences, one per warning', () => {
  const r = route([
    stretch({}),
    stretch({ kind: 'off-trail', sure: false, meters: 470, notes: ['steep', 'stream'] }),
    stretch({ kind: 'guessed-join', sure: false, meters: 6 }),
  ]);
  assert.deepEqual(warningTags(r), ['470 m off trail', 'steep ground', 'stream, no bridge']);
  assert.equal(warningTags(r).length, routeWarnings(r).length);
  assert.deepEqual(warningTags(route([stretch({})])), []);
});

test('a guessed join alone still gets its own warning', () => {
  const w = routeWarnings(route([stretch({}), stretch({ kind: 'guessed-join', sure: false, meters: 6 })]));
  assert.deepEqual(w, ['Where paths almost meet on the map, Fred guessed they join (shown in orange).']);
});

test('every failed plan but a cancel offers a next step', () => {
  for (const r of ['too-far', 'no-map', 'start-unwalkable', 'destination-unwalkable', 'no-route'] as const) {
    assert.notEqual(failureStep(r), null, r);
  }
  assert.equal(failureStep('no-map'), 'get-map');
  assert.equal(failureStep('cancelled'), null);
});

test('trail names: longest first, short scraps left out', () => {
  const r = route([
    stretch({ name: 'John Muir Trail', meters: 3500 }),
    stretch({ name: 'Mist Trail', meters: 2500 }),
    stretch({ name: 'Connector', meters: 90 }),
    stretch({ name: 'John Muir Trail', meters: 2000 }),
  ]);
  assert.deepEqual(trailNames(r), ['John Muir Trail', 'Mist Trail']);
});

test('the line has one feature per stretch, flagged sure or not, and bounds that hold it', () => {
  const r = route([stretch({}), stretch({ kind: 'off-trail', sure: false, coords: [[-119.54, 37.735], [-119.53, 37.74]] })]);
  const g = routeGeoJSON(r);
  assert.deepEqual(g.features.map((f) => f.properties.sure), [true, false]);
  assert.deepEqual(routeBounds(r), [-119.55, 37.73, -119.53, 37.74]);
});

test('every failure but a cancel has words, and they say what to do or why', () => {
  for (const reason of ['too-far', 'no-map', 'start-unwalkable', 'destination-unwalkable', 'no-route'] as const) {
    assert.ok(failureWords(reason).length > 20, reason);
  }
  assert.equal(failureWords('cancelled'), '');
});

test('progress: along, left, off the line, and arrival', async () => {
  const { routeProgress, progressLine } = await import('../src/route-view.ts');
  // Two stretches due north from 37.73: 0.01° of latitude each (~1113 m).
  const r = route([
    stretch({ name: 'Mist Trail', meters: 1113, seconds: 800, coords: [[-119.55, 37.73], [-119.55, 37.74]] }),
    stretch({ kind: 'off-trail', sure: false, meters: 1113, seconds: 1600, coords: [[-119.55, 37.74], [-119.55, 37.75]] }),
  ]);
  const start = routeProgress(r, -119.55, 37.73)!;
  assert.ok(start.along < 1 && Math.abs(start.remainingMeters - 2226) < 5);
  assert.ok(Math.abs(start.remainingSeconds - 2400) < 1);
  const mid = routeProgress(r, -119.55, 37.735)!;
  assert.ok(Math.abs(mid.remainingSeconds - 2000) < 5, `${mid.remainingSeconds}`);
  assert.equal(progressLine(mid, 10).text, 'On Mist Trail.');
  const offTrail = routeProgress(r, -119.55, 37.745)!;
  assert.ok(progressLine(offTrail, 10).warn);
  // ~88 m east of the line.
  const off = routeProgress(r, -119.549, 37.735)!;
  assert.ok(off.offMeters > 80 && off.offMeters < 95);
  assert.match(progressLine(off, 10).text, /off the route/);
  // A poor fix widens what counts as on the route.
  assert.equal(progressLine(off, 120).text, 'On Mist Trail.');
  assert.ok(routeProgress(r, -119.55, 37.7499)!.arrived);
});

test('the route to signal leads with the stay-put advice Ryan approved', async () => {
  const { STAY_PUT, SIGNAL_HEADLINE, SIGNAL_SOURCE } = await import('../src/route-view.ts');
  assert.equal(STAY_PUT, 'If people know where you are, staying put is often safest.');
  assert.equal(SIGNAL_HEADLINE, 'Route to signal');
  // Coverage is the carriers' own claim, never a promise.
  assert.match(SIGNAL_SOURCE, /carriers report/);
  assert.doesNotMatch(SIGNAL_SOURCE, /you will have/i);
});
