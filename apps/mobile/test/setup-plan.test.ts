import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STEPS, guidesStatus, listNames, orderStates, queueFor, size, stepFrom } from '../src/setup-plan.ts';

test('the pages run welcome to ready and stop at both ends', () => {
  assert.equal(stepFrom('welcome', -1), null);
  assert.equal(stepFrom('welcome', 1), 'guides');
  assert.equal(stepFrom('ready', 1), null);
  assert.equal(stepFrom('ready', -1), 'sky');
  assert.equal(new Set(STEPS).size, STEPS.length);
});

test('sizes read as megabytes below a gigabyte and never as zero', () => {
  assert.equal(size(64_400_000), '64 MB');
  assert.equal(size(1_267_054_569), '1.3 GB');
  assert.equal(size(38_127), '1 MB');
});

test('the state the hiker is in comes first, the rest by name not code', () => {
  const names = { AK: 'Alaska', AL: 'Alabama', CA: 'California' };
  assert.deepEqual(orderStates(['AK', 'AL', 'CA'], null, names), ['AL', 'AK', 'CA']);
  assert.deepEqual(orderStates(['AK', 'AL', 'CA'], 'CA', names), ['CA', 'AL', 'AK']);
  // A place the app has no name for still sorts, by its code.
  assert.deepEqual(orderStates(['PR', 'AL'], null, names), ['AL', 'PR']);
});

test('guides on the phone are ready whatever the network says', () => {
  assert.deepEqual(guidesStatus(true, { kind: 'loading' }), { kind: 'ready' });
  assert.deepEqual(guidesStatus(true, { kind: 'unreachable', message: 'x' }), { kind: 'ready' });
  assert.deepEqual(guidesStatus(true, { kind: 'loaded', coreBytesLeft: null }), { kind: 'ready' });
});

test('missing guides: each reason is told apart', () => {
  assert.deepEqual(guidesStatus(false, { kind: 'loading' }), { kind: 'checking' });
  assert.deepEqual(guidesStatus(false, { kind: 'unreachable', message: 'No signal.' }), { kind: 'offline', message: 'No signal.' });
  assert.deepEqual(guidesStatus(false, { kind: 'loaded', coreBytesLeft: null }), { kind: 'unpublished' });
  assert.deepEqual(guidesStatus(false, { kind: 'loaded', coreBytesLeft: 1_400_000_000 }), { kind: 'offer', bytes: 1_400_000_000 });
});

test('the download queue keeps the list order and leaves out what is already there', () => {
  const left: Record<string, number> = { CA: 800, OR: 0, UT: 300 };
  const q = queueFor(new Set(['UT', 'OR', 'CA']), ['CA', 'OR', 'UT', 'WA'], (s) => left[s] ?? 0);
  assert.deepEqual(q, { states: ['CA', 'UT'], bytes: 1100 });
  assert.deepEqual(queueFor(new Set(), ['CA'], () => 5), { states: [], bytes: 0 });
});

test('names are joined the way they are said', () => {
  assert.equal(listNames([]), '');
  assert.equal(listNames(['Utah']), 'Utah');
  assert.equal(listNames(['Utah', 'Oregon']), 'Utah and Oregon');
  assert.equal(listNames(['Utah', 'Oregon', 'Idaho']), 'Utah, Oregon and Idaho');
});
