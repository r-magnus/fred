import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streamChecked } from '../src/pipeline.ts';
import { conditionsIn, violatedCondition } from '../src/conditions.ts';

const snake = conditionsIn(['my friend got bit by a snake']);
async function* tokens(text: string): AsyncGenerator<string> {
  for (const t of text.match(/.{1,3}/gs) ?? []) yield t;
}
const run = async (text: string, holds = false): Promise<{ out: string[]; replaced: boolean }> => {
  let replaced = false;
  const out: string[] = [];
  for await (const piece of streamChecked(tokens(text), {
    violates: (s) => violatedCondition(s, snake),
    holdsFirst: (s) => holds && /don't have reliable/i.test(s),
    replace: async (_by, shownAlready) => { replaced = true; return `${shownAlready ? '\n\n' : ''}SNAKEBITE CARD`; },
    // As guardCard: only a reply that is wholly the refusal is replaced (isRefusal).
    whole: async (t) => (t.trim() === "I don't have reliable information on that." ? 'SNAKEBITE CARD' : t),
  })) out.push(piece);
  return { out, replaced };
};

test('a passing answer streams sentence by sentence, list numbers included', async () => {
  const { out, replaced } = await run('1. Keep him still and calm.\n2. Take off his rings.\n3. Get medical help right away.');
  assert.equal(replaced, false);
  assert.equal(out.join(''), '1. Keep him still and calm.\n2. Take off his rings.\n3. Get medical help right away.');
  assert.ok(out.length >= 3, `streamed in ${out.length} pieces`);
});

test('a forbidden sentence is never shown; the card follows what passed', async () => {
  const { out, replaced } = await run('1. Do not wrap it tight with ice.\n2. Apply cold compresses to reduce swelling.\n3. Keep it raised.');
  assert.equal(replaced, true);
  const shown = out.join('');
  assert.ok(!/cold compress/i.test(shown), shown);
  assert.ok(shown.startsWith('1. Do not wrap it tight with ice.'), shown);
  assert.ok(shown.endsWith('SNAKEBITE CARD'), shown);
});

test('a forbidden first sentence shows only the card', async () => {
  const { out } = await run('Put ice on the bite right away. Then rest.');
  assert.equal(out.join(''), 'SNAKEBITE CARD');
});

test('a refusal that is the whole answer is decided on the whole text', async () => {
  assert.equal((await run("I don't have reliable information on that.", true)).out.join(''), 'SNAKEBITE CARD');
  assert.equal((await run("I don't have reliable information on that. But keep him still.", true)).out.join(''),
    "I don't have reliable information on that. But keep him still.");
});
