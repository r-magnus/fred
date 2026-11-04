import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GREETINGS } from '../src/words.ts';

test('every greeting has its own short line under it', () => {
  for (const g of GREETINGS) {
    assert.ok(g.line.length > 0 && g.more.length > 0, g.line);
    // Two lines on a phone at most, and a full sentence.
    assert.ok(g.more.length <= 90, `${g.line}: ${g.more.length} chars`);
    assert.match(g.more, /[.?!]$/);
  }
  assert.equal(new Set(GREETINGS.map((g) => g.line)).size, GREETINGS.length);
  assert.equal(new Set(GREETINGS.map((g) => g.more)).size, GREETINGS.length);
});
