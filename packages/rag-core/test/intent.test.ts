import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { InferenceBackend, GenerateOptions } from '../src/backends.ts';
import type { PromptParts } from '../src/prompt.ts';
import { classifyIntent, readIntent } from '../src/intent.ts';

/** A backend whose model always answers with one word. */
const says = (word: string): InferenceBackend => ({
  embed: async () => new Float32Array(1),
  embeddingSpec: () => { throw new Error('unused'); },
  countTokens: async (t: readonly string[]) => t.map(() => 1),
  async *generate(_p: PromptParts, _o: GenerateOptions) { yield word; },
} as unknown as InferenceBackend);

test('the model word is read, and anything unreadable counts as a question', () => {
  assert.equal(readIntent(' NOW'), 'now');
  assert.equal(readIntent('chat.'), 'chat');
  assert.equal(readIntent('hmm'), 'question');
});

test('prevention wording skips the model', async () => {
  // The model called all six practice prevention questions QUESTION.
  for (const m of ['How can I avoid getting bitten by a snake?', 'Any tips to keep ticks off me?', 'what should I bring for a long day?']) {
    assert.equal(await classifyIntent(m, says('NOW')), 'prevent', m);
  }
});

test('a message that asks something is never small talk', async () => {
  // On the tuning set the model called "how can I find north without a
  // compass?" and "what does poison oak look like?" CHAT.
  assert.equal(await classifyIntent('How can I find north without a compass?', says('CHAT')), 'question');
  assert.equal(await classifyIntent('what does poison oak look like', says('CHAT')), 'question');
  assert.equal(await classifyIntent('the sunset tonight was great', says('CHAT')), 'chat');
});
