import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecord, conditionsFor, latestFor, onlyHandedOver, saysHandedOver, saysResolved, sinceResolved, whoIn } from '../src/record.ts';
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

test('what is over comes before what the message names next (#100)', () => {
  assert.deepEqual(ids(['something is rustling outside the tent', 'ok it left. my kid just burned her hand on the stove']), ['burn']);
  assert.deepEqual(ids(['my brother burned his arm on the stove', 'ok hes fine now but he slipped and fell maybe 10 feet']), ['fall']);
});

test('help has taken over: rescuers have the person, or they are at a hospital (#173)', () => {
  for (const m of ['ok the rangers carried him out', 'the helicopter just lifted off with her', 'the paramedics have him now',
    'an ambulance took him from the trailhead', 'they took her to the hospital', 'search and rescue flew me out and im at the clinic']) {
    assert.ok(saysHandedOver(m), m);
    assert.ok(saysResolved(m), m);
  }
  for (const m of ['the rangers are on their way but his arm is swelling', 'i called 911 and theyre sending a helicopter',
    'we carried him out to the road', 'he says his neck is fine', 'can the rangers find us here']) assert.ok(!saysHandedOver(m), m);
});

test('help taking over with a new problem beside it is not only that (#173)', () => {
  for (const m of ['ok the rangers carried him out', 'the paramedics have him now', 'update, search and rescue flew me out and im at the clinic',
    'the rangers carried him out, thanks for everything', 'ok. the helicopter just lifted off with her. thank you so much']) assert.ok(onlyHandedOver(m), m);
  for (const m of ['ok paramedics have him. unrelated but i sliced my finger whittling', 'ems took over. different thing, i cut my thumb with my knife',
    'the medics took him. ok now my foot is bleeding', 'thanks for everything', 'we carried him out to the road']) assert.ok(!onlyHandedOver(m), m);
});

test('what was said before something was over is past (#173)', () => {
  assert.deepEqual(sinceResolved(['a rattlesnake tagged my uncle', 'an ambulance took him', 'now ive got a blister']), ['an ambulance took him', 'now ive got a blister']);
  assert.deepEqual(sinceResolved(['a snake bit my brother', 'his arm is swelling']), ['a snake bit my brother', 'his arm is swelling']);
});

test('the latest condition comes with the message that set it', () => {
  const ms = ['my mom slipped on the wet boardwalk and her wrist is swollen', 'can she still carry her pack'];
  assert.equal(latestFor(buildRecord(ms), ms[1]!, 1)?.at, 0);
});
