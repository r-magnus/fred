import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  answerJoules, capacityFromChargeCounter, currentMicroA, DEFAULT_BOOK, estimate, iphoneCapacityJoules,
  joulesFromSamples, readBook, record, type PowerSample,
} from '../src/energy.ts';

const steady = (n: number, current: number, voltageMv = 4000, stepMs = 200): PowerSample[] =>
  Array.from({ length: n }, (_, i) => ({ t: i * stepMs, current, voltageMv }));

test('currentMicroA: microamperes or milliamperes, either sign', () => {
  assert.equal(currentMicroA(-1_500_000), 1_500_000);
  assert.equal(currentMicroA(1_500_000), 1_500_000);
  assert.equal(currentMicroA(-1500), 1_500_000);
  assert.equal(currentMicroA(350), 350_000);
});

test('joulesFromSamples: current times voltage over time', () => {
  // 1.5 A at 4 V is 6 W; 51 samples 200 ms apart span 10 s: 60 J.
  const r = joulesFromSamples(steady(51, -1_500_000))!;
  assert.ok(Math.abs(r.joules - 60) < 1e-6);
  assert.ok(Math.abs(r.seconds - 10) < 1e-9);
  assert.ok(Math.abs(r.watts - 6) < 1e-6);
  // The same phone reporting milliamperes.
  assert.ok(Math.abs(joulesFromSamples(steady(51, 1500))!.joules - 60) < 1e-6);
});

test('joulesFromSamples: untrustworthy readings give nothing', () => {
  assert.equal(joulesFromSamples(steady(3, -1_500_000)), undefined);
  assert.equal(joulesFromSamples(steady(10, -1_500_000, 4000, 5000)), undefined);
  assert.equal(joulesFromSamples(steady(10, 0)), undefined);
  assert.equal(joulesFromSamples(steady(10, -20_000_000)), undefined);
});

test('answerJoules: the idle draw comes off; charging or a worse-than-idle reading gives nothing', () => {
  const samples = steady(51, -1_500_000);
  assert.ok(Math.abs(answerJoules({ samples, idleWatts: 1, charging: false })! - 50) < 1e-6);
  assert.equal(answerJoules({ samples, idleWatts: 1, charging: true }), undefined);
  assert.equal(answerJoules({ samples, idleWatts: 7, charging: false }), undefined);
  // The iPhone's counter is used as it is, charging or not.
  assert.equal(answerJoules({ counterJoules: 42, charging: true }), 42);
  assert.equal(answerJoules({ counterJoules: 0, charging: false }), undefined);
});

test('record: the first reading replaces the default, later ones move the average', () => {
  const one = record(DEFAULT_BOOK, 'written', 50);
  assert.deepEqual(one.written, { joules: 50, n: 1 });
  const two = record(one, 'written', 100);
  assert.ok(Math.abs(two.written.joules - 60) < 1e-9);
  assert.equal(two.written.n, 2);
  assert.deepEqual(two.quick, DEFAULT_BOOK.quick);
  assert.equal(record(one, 'written', -5), one);
  assert.equal(record(one, 'written', 99_999), one);
});

test('readBook: a damaged file gives the defaults', () => {
  assert.equal(readBook(undefined), DEFAULT_BOOK);
  assert.equal(readBook('{'), DEFAULT_BOOK);
  assert.equal(readBook('{"written":{"joules":-1,"n":2},"quick":{"joules":5,"n":1}}'), DEFAULT_BOOK);
  assert.deepEqual(readBook(JSON.stringify(record(DEFAULT_BOOK, 'quick', 5))).quick, { joules: 5, n: 1 });
});

test('capacityFromChargeCounter: the full battery from what is left', () => {
  // 4,126,000 uAh at 81%: 5.094 Ah full, at 3.85 V, 70.6 kJ.
  const j = capacityFromChargeCounter(4_126_000, 0.81)!;
  assert.ok(Math.abs(j - (4.126 / 0.81) * 3.85 * 3600) < 1e-6);
  assert.equal(capacityFromChargeCounter(null, 0.8), undefined);
  assert.equal(capacityFromChargeCounter(4_126_000, 0.01), undefined);
  assert.equal(capacityFromChargeCounter(12, 0.8), undefined);
});

test('iphoneCapacityJoules: by model, with a default', () => {
  assert.equal(iphoneCapacityJoules('iPhone17,3'), 13.82 * 3600);
  assert.equal(iphoneCapacityJoules('iPhone99,9'), 13 * 3600);
  assert.equal(iphoneCapacityJoules(null), 13 * 3600);
});

test('estimate: a percentage and how many more the charge allows', () => {
  const battery = { level: 0.5, capacityJoules: 70_000, coarse: false };
  const e = estimate('written', record(DEFAULT_BOOK, 'written', 70), battery)!;
  assert.ok(Math.abs(e.percent - 0.1) < 1e-9);
  assert.equal(e.answersLeft, 500);
  assert.equal(e.measured, true);
  assert.equal(e.text, '~0.1% battery · ~500 more like it');
  assert.deepEqual(e.line.filter((p) => p.figure).map((p) => p.text), ['~0.1%', '~500']);
  const q = estimate('quick', DEFAULT_BOOK, { ...battery, coarse: true })!;
  assert.equal(q.measured, false);
  assert.equal(q.text, '~0.01% battery · very roughly 1,000 more like it');
  assert.equal(estimate('quick', DEFAULT_BOOK, battery)!.text, '~0.01% battery · 1,000+ more like it');
  assert.ok(Math.abs(q.percent - (10 / 70_000) * 100) < 1e-9);
  assert.equal(estimate('written', DEFAULT_BOOK, undefined), undefined);
});

test('estimate: a ceiling while the message is still being typed', () => {
  const battery = { level: 0.5, capacityJoules: 70_000, coarse: false };
  const e = estimate('written', DEFAULT_BOOK, battery, true)!;
  assert.equal(e.text, 'up to ~0.2% battery · at least ~200 more');
  assert.deepEqual(e.line.filter((p) => p.figure).map((p) => p.text), ['~0.2%', '~200']);
  assert.equal(estimate('written', DEFAULT_BOOK, { ...battery, level: 0 }, true)!.text, 'up to ~0.2% battery');
});
