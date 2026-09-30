import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockingCondition, conditionsIn } from '../src/conditions.ts';
import { asksSomething, dangerSign } from '../src/triage.ts';

const ids = (ms: string[]): string[] => conditionsIn(ms).map((c) => c.id);

test('a snakebite is read across messages', () => {
  assert.deepEqual(ids(['how do i tell if a snake is venomous', 'my friend just got bit by one']), ['snakebite']);
  assert.deepEqual(ids(['just saw a rattlesnake on the trail', 'it got my buddy on the ankle']), ['snakebite']);
  assert.deepEqual(ids(['a snake struck my buddy']), ['snakebite']);
});

test('a snake with no bite, or another biter, is not a snakebite', () => {
  assert.deepEqual(ids(['how do i tell if a snake is venomous']), []);
  assert.deepEqual(ids(['saw a snake earlier', 'a mosquito bit me']), []);
});

test('a fall is from height or down a slope, not into water', () => {
  assert.deepEqual(ids(['my dad slipped and tumbled down a rocky slope']), ['fall']);
  assert.deepEqual(ids(['my friend fell off a ledge']), ['fall']);
  assert.deepEqual(ids(['my friend fell in the lake and cant stop shaking']), []);
});

test('the sprain card must not follow a snakebite; the shock card must not follow a fall', () => {
  const snake = conditionsIn(['my friend got bit by a snake']);
  assert.equal(blockingCondition('Twisted or sprained ankle, or a strained muscle', snake)?.id, 'snakebite');
  assert.equal(blockingCondition('Snakebite', snake), undefined);
  assert.equal(blockingCondition('Shock after an injury', conditionsIn(['he fell off a ledge']))?.id, 'fall');
});

test('danger signs', () => {
  for (const m of ["we pulled him out but he isnt breathing", 'one side of her face is drooping', 'he\'s shaky sweaty and confused',
    'blood keeps pushing out', 'my lips are swelling and my throat feels tight', 'my friend stopped sweating and is acting weird',
    'she collapsed on the trail']) assert.ok(dangerSign([m]), m);
  assert.ok(dangerSign(['something big is sniffing around the tent', 'its a bear']));
  assert.ok(dangerSign(['a snake struck my buddy']));
});

test('not danger signs', () => {
  for (const m of ['my knee is killing me going downhill', 'should i pop it', 'is it safe to touch cholla', 'the tent collapsed in the wind',
    'got pretty sunburned today', 'we saw a bear across the valley this morning']) assert.ok(!dangerSign([m]), m);
});

test('a message that asks something', () => {
  for (const m of ['how much water', 'should i follow it down', "ok she's feeling better. unrelated but what's this plant with yellow flowers everywhere",
    'is it safe to touch cholla', 'any tips', 'what helps']) assert.ok(asksSomething(m), m);
  for (const m of ["we're about 2 miles from the car", 'ok found the trail thank god', 'phone at 15%', 'the view up here is amazing']) assert.ok(!asksSomething(m), m);
});
