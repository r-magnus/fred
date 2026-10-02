import { test } from 'node:test';
import assert from 'node:assert/strict';
import { typeOut } from '../src/type-out.ts';

async function* from(...pieces: string[]): AsyncIterable<string> { for (const p of pieces) yield p; }
const collect = async (s: AsyncIterable<string>): Promise<string[]> => { const out: string[] = []; for await (const x of s) out.push(x); return out; };

test('a card arrives word by word, and the text is unchanged', async () => {
  const card = "Keep them still and calm.\nDon't put ice on it.";
  let t = 0;
  const out = await collect(typeOut(from(card), { now: () => t, sleep: async () => { t += 33; } }));
  assert.ok(out.length > 5);
  assert.equal(out.join(''), card);
});

test('model tokens pass straight through', async () => {
  const out = await collect(typeOut(from('Keep', ' them', ' still.'), { sleep: async () => {} }));
  assert.deepEqual(out, ['Keep', ' them', ' still.']);
});

test('a long card is fully shown within the time limit, even when ticks run late', async () => {
  let t = 0;
  const card = Array.from({ length: 300 }, (_, i) => `word${i}`).join(' ');
  // Every tick takes 100 ms instead of 33, as a busy phone might.
  const out = await collect(typeOut(from(card), { maxMs: 1500, now: () => t, sleep: async () => { t += 100; } }));
  assert.equal(out.join(''), card);
  assert.ok(t <= 1600, `took ${t} ms`);
});

test('a stop shows the rest of the card at once', async () => {
  const ctrl = new AbortController();
  const card = 'one two three four five six seven eight';
  let t = 0;
  const out = await collect(typeOut(from(card), { signal: ctrl.signal, perWordMs: 100, now: () => t,
    sleep: async () => { t += 10; if (t === 20) ctrl.abort(); } }));
  assert.equal(out.join(''), card);
  assert.equal(out.length, 3);
});
