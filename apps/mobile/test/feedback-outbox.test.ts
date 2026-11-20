import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, OUTBOX_MAX, fit, flushOutbox, resultOf, upsert, type Rating, type SendResult } from '../src/feedback-outbox.ts';
import { LIMITS as SERVER_LIMITS, check } from '../../../tools/feedback-worker/src/check.ts';

const rating = (over: Partial<Rating> = {}): Rating => ({
  id: 'abc-1-xyz', rating: 'down', comment: null, question: 'how do I treat a burn?', reply: 'Cool it under water.',
  replyKind: 'answer', sources: ['Wilderness First Aid, p. 12 · Burns'], deep: false, stopped: false,
  askedAt: '2026-11-19T10:00:00.000Z', ratedAt: '2026-11-19T10:01:00.000Z', appVersion: '0.2.0', platform: 'ios 18.2',
  ...over,
});

/** An outbox in memory, with every save recorded. */
function box(start: Rating[]) {
  let items = [...start];
  return { load: () => [...items], save: (o: Rating[]) => { items = o; }, get: () => items, set: (o: Rating[]) => { items = o; } };
}

test('a second rating of the same reply replaces the first', () => {
  const o = upsert(upsert([], rating({ rating: 'up' })), rating({ rating: 'down', comment: 'wrong' }));
  assert.equal(o.length, 1);
  assert.equal(o[0]!.rating, 'down');
  assert.equal(o[0]!.comment, 'wrong');
});

test('the outbox keeps the newest when it is full', () => {
  let o: Rating[] = [];
  for (let i = 0; i < OUTBOX_MAX + 5; i++) o = upsert(o, rating({ id: `r${i}` }));
  assert.equal(o.length, OUTBOX_MAX);
  assert.equal(o[0]!.id, 'r5');
  assert.equal(o.at(-1)!.id, `r${OUTBOX_MAX + 4}`);
});

test('long text is cut to the limits and a blank comment is none', () => {
  const r = fit(rating({ reply: 'x'.repeat(20_000), comment: '   ' }));
  assert.equal(r.reply.length, LIMITS.reply);
  assert.equal(r.comment, null);
});

test('statuses: 2xx sent, busy or broken server retried, anything else let go', () => {
  assert.equal(resultOf(200), 'sent');
  assert.equal(resultOf(429), 'retry');
  assert.equal(resultOf(503), 'retry');
  assert.equal(resultOf(408), 'retry');
  assert.equal(resultOf(400), 'drop');
  assert.equal(resultOf(403), 'drop');
});

test('without signal nothing is lost, and the round stops at the first failure', async () => {
  const b = box([rating({ id: 'a' }), rating({ id: 'b' })]);
  let tries = 0;
  const res = await flushOutbox(b.load, b.save, async () => { tries += 1; throw new Error('Network request failed'); });
  assert.equal(tries, 1);
  assert.deepEqual(res, { sent: 0, dropped: 0, left: 2 });
  assert.equal(b.get().length, 2);
});

test('sent and refused ratings leave the phone; the rest wait', async () => {
  const b = box([rating({ id: 'a' }), rating({ id: 'b' }), rating({ id: 'c' })]);
  const plan: Record<string, SendResult> = { a: 'sent', b: 'drop', c: 'retry' };
  const res = await flushOutbox(b.load, b.save, async (r) => plan[r.id]!);
  assert.deepEqual(res, { sent: 1, dropped: 1, left: 1 });
  assert.deepEqual(b.get().map((r) => r.id), ['c']);
});

test('a comment added while its rating was being sent is kept for the next round', async () => {
  const b = box([rating({ id: 'a' })]);
  await flushOutbox(b.load, b.save, async () => {
    // The hiker writes a comment mid-send: a newer copy of the same rating.
    b.set(upsert(b.get(), rating({ id: 'a', comment: 'missed the step about blisters', ratedAt: '2026-11-19T10:02:00.000Z' })));
    return 'sent';
  });
  assert.equal(b.get().length, 1);
  assert.equal(b.get()[0]!.comment, 'missed the step about blisters');
});

test('the app and the server hold ratings to the same limits', () => {
  assert.deepEqual(LIMITS, SERVER_LIMITS);
});

test('whatever the app sends, fitted, the server accepts', () => {
  const big = fit(rating({
    id: 'x'.repeat(100), comment: 'c'.repeat(5000), question: 'q'.repeat(5000), reply: 'r'.repeat(50_000),
    sources: Array.from({ length: 40 }, () => 's'.repeat(400)), replyKind: 'abstain', platform: 'android 35',
  }));
  const res = check(JSON.parse(JSON.stringify(big)));
  assert.equal(res.ok, true, res.ok ? '' : res.why);
});
