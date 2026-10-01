import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecord, conditionsFor, whoIn } from '../src/record.ts';
import { conditionsIn } from '../src/conditions.ts';

const ids = (ms: string[]): string[] => conditionsFor(buildRecord(ms), ms.at(-1)!).map((c) => c.id);

test('who a message is about', () => {
  assert.deepEqual(whoIn('a snake struck my buddy'), { kind: 'named', name: 'my buddy' });
  assert.equal(whoIn('now i twisted my own ankle hiking down').kind, 'self');
  assert.equal(whoIn('its on his ankle and swelling').kind, 'pronoun');
  assert.equal(whoIn('what now').kind, 'unknown');
});

test("a friend's snakebite does not follow the hiker's own ankle", () => {
  assert.deepEqual(ids(['a snake struck my buddy', 'ok the rangers carried him out', 'now i twisted my own ankle hiking down']), []);
  assert.deepEqual(ids(['a snake struck my buddy', 'now i twisted my own ankle']), []);
  assert.deepEqual(ids(['a snake struck my buddy', 'its on his ankle and swelling']), ['snakebite']);
});

test('a condition is over only in the hiker\'s words, and a body part being fine is not', () => {
  assert.deepEqual(ids(['my brother slipped and fell maybe 10 feet', 'he says his neck is fine']), ['fall']);
  assert.deepEqual(ids(['my friend got bit by a snake', 'he seems better now', 'what now']), []);
});

test('altitude and heat come from the setting and a symptom, in any order of messages', () => {
  assert.deepEqual(conditionsIn(['camping at 10500 ft tonight', 'my buddy has a headache']).map((c) => c.id), ['altitude']);
  assert.deepEqual(conditionsIn(['we\'re camping at 9000 ft', 'my friend keeps throwing up and has a bad headache']).map((c) => c.id), ['altitude']);
  assert.deepEqual(conditionsIn(['doing the canyon loop today, it\'s like 105 out', 'my son is complaining he\'s dizzy']).map((c) => c.id), ['heat']);
  assert.deepEqual(conditionsIn(['my son is complaining he\'s dizzy']), []);
});

test('low blood sugar from a diabetic and a later sign; bleeding; pale fingers', () => {
  assert.deepEqual(conditionsIn(["he's diabetic btw", 'heading back down now', "and sweaty, and he's not making much sense"]).map((c) => c.id), ['low-sugar']);
  assert.ok(conditionsIn(['i tied a belt tight above it as a tourniquet']).some((c) => c.id === 'bleeding'));
  assert.ok(conditionsIn(['cant feel my fingertips and theyre pale after that swim']).some((c) => c.id === 'frostbite'));
});

test('a message can close what it sets', () => {
  assert.deepEqual(ids(['my friend was bleeding badly yesterday but he is fine now']), []);
});
