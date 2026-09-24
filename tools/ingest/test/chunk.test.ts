import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkByStructure, chunkPages, isListHeader, isListItem } from '../src/chunk.ts';

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

const OPTS = { targetTokens: 60, overlapTokens: 0, domain: 'first-aid-physical' as const, tokenize };

test('structure chunks start at numbered paragraphs, not mid-sentence', () => {
  const page = {
    pageNumber: 139,
    text: [
      'FRACTURES',
      '13-29. Locate the site of the suspected fracture by asking the casualty where',
      'it hurts and looking for swelling, deformity or an open wound over the bone.',
      '13-30. Remove jewelry from the injured limb, because if swelling occurs later',
      'the rings cannot be removed and the circulation may be cut off below them.',
      '13-31. Gather splinting materials. If none are available improvise them from',
      'sticks, boards or rolled newspaper, and pad them where they touch the body.',
    ].join('\n'),
  };
  const chunks = chunkByStructure([page], OPTS);
  assert.ok(chunks.length >= 2, 'three 30-word paragraphs do not fit one 60-token chunk');
  for (const c of chunks) {
    assert.match(c.text, /^(FRACTURES\n)?13-\d\d\. /, `chunk opens mid-paragraph:\n${c.text}`);
  }
});

test('a negated list stays with its header, even when split', () => {
  const items = Array.from({ length: 12 }, (_, i) => `\u0083 Forbidden action number ${i} at the bite site.`);
  const page = { pageNumber: 48, text: ['SNAKEBITES', 'Do not -', ...items].join('\n') };
  const chunks = chunkByStructure([page], { ...OPTS, targetTokens: 30 });
  const withItems = chunks.filter((c) => c.text.includes('Forbidden action'));
  assert.ok(withItems.length > 1, 'the list is long enough to need splitting');
  for (const c of withItems) assert.ok(c.text.includes('Do not -'), `lost its header:\n${c.text}`);
});

test('figure captions are dropped and chunks never span a heading', () => {
  const page = {
    pageNumber: 5,
    text: ['BURNS', 'Cool the burn with clean water.', 'Figure 13-15. Board splint applied to the forearm', 'BLEEDING', 'Press on the wound.'].join('\n'),
  };
  const chunks = chunkByStructure([page], { ...OPTS, targetTokens: 500 });
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((c) => !c.text.includes('Figure 13-15')));
  assert.deepEqual(chunks.map((c) => c.section), ['BURNS', 'BLEEDING']);
});
