import { test } from 'node:test';
import assert from 'node:assert/strict';
import { typeOut } from '../src/type-out.ts';

async function* from(...pieces: string[]): AsyncIterable<string> { for (const p of pieces) yield p; }
const collect = async (s: AsyncIterable<string>): Promise<string[]> => { const out: string[] = []; for await (const x of s) out.push(x); return out; };

test('a card arrives word by word, and the text is unchanged', async () => {
  const card = "Keep them still and calm.\nDon't put ice on it.";
  const out = await collect(typeOut(from(card), { sleep: async () => {} }));
  assert.ok(out.length > 5);
  assert.equal(out.join(''), card);
});

test('model tokens pass straight through', async () => {
  const out = await collect(typeOut(from('Keep', ' them', ' still.'), { sleep: async () => {} }));
  assert.deepEqual(out, ['Keep', ' them', ' still.']);
});

test('a long card is fully shown within the time limit', async () => {
  const pauses: number[] = [];
  const card = Array.from({ length: 300 }, (_, i) => `word${i}`).join(' ');
  await collect(typeOut(from(card), { maxMs: 1500, sleep: async (ms) => { pauses.push(ms); } }));
  assert.ok(pauses.reduce((a, b) => a + b, 0) <= 1500);
});

test('a stop shows the rest of the card at once', async () => {
  const ctrl = new AbortController();
  const card = 'one two three four five six seven eight';
  let n = 0;
  const out = await collect(typeOut(from(card), { signal: ctrl.signal, sleep: async () => { if (++n === 2) ctrl.abort(); } }));
  assert.equal(out.join(''), card);
  assert.equal(out.length, 3);
});
