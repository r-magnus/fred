import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerUnits, checkable, renumbered } from '../src/pipeline.ts';

test('steps are units whole; prose is cut into sentences', () => {
  assert.deepEqual(answerUnits('Happy to help.\n1. Gather dry tinder from under logs. Keep it in your shirt.\n2. Light it low.\n\nStay calm. It will catch.'),
    ['Happy to help.', '1. Gather dry tinder from under logs. Keep it in your shirt.', '2. Light it low.', 'Stay calm.', 'It will catch.']);
});

test('short units and getting help are never judged', () => {
  assert.equal(checkable('2. Light it low.'), false);
  assert.equal(checkable('If he stops breathing, call 911 and start CPR right away.'), false);
  assert.equal(checkable('Avoid using wet or porous materials around the fire to prevent explosions.'), true);
});

test('kept steps are numbered again from 1', () => {
  assert.deepEqual(renumbered(['Intro line.', '1. a', '3. c', '4. d']), ['Intro line.', '1. a', '2. c', '3. d']);
});

import { judgeDraft } from '../src/pipeline.ts';

test('the judge prefers the draft that keeps the source specifics', () => {
  const src = 'The fire should be about 1 meter (3 feet) from the opening of the lean-to.';
  const q = 'how far should the fire be from the opening of my lean-to';
  const specific = judgeDraft('Keep the fire about 3 feet from the opening of the lean-to.', src, q);
  const vague = judgeDraft('Keep the fire at a safe distance to prevent accidental exposure or spread of flames.', src, q);
  assert.ok(specific > vague, `${specific} vs ${vague}`);
});
