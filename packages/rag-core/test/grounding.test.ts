import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numberChecked, numbersIn, unsourcedNumbers } from '../src/grounding.ts';
import { quotableSentences, truncateVector } from '../src/sentences.ts';

async function* from(...t: string[]): AsyncIterable<string> { for (const x of t) yield x; }
const all = async (s: AsyncIterable<string>): Promise<string> => { let o = ''; for await (const x of s) o += x; return o; };

test('numbers are read in digits and words, commas dropped', () => {
  assert.deepEqual(numbersIn('At altitudes above 5,000 feet, boil water for three minutes.').sort(), ['3', '5000']);
});

test('a number the sources lack is unsourced; list markers are not claims', () => {
  const src = new Set(numbersIn('Black spruce is a small tree, 5 to 15 m tall.'));
  assert.deepEqual(unsourcedNumbers('It reaches heights of 30 to 60 meters.', src), ['30', '60']);
  assert.deepEqual(unsourcedNumbers('2. It grows 5 to 15 m tall.', src), []);
});

test('an answer streams unchanged when its numbers have sources', async () => {
  const out = await all(numberChecked(from('Boil it ', 'for 1 minute.', ' Then cool it.'), 'boil for 1 minute', async () => 'X'));
  assert.equal(out, 'Boil it for 1 minute. Then cool it.');
});

test('a wrong number is never shown: the rest is replaced', async () => {
  const out = await all(numberChecked(from('Black spruce ', 'reaches ', '30 to 60 meters.', ' It grows in bogs.'), 'a small tree 5 to 15 m tall',
    async (shown) => (shown ? '\nFrom the source:\nQUOTE' : 'QUOTE')));
  assert.ok(!out.includes('30'));
  assert.match(out, /From the source:\nQUOTE$/);
});

test('quotable sentences skip the heading and split list items', () => {
  assert.deepEqual(quotableSentences('Bison — Stay away\n- Stay at least 25 yards away from bison.\nRun away if a bison charges. It can run fast too.'),
    ['Stay at least 25 yards away from bison.', 'Run away if a bison charges.', 'It can run fast too.'.length >= 25 ? 'It can run fast too.' : ''].filter((x) => x !== ''));
});

test('a truncated vector has unit length', () => {
  const v = truncateVector(new Float32Array(Array.from({ length: 768 }, (_, i) => (i % 7) - 3)));
  assert.equal(v.length, 256);
  assert.ok(Math.abs(v.reduce((a, x) => a + x * x, 0) - 1) < 1e-5);
});

test('species passages from the asked-about section go first; others keep their place', async () => {
  const { speciesSectionOrder } = await import('../src/species.ts');
  const c = (id: string, packId: string, section: string) => ({ chunk: { id, packId, section } } as never);
  const cs = [c('a', 'state-CO', 'elk > Preferred Habitat'), c('m', 'core-survival', 'X'), c('b', 'state-CO', 'elk > Biological Characteristics')];
  const out = speciesSectionOrder(cs, 'when is the elk rut', new Set(['state-CO'])) as unknown as { chunk: { id: string } }[];
  assert.deepEqual(out.map((x) => x.chunk.id), ['b', 'm', 'a']);
});
