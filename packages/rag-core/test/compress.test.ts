import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChunkRecord } from '@fred/pack-format';
import {
  compressContext, estimateTokens, looksLikeProcedure, splitSentences, DEFAULT_COMPRESSION,
} from '../src/compress.ts';
import { extractKeywords } from '../src/lexicon.ts';

const countTokens = (t: string) => t.split(/\s+/).filter(Boolean).length;
const opts = { ...DEFAULT_COMPRESSION, countTokens };

function chunk(over: Partial<ChunkRecord> & { text: string }): ChunkRecord {
  return {
    id: 'p:0', packId: 'p', ordinal: 0, section: 's', source: 'src', page: 1,
    domain: 'first-aid-physical', licenseId: 'who-bec', blockKind: 'prose',
    ...over,
  };
}

const PROCEDURE = `Control of severe external bleeding.
1. Apply firm direct pressure to the wound with a clean cloth.
2. Maintain pressure for at least ten minutes without lifting.
3. If bleeding continues, apply a tourniquet above the wound.
4. Record the time the tourniquet was applied.
5. Do not loosen the tourniquet once it is in place.`;

test('a procedure chunk is never broken up', () => {
  const c = chunk({ text: PROCEDURE, blockKind: 'procedure' });
  const res = compressContext([c], extractKeywords('how do I stop bleeding'), opts);
  for (const step of ['1.', '2.', '3.', '4.', '5.']) {
    assert.ok(res.chunks[0]!.text.includes(step), `step ${step} was dropped`);
  }
  assert.equal(res.perChunk[0]!.atomic, true);
  assert.equal(res.perChunk[0]!.sentencesKept, res.perChunk[0]!.sentencesTotal);
});

test('a mislabelled procedure is still protected by the runtime check', () => {
  // blockKind says 'prose' — an ingest bug. looksLikeProcedure must catch it.
  const c = chunk({ text: PROCEDURE, blockKind: 'prose' });
  const res = compressContext([c], extractKeywords('unrelated mushroom foraging query'), opts);
  assert.equal(res.perChunk[0]!.atomic, true, 'runtime safety net did not fire');
  assert.ok(res.chunks[0]!.text.includes('5.'), 'final step lost');
});

test('prose is compressed toward the 20-40% target band', () => {
  const prose = chunk({
    text: [
      'Shock is a state of inadequate tissue perfusion.',
      'The manual was revised in 2018 by a working group.',
      'Printing was funded by a partner organisation.',
      'Recognise shock by cool clammy skin and a weak fast pulse.',
      'The cover photograph was taken in a training session.',
      'Translations exist in several languages.',
      'Lay the patient flat and raise the legs if there is no spinal injury.',
    ].join(' '),
  });
  const res = compressContext([prose], extractKeywords('how do I recognise shock'), opts);
  assert.ok(res.reduction >= 0.2, `reduction ${res.reduction} below target floor`);
  assert.ok(res.reduction <= 0.4 + 1e-9, `reduction ${res.reduction} exceeded cap`);
  assert.ok(res.chunks[0]!.text.includes('Shock is a state'), 'topic sentence must be pinned');
});

test('the opening sentence is always kept and a chunk is never emptied', () => {
  const c = chunk({ text: 'Topic sentence here. Filler one. Filler two. Filler three.' });
  const res = compressContext([c], extractKeywords('completely unrelated query terms'), opts);
  assert.ok(res.chunks[0]!.text.startsWith('Topic sentence here.'));
  assert.ok(res.chunks[0]!.text.length > 0);
  assert.ok(res.perChunk[0]!.sentencesKept >= 1);
});

test('reduction may fall short when context is mostly atomic, and reports honestly', () => {
  const res = compressContext(
    [chunk({ text: PROCEDURE, blockKind: 'procedure' })],
    extractKeywords('bleeding'),
    opts,
  );
  assert.equal(res.reduction, 0, 'atomic content must not be trimmed');
  assert.equal(res.tokensAfter, res.tokensBefore);
});

test('empty input does not divide by zero', () => {
  const res = compressContext([], extractKeywords('anything'), opts);
  assert.equal(res.reduction, 0);
  assert.equal(res.tokensBefore, 0);
});

test('sentence splitting handles abbreviations and newlines', () => {
  assert.deepEqual(splitSentences('Use e.g. a cloth. Then press.'), ['Use e.g. a cloth.', 'Then press.']);
  assert.equal(splitSentences('One\nTwo\nThree').length, 3);
});

test('looksLikeProcedure distinguishes steps from description', () => {
  assert.ok(looksLikeProcedure('1) Open airway\n2) Check breathing'));
  assert.ok(looksLikeProcedure('- a\n- b\n- c'));
  assert.ok(!looksLikeProcedure('Hypothermia occurs when core temperature falls below 35 C.'));
});

test('estimateTokens is a usable fallback when no tokenizer exists', () => {
  assert.ok(estimateTokens('a'.repeat(400)) === 100);
});
