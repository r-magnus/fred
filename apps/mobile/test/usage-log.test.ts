import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WAITING_MAX, batchOf, body, dayOf, ever, freshState, newInstallId, note, readState, without } from '../src/usage-log.ts';

const seq = (): (() => number) => { let i = 0; return () => ((i++ * 0.137) % 1); };

test('an install ID is random letters and digits, nothing from the phone', () => {
  const id = newInstallId();
  assert.match(id, /^i[a-z0-9]{20}$/);
  assert.notEqual(newInstallId(), id);
});

test('the day is the phone\'s local date', () => {
  assert.equal(dayOf(new Date(2026, 10, 24, 23, 59)), '2026-11-24');
  assert.equal(dayOf(new Date(2026, 0, 5, 0, 1)), '2026-01-05');
});

test('an event is noted once a day, and again on the next day', () => {
  let s = freshState(seq());
  s = note(s, 'open', '2026-11-24', '0.2.0', 'ios 18.2');
  const same = note(s, 'open', '2026-11-24', '0.2.0', 'ios 18.2');
  assert.equal(same, s);
  s = note(s, 'open', '2026-11-25', '0.2.0', 'ios 18.2');
  s = note(s, 'ask', '2026-11-25', '0.2.0', 'ios 18.2');
  assert.deepEqual(s.waiting.map((r) => `${r.event} ${r.day}`), ['open 2026-11-24', 'open 2026-11-25', 'ask 2026-11-25']);
  assert.ok(ever(s, 'open') && !ever(s, 'setup_done'));
});

test('sent rows leave; a row noted during the send stays', () => {
  let s = freshState(seq());
  s = note(s, 'open', '2026-11-24', '0.2.0', 'android 36');
  const sent = batchOf(s);
  s = note(s, 'ask', '2026-11-24', '0.2.0', 'android 36');
  s = without(s, sent);
  assert.deepEqual(s.waiting.map((r) => r.event), ['ask']);
  assert.ok(ever(s, 'open'), 'still counted as noted today, so not sent twice');
});

test('a batch carries the install ID and at most 50 rows', () => {
  let s = freshState(seq());
  for (let d = 1; d <= 60; d++) s = note(s, 'open', dayOf(new Date(2026, 0, d)), '0.2.0', 'ios');
  assert.equal(s.waiting.length, 60);
  const b = body(s, batchOf(s));
  assert.equal(b.installId, s.installId);
  assert.equal(b.events.length, 50);
  assert.equal(b.events[0]!.day, '2026-01-01', 'oldest first');
});

test('the waiting rows are capped', () => {
  let s = freshState(seq());
  for (let i = 0; i < WAITING_MAX + 20; i++) s = { ...note(s, 'open', '2026-11-24', '0.2.0', 'ios'), last: {} };
  assert.equal(s.waiting.length, WAITING_MAX);
});

test('a saved file is read back; anything else starts fresh', () => {
  let s = freshState(seq());
  s = note(s, 'setup_done', '2026-11-24', '0.2.0', 'ios 18.2');
  const back = readState(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(back, s);
  assert.notEqual(readState(null).installId, s.installId);
  assert.notEqual(readState({ installId: 'bad id!' }).installId, 'bad id!');
  const junk = readState({ installId: s.installId, last: { open: 'yesterday', nope: '2026-11-24' }, waiting: [{ event: 'x' }] });
  assert.deepEqual(junk.last, {});
  assert.deepEqual(junk.waiting, []);
});
