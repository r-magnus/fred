import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, bindings } from '../src/check.ts';

const good = {
  id: 'abc-1-xyz', rating: 'up', comment: null, question: 'what is this plant?', reply: 'Poison oak.',
  replyKind: 'answer', sources: ['Plants of CA · Toxicodendron'], deep: false, stopped: false,
  askedAt: '2026-11-19T10:00:00.000Z', ratedAt: '2026-11-19T10:01:00Z', appVersion: '0.2.0', platform: 'android 35',
};

test('a rating from the app is accepted and stored with its sources as JSON', () => {
  const res = check(good);
  assert.ok(res.ok);
  const b = bindings(res.row, '2026-11-19T10:01:05.000Z');
  assert.equal(b[6], '["Plants of CA · Toxicodendron"]');
  assert.equal(b[7], 0);
  assert.equal(b.length, 14);
});

test('a blank comment is stored as none', () => {
  const res = check({ ...good, comment: '  ' });
  assert.ok(res.ok && res.row.comment === null);
});

for (const [why, bad] of [
  ['not an object', [good]],
  ['id', { ...good, id: 'has spaces' }],
  ['id', { ...good, id: '' }],
  ['rating', { ...good, rating: 'meh' }],
  ['comment', { ...good, comment: 'x'.repeat(2001) }],
  ['reply', { ...good, reply: 42 }],
  ['sources', { ...good, sources: 'one' }],
  ['flags', { ...good, deep: 'yes' }],
  ['askedAt', { ...good, askedAt: 'yesterday' }],
  ['platform', { ...good, platform: undefined }],
] as const) {
  test(`refused: ${why}`, () => {
    const res = check(bad);
    assert.equal(res.ok, false);
    assert.equal(!res.ok && res.why, why);
  });
}
