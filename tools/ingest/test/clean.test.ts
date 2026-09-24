import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripMnemonicPrefixes } from '../src/clean.ts';

test('RICE letter prefixes are stripped from list items', () => {
  assert.equal(
    stripMnemonicPrefixes('RICE as defined -\n- R-Rest injured area.\n- C-Compression-wrap or splint to help stabilize.'),
    'RICE as defined -\n- Rest injured area.\n- Compression-wrap or splint to help stabilize.',
  );
});

test('ordinary hyphenated words and non-list text are left alone', () => {
  assert.equal(stripMnemonicPrefixes('- X-ray the limb.'), '- X-ray the limb.');
  assert.equal(stripMnemonicPrefixes('A self-aid step R-Rest'), 'A self-aid step R-Rest');
});
