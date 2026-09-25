import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCard, readPick, renderCard } from '../src/card-answer.ts';

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
