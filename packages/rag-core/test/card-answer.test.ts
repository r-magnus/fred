import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchCardLines, parseCard, readPick, renderCard, signsLine } from '../src/card-answer.ts';

// Layout as written by tools/ingest/src/cards.ts cardText.
const CPR = `CPR: not breathing, no pulse
Push hard and fast in the middle of the chest. Babies and small children get fingers, not your whole hand.
1. Lay them on their back on a firm, flat surface.
2. Adult: put the heel of one hand in the center of the chest, with your other hand on top.
3. Baby or small child: use two or three fingers instead of your hand.
4. Push 100 to 120 times a minute.
Don't use the heel of your hand or both hands on a baby or small child.
Call for help before you start if anyone else is there.`;

test('a card parses into summary, steps and the lines after them', () => {
  const c = parseCard(CPR);
  assert.equal(c.title, 'CPR: not breathing, no pulse');
  assert.match(c.summary, /^Push hard/);
  assert.equal(c.steps.length, 4);
  assert.deepEqual(c.rest, [
    "Don't use the heel of your hand or both hands on a baby or small child.",
    'Call for help before you start if anyone else is there.',
  ]);
});

test('a picked subset keeps the summary, every don\'t and the get-help line', () => {
  const out = renderCard(parseCard(CPR), [0, 2, 3]);
  assert.doesNotMatch(out, /Adult: put the heel/);
  assert.match(out, /^Push hard/);
  assert.match(out, /1\. Lay them.*\n2\. Baby or small child.*\n3\. Push 100/s);
  assert.match(out, /Don't use the heel of your hand/);
  assert.match(out, /Call for help/);
});

test('with no pick, every step is shown', () => {
  assert.match(renderCard(parseCard(CPR), []), /Adult: put the heel/);
});

test('pick replies are read leniently and bounded to the card', () => {
  assert.deepEqual(readPick('1, 3, 4', 4), [0, 2, 3]);
  assert.deepEqual(readPick('Steps 3 and 1. Also 9.', 4), [0, 2]);
  assert.deepEqual(readPick('none', 4), []);
});

const HEAD = `Head injury or concussion
Anyone who hits their head hard should be watched closely.
1. After a hard knock to the head, treat it as a possible neck or spine injury too.
2. Watch for signs of a concussion or worse: headache, nausea, confusion.
3. Ask simple questions: who they are, where they are, what day it is.
Clear fluid or blood from the nose or ears are emergencies.`;

test('a question about what to watch for gets the card\'s signs line (#112)', () => {
  const card = parseCard(HEAD);
  assert.equal(signsLine(card), 1);
  // The question is closest to the neck line and the emergency line, as the
  // whole message "hit their head on a rock... what should I watch for" was.
  const q = new Float32Array([1, 0, 0, 0]);
  const rows = [[100, 10, 0, 0], [60, 0, 80, 0], [0, 0, 0, 100], [95, 0, 0, 30]].map((r) => Int8Array.from(r));
  assert.deepEqual(matchCardLines(q, card, rows), [0, 3]);
  assert.deepEqual(matchCardLines(q, card, rows, 'my friend hit their head. what should i watch for?'), [0, 1]);
  assert.deepEqual(matchCardLines(q, card, rows, 'can he keep hiking'), [0, 3]);
  // Nothing close enough: no lines, signs or not.
  assert.deepEqual(matchCardLines(new Float32Array([0, 1, 0, 0]), card, rows, 'what are the signs'), []);
});
