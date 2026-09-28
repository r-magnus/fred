import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCard, pickChoice, renderCardSteps } from '../src/card-answer.ts';

const BURN = [
  { label: 'Red, no blisters', words: ['no blister', 'not blister', 'without blister', 'just red', 'only red', 'first degree', 'first-degree'] },
  { label: 'Blistered', words: ['blister', 'second degree', 'second-degree'] },
  { label: 'White, leathery or charred', words: ['charred', 'leathery', 'white', 'third degree', 'third-degree'] },
];

test('a message that already answers picks that answer', () => {
  assert.equal(pickChoice(BURN, 'I grabbed a hot pot and my palm is blistering'), 1);
  assert.equal(pickChoice(BURN, "it's just red and stings"), 0);
  assert.equal(pickChoice(BURN, 'there are no blisters'), 0);
  assert.equal(pickChoice(BURN, 'the skin looks charred'), 2);
});

test('negated, vague or mixed messages ask instead', () => {
  assert.equal(pickChoice(BURN, 'how do I treat a burn?'), null);
  assert.equal(pickChoice(BURN, "it isn't charred"), null);
  assert.equal(pickChoice(BURN, 'some parts blistered, some charred'), null);
});

test('steps render in the chosen order, safety lines kept', () => {
  const card = parseCard('Stings\nSummary.\n1. Bee step.\n2. Wash.\n3. Ants: move away first.\nDon\'t squeeze.\nGet help if breathing is hard.');
  assert.equal(renderCardSteps(card, [3, 2]),
    "Summary.\n1. Ants: move away first.\n2. Wash.\nDon't squeeze.\nGet help if breathing is hard.");
});
