import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downloadError } from '../src/download-errors.ts';

const native = (tail: string): Error => new Error(`Call to function 'FileSystemDownloadTask.start' has been rejected.\n→ Caused by: Unable to download a file: ${tail}`);

test('a missing file reads as not available, not as the native error (#198)', () => {
  assert.equal(downloadError(native('HTTP 404')).message, 'That download isn’t available right now. Try again later.');
});

test('a server error asks to try again later', () => {
  assert.match(downloadError(native('HTTP 503')).message, /isn’t answering/);
});

test('a dropped connection says what is kept', () => {
  for (const tail of ['java.net.SocketException: Software caused connection abort', 'timeout', 'Unable to resolve host "github.com"']) {
    assert.match(downloadError(native(tail)).message, /Check your connection.*what already arrived is kept/);
  }
});

test('our own messages pass through unchanged', () => {
  assert.equal(downloadError(new Error('Qwen3-1.7B-Q4_K_M.gguf arrived damaged. Try again.')).message, 'Qwen3-1.7B-Q4_K_M.gguf arrived damaged. Try again.');
});
