import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockingCondition, conditionsIn, latestCondition, violatedCondition } from '../src/conditions.ts';
import { asksSomething, asksToEatUnknown, dangerSign, eatingUnknownInThread, petIsPatient } from '../src/triage.ts';
import { asksSpecifically } from '../src/pipeline.ts';

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
  assert.deepEqual(ids(['my friend fell in the lake and cant stop shaking']), ['hypothermia']);
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

test('a model-written answer that gives advice the condition card forbids is caught; saying not to is fine', () => {
  const snake = conditionsIn(['my friend got bit by a snake']);
  assert.equal(violatedCondition('1. Do not wrap the ankle tightly with ice.\n2. Apply cold compresses intermittently to reduce swelling.', snake)?.id, 'snakebite');
  assert.equal(violatedCondition('1. Do not wrap it tight with ice.\n2. Keep him still and get help.', snake), undefined);
  const burn = conditionsIn(['seared my forearm on the camp stove']);
  assert.equal(violatedCondition('If the blister is larger than a nickel, drain it with a sterile object.', burn)?.id, 'burn');
  assert.equal(violatedCondition('Do not pop the blister. Cover it with a clean dressing.', burn), undefined);
});

test('asking whether something unnamed is safe to eat', () => {
  assert.ok(asksToEatUnknown('can i eat them'));
  assert.ok(asksToEatUnknown('are these berries edible'));
  assert.ok(!asksToEatUnknown('how do i cook rice on a stove'));
  assert.ok(!asksToEatUnknown('my kid ate some berries'));
});

test('a pet that is hurt is the patient; a pet along for the hike is not', () => {
  assert.ok(petIsPatient('a snake struck my dog'));
  assert.ok(petIsPatient('his face is swelling', 'a snake struck my dog'));
  assert.ok(petIsPatient('my dog is limping'));
  assert.ok(!petIsPatient('my dog and i are lost'));
  assert.ok(!petIsPatient('my friend got stung and his face is swelling', 'a bee stung my dog'));
});

test('a named plant is not an unnamed one', () => {
  assert.ok(!asksToEatUnknown('Did people ever eat California brome, or is it just cattle feed?'));
  assert.ok(asksToEatUnknown('I found some mushrooms. Which ones can I eat?'));
  assert.ok(asksToEatUnknown('are these safe to eat'));
});

test('drowsy after a head injury is a danger sign; sleepy alone is not', () => {
  assert.ok(dangerSign(['my boy fell off a big rock and smacked his head', 'he can barely keep his eyes open']));
  assert.ok(!dangerSign(['long day, i am sleepy']));
});

test('a burn said without the word', () => {
  assert.deepEqual(ids(['my son brushed his arm on the camp stove grate']), ['burn']);
  assert.deepEqual(ids(['splashed hot coffee all over my wrist']), ['burn']);
  assert.deepEqual(ids(['my fingertips went hard and waxy on the summit push']), ['frostbite']);
});

test('the latest condition, and whether the last message said it', () => {
  assert.equal(latestCondition(['stepped right on a rattler and it tagged my calf', 'should i prop my leg up on my pack'])?.condition.id, 'snakebite');
  assert.equal(latestCondition(['stepped right on a rattler and it tagged my calf', 'should i prop my leg up on my pack'])?.inLast, false);
  assert.equal(latestCondition(['a snake struck my buddy'])?.inLast, true);
  assert.equal(latestCondition(['how do i purify water']), undefined);
});

test('any opening of a burn blister is caught, whatever it is called', () => {
  const burn = conditionsIn(['my son brushed his arm on the camp stove grate']);
  assert.equal(violatedCondition('If the bubbles are larger than a nickel, drain them with a sterile needle.', burn)?.id, 'burn');
});

test('eating something unnamed, across the thread', () => {
  assert.ok(eatingUnknownInThread('are these blue ones safe', ['my daughter wants to pick berries']));
  assert.ok(eatingUnknownInThread('she already ate a couple', ['my daughter wants to pick berries', 'are these blue ones safe']));
  assert.ok(!eatingUnknownInThread('is it safe to cross here', ['nice day for a hike']));
});

test('a dog with a tick is a pet patient', () => {
  assert.ok(petIsPatient('my dog has a tick, how do i get it off'));
});

test('specific questions a card answers in a sentence, not how-tos', () => {
  for (const m of ['can i put ice on it', 'should we run to the car', 'how long should i ice it', 'where exactly do i put the tourniquet',
    'would butter help', 'is it worth trying to draw the poison out with my mouth', 'what should i watch for after']) assert.ok(asksSpecifically(m), m);
  for (const m of ['how do i stop the bleeding', 'what should i do', 'what now', 'a snake struck my buddy', 'my ankle is swelling']) assert.ok(!asksSpecifically(m), m);
});
