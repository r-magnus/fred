import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BACKED_UP, notBackedUp } from '../src/backup-list.ts';

test('downloads are kept out of backup, the hiker\'s own files are not', () => {
  const names = [
    'Qwen3-1.7B-Q4_K_M.gguf', 'embeddinggemma-300M-Q8_0.gguf', 'packs',
    'map-CA-z14.pmtiles', 'map-US-overview.pmtiles', 'contours-CA.pmtiles', 'coverage-CA-voice.bin', 'regions-CA.json',
    'map-CA-z14.pmtiles.partial', 'map-TX-z14.pmtiles.part000',
    'chats.json', 'feedback-outbox.json', 'usage.json', 'setup.json', 'agreement.json', 'theme.json', 'carrier.json', 'energy.json',
    'devhooks', 'devhooks-setup',
  ];
  assert.deepEqual(notBackedUp(names), [
    'Qwen3-1.7B-Q4_K_M.gguf', 'embeddinggemma-300M-Q8_0.gguf', 'packs',
    'map-CA-z14.pmtiles', 'map-US-overview.pmtiles', 'contours-CA.pmtiles', 'coverage-CA-voice.bin', 'regions-CA.json',
    'map-CA-z14.pmtiles.partial', 'map-TX-z14.pmtiles.part000',
  ]);
});

test('a new kind of file is kept out unless listed', () => {
  assert.deepEqual(notBackedUp(['something-new.bin']), ['something-new.bin']);
  assert.equal(BACKED_UP.has('something-new.bin'), false);
});
