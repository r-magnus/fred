import { test } from 'node:test';
import assert from 'node:assert/strict';
import { containsGold, goldWindows, normalise, prohibitionPhrases } from '../src/gold.ts';

test('normalise drops case and punctuation', () => {
  assert.equal(normalise('Do NOT - massage,  the skin.'), 'do not massage the skin');
});

test('a short quote is one window', () => {
  assert.deepEqual(goldWindows('Apply firm pressure'), ['apply firm pressure']);
  assert.deepEqual(goldWindows('  '), []);
});

test('a long quote yields overlapping six-word windows', () => {
  const w = goldWindows('one two three four five six seven eight nine ten');
  assert.deepEqual(w, [
    'one two three four five six',
    'four five six seven eight nine',
  ]);
});

test('a quote split across a chunk boundary is still found', () => {
  const quote = 'To treat immersion foot, gradually warm the affected area by exposing it to warm air. Do not massage or moisten the skin.';
  const chunkTail = 'and blistering may occur. To treat immersion foot, gradually warm the affected area';
  assert.ok(containsGold(chunkTail, goldWindows(quote)));
});

test('unrelated text is not a match', () => {
  const quote = 'Tannic acid can be made from oak bark and used on plant-caused rashes.';
  assert.equal(containsGold('Scorpion venomous pincers or fangs located on their first pair of legs.', goldWindows(quote)), false);
});

test('an empty quote never matches', () => {
  assert.equal(containsGold('anything at all', []), false);
});

test('prohibition phrases survive a line wrap and carry the words they govern', () => {
  assert.deepEqual(
    prohibitionPhrases('warm air. Do not\nmassage or moisten the skin. Never leave them alone.'),
    ['do not massage or', 'never leave them'],
  );
});
