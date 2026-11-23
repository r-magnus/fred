import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENTS, checkUsage, usageBindings } from '../src/usage.ts';
import { readFileSync } from 'node:fs';

/** The app's list, read as text: the two packages don't import each other. */
const appSrc = readFileSync(new URL('../../../apps/mobile/src/usage-log.ts', import.meta.url), 'utf8');
const USAGE_EVENTS = [...(appSrc.match(/USAGE_EVENTS = \[([\s\S]*?)\] as const/)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

const row = { event: 'open', day: '2026-11-24', appVersion: '0.2.0', platform: 'android 36' };
const good = { installId: 'iabc123def456ghi789jk', events: [row, { ...row, event: 'setup_done' }] };

test('a batch from the app is accepted, one row per event, with the install ID on each', () => {
  const res = checkUsage(good);
  assert.ok(res.ok);
  assert.equal(res.rows.length, 2);
  const b = usageBindings(res.rows[1]!, '2026-11-24T10:00:00.000Z');
  assert.deepEqual(b, ['iabc123def456ghi789jk', 'setup_done', '2026-11-24', '0.2.0', 'android 36', '2026-11-24T10:00:00.000Z']);
});

test('the server knows every event the app sends, and no others', () => {
  assert.deepEqual([...EVENTS].sort(), [...USAGE_EVENTS].sort());
});

for (const [why, bad] of [
  ['not an object', [good]],
  ['installId', { ...good, installId: 'short' }],
  ['installId', { ...good, installId: 'has spaces in it' }],
  ['events', { ...good, events: [] }],
  ['events', { ...good, events: Array(51).fill(row) }],
  ['event', { ...good, events: [{ ...row, event: 'question' }] }],
  ['day', { ...good, events: [{ ...row, day: '2026-11-24T10:00' }] }],
  ['appVersion', { ...good, events: [{ ...row, appVersion: '' }] }],
  ['platform', { ...good, events: [{ ...row, platform: 'x'.repeat(41) }] }],
] as const) {
  test(`usage refused: ${why}`, () => {
    const res = checkUsage(bad);
    assert.equal(res.ok, false);
    assert.equal(!res.ok && res.why, why);
  });
}

test('extra fields, like a question, are never stored', () => {
  const res = checkUsage({ ...good, events: [{ ...row, question: 'where am i', location: [1, 2] }] });
  assert.ok(res.ok);
  assert.deepEqual(Object.keys(res.rows[0]!).sort(), ['appVersion', 'day', 'event', 'installId', 'platform']);
});
