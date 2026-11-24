import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readChoices, topicName, topicsOf } from '../src/ask-back.ts';

test('topic names read as plain words (#286)', () => {
  assert.equal(topicName('Hiking > Stay healthy'), 'Stay healthy (Hiking)');
  assert.equal(topicName('PLANTS'), 'Plants');
  assert.equal(topicName('[see ABCDE, DIB]'), 'see ABCDE, DIB');
  assert.equal(topicName('AND'), undefined);
  assert.deepEqual(topicsOf(['PLANTS', 'PLANTS', 'Eating wild plants and berries']), ['Plants', 'Eating wild plants and berries']);
});

test('keeps short on-subject questions, in order (#286)', () => {
  assert.deepEqual(
    readChoices('How do I treat diarrhea on the trail? | How do I stay healthy on a long hike?', 'can i keep hiking if i have the runs', []),
    ['How do I treat diarrhea on the trail?', 'How do I stay healthy on a long hike?'],
  );
  assert.deepEqual(
    readChoices('How do I treat a sore knee on the trail? | How do I wrap a knee?', 'my knees kill me going downhill', []),
    ['How do I treat a sore knee on the trail?', 'How do I wrap a knee?'],
  );
});

test('drops facts, numbers, repeats of the message and NONE (#286)', () => {
  assert.deepEqual(readChoices('NONE', 'which stock should i buy', []), []);
  assert.deepEqual(readChoices('How many 200 mg ibuprofen for a knee?', 'my knee hurts', []), []);
  assert.deepEqual(readChoices('You should always rest your knee?', 'my knee hurts', []), []);
  assert.deepEqual(readChoices('my knee hurts?', 'my knee hurts', []), []);
  assert.deepEqual(readChoices('How do I know if salmonberries are safe to feed? | Are salmonberries edible?', 'birds eat salmonberries', []), []);
  assert.deepEqual(readChoices('How do I identify edible wild plants in Vermont?', 'is sheep sorrel safe to eat', []), ['How do I identify edible wild plants in Vermont?']);
});

test('reads past a repeated prompt and drops a cut-off choice (#286)', () => {
  assert.deepEqual(
    readChoices('Hiker: "boots" GUIDE TOPICS: Wear (Wilderness backpacking) -> How do I choose boots that last? | What makes boots wear', 'which boots last', []),
    ['How do I choose boots that last?'],
  );
  assert.deepEqual(readChoices('Guide Topics: Heat rash; Sun  \n| How do I treat a sunburn? | What can I do to prevent heat rash?', 'sunburn', []),
    ['How do I treat a sunburn?', 'What can I do to prevent heat rash?']);
});

