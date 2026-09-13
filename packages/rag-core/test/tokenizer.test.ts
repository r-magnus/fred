/**
 * Fixtures captured from HuggingFace's own tokenizer via transformers.js.
 *
 * These must match exactly. Embedding depends on token IDs, and a tokenizer that
 * is merely close produces vectors that are merely close — which is how the
 * device and the index ended up in different vector spaces while every piece of
 * metadata agreed (docs/results-m3.md).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildVocab, encode, normalize, preTokenize, wordPiece } from '../src/tokenizer.ts';

const cfg = buildVocab(readFileSync(`${process.env.HOME}/models/gte-small-vocab.txt`, 'utf8'));

/** text => reference input_ids from AutoTokenizer.from_pretrained('Supabase/gte-small') */
const FIXTURES: readonly (readonly [string, readonly number[]])[] = [
  ['control severe external bleeding', [101, 2491, 5729, 6327, 9524, 102]],
  ['How do I control severe external bleeding?',
    [101, 2129, 2079, 1045, 2491, 5729, 6327, 9524, 1029, 102]],
  ['Tension pneumothorax: hyperresonance & tracheal shift (25%)',
    [101, 6980, 1052, 2638, 2819, 29288, 2527, 2595, 1024, 23760, 6072, 7856, 5897,
     1004, 19817, 15395, 2389, 5670, 1006, 2423, 1003, 1007, 102]],
  ['naloxone 0.4mg IV/IM',
    [101, 6583, 4135, 22500, 2063, 1014, 1012, 1018, 24798, 4921, 1013, 10047, 102]],
  ['café Ärzte naïve', [101, 7668, 12098, 2480, 2618, 15743, 102]],
  ['unsplittableverylongtokenizationexample',
    [101, 4895, 13102, 15909, 10880, 27900, 10052, 18715, 18595, 9276, 10288, 16613, 2571, 102]],
  ['  multiple   spaces\tand\nnewlines  ', [101, 3674, 7258, 1998, 2047, 12735, 102]],
  ['ABCDE', [101, 5925, 3207, 102]],
];

test('vocab loads with the expected special token ids', () => {
  assert.equal(cfg.vocab.size, 30522);
  assert.equal(cfg.unkId, 100);
  assert.equal(cfg.clsId, 101);
  assert.equal(cfg.sepId, 102);
});

for (const [text, expected] of FIXTURES) {
  test(`tokenizes ${JSON.stringify(text.slice(0, 42))} exactly`, () => {
    assert.deepEqual(encode(text, cfg), [...expected]);
  });
}

test('accents are stripped and text lowercased', () => {
  assert.equal(normalize('Café ÄRZTE'), 'cafe arzte');
});

test('punctuation is split into separate tokens', () => {
  assert.deepEqual(preTokenize('iv/im, 0.4mg'), ['iv', '/', 'im', ',', '0', '.', '4mg']);
});

test('an over-long word becomes [UNK] rather than being split', () => {
  assert.deepEqual(wordPiece('a'.repeat(101), cfg), [cfg.unkId]);
});

test('encoding is truncated to the context limit, keeping [SEP]', () => {
  // 'bleeding' is one token, so 600 words comfortably exceeds the 512 limit.
  const ids = encode('bleeding '.repeat(600), cfg, 512);
  assert.equal(ids.length, 512);
  assert.equal(ids[0], cfg.clsId);
  assert.equal(ids[511], cfg.sepId, 'the terminator must survive truncation');
});

test('input shorter than the limit is not padded or truncated', () => {
  const ids = encode('bleeding '.repeat(400), cfg, 512);
  assert.equal(ids.length, 402, 'CLS + 400 words + SEP');
});
