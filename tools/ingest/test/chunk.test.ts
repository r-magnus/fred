import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkPages, isListHeader, isListItem } from '../src/chunk.ts';

/** One token per whitespace-separated word: enough to drive window boundaries. */
const tokenize = (t: string): number => t.split(/\s+/).filter(Boolean).length;

test('list headers and items are told apart', () => {
  assert.ok(isListHeader('Do not -'));
  assert.ok(isListHeader('4-49. Avoid all of the following:'));
  assert.ok(isListHeader('Examine the eyes for the following:'));
  assert.ok(!isListHeader('- Seek medical aid.'));
  assert.ok(isListItem('\u0083 Make any deep cuts at the bite site.'));
  assert.ok(isListItem('- Seek medical aid.'));
  assert.ok(!isListItem('Do not -'));
});

test('a list split across a window keeps the header that governs it', () => {
  // ATP 3-50.21 p.48 in miniature. Without the header, every item inverts.
  const filler = Array.from({ length: 40 }, (_, i) => `filler line ${i} about snakebite treatment`);
  const page = {
    pageNumber: 48,
    text: [
      ...filler,
      'Do not -',
      '\u0083 Make any deep cuts at the bite site.',
      '\u0083 Put the hands on the face or rub the eyes.',
      '\u0083 Break open the large blisters that form around the bite site.',
    ].join('\n'),
  };
  const chunks = chunkPages([page], {
    targetTokens: 60, overlapTokens: 12, domain: 'first-aid-physical', tokenize,
  });

  const withItems = chunks.filter((c) => c.text.includes('Make any deep cuts'));
  assert.ok(withItems.length > 0, 'the list must appear somewhere');
  for (const c of withItems) {
    assert.ok(c.text.includes('Do not'),
      `a chunk carrying the items must carry their header:\n${c.text}`);
  }
});

test('a chunk opening on a positive list also keeps its header', () => {
  const filler = Array.from({ length: 40 }, (_, i) => `filler line ${i} describing the casualty`);
  const page = {
    pageNumber: 112,
    text: [
      ...filler,
      'Examine the eyes for the following:',
      '- Objects protruding from the eyes.',
      '- Swelling or lacerations of the eyes.',
    ].join('\n'),
  };
  const chunks = chunkPages([page], {
    targetTokens: 60, overlapTokens: 12, domain: 'first-aid-physical', tokenize,
  });
  for (const c of chunks.filter((x) => x.text.includes('Objects protruding'))) {
    assert.ok(c.text.includes('Examine the eyes'), `header missing:\n${c.text}`);
  }
});

test('a chunk not opening inside a list is unchanged', () => {
  const page = { pageNumber: 1, text: 'Plain prose line one.\nPlain prose line two.' };
  const chunks = chunkPages([page], {
    targetTokens: 60, overlapTokens: 12, domain: 'survival', tokenize,
  });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.text, 'Plain prose line one.\nPlain prose line two.');
});
