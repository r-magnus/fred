import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numberChecked, numbersIn, unsourcedNumbers } from '../src/grounding.ts';
import { quotableSentences, rankSentences, truncateVector } from '../src/sentences.ts';

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

test('a wrong number is never shown: first sentence replaced, a later one dropped', async () => {
  const first = await all(numberChecked(from('Black spruce reaches ', '30 to 60 meters.', ' It grows in bogs.'), 'a small tree 5 to 15 m tall',
    async (shown) => (shown ? '\nFrom the source:\nQUOTE' : 'QUOTE')));
  assert.equal(first, 'Black spruce reaches \nFrom the source:\nQUOTE');
  const later = await all(numberChecked(from('It grows in bogs.', ' 30 to 60 meters tall.', ' Cones are small.'), 'bogs', async () => 'QUOTE'));
  assert.ok(!later.includes('30'));
  assert.match(later, /It grows in bogs\..*Cones are small\./);
});

test('a conversion in parentheses is not checked; the number before it is', () => {
  const src = new Set(numbersIn('At 68 °F you need 2 to 3 quarts.'));
  assert.deepEqual(unsourcedNumbers('At 68° F (20° C) you need 2 to 3 quarts.', src), []);
});

test('product picks and forecasts are never quoted in place of a decline', async () => {
  const { NOT_FREDS_JOB } = await import('../src/grounding.ts');
  for (const q of ['whats the best tent to buy for next time', 'which brand of water filter is best', 'Is that thunderhead going to reach me before dark?', 'will it snow tonight up at the pass'])
    assert.ok(NOT_FREDS_JOB.test(q), q);
  for (const q of ['how close can i get to elk for a good photo', 'the thunder stopped, how long before we keep hiking up', 'is it ok to walk up to the bison for a selfie'])
    assert.ok(!NOT_FREDS_JOB.test(q), q);
});

test('quotable sentences skip the heading and split list items', () => {
  assert.deepEqual(quotableSentences('Bison — Stay away\n- Stay at least 25 yards away from bison.\nRun away if a bison charges. It can run fast too.'),
    ['Stay at least 25 yards away from bison.', 'Run away if a bison charges.', 'It can run fast too.'.length >= 25 ? 'It can run fast too.' : ''].filter((x) => x !== ''));
});

test('a quote is the short paragraph a row sits in, or its whole sentence, never a cut line (#23)', () => {
  const para = "3-12. Use fresh, clean snow as a water source. Adding water to snow will help it melt faster. Avoid directly\neating snow as it lowers the body's core temperature and requires the body to use more energy reserves than\nif the snow is heated externally.";
  const long = `3-13. ${'Isolated persons can construct a water machine that will produce water from snow. '.repeat(5)}Place snow on any porous\nmaterial and hang it near a fire.`;
  const text = `RAIN, SNOW, AND ICE\n${para}\n${long}\n- Melt it in a container near the fire.`;
  const lines = quotableSentences(text);
  const q = new Float32Array(768); q[0] = 1;
  const shown = (starts: string): string => {
    const hit = lines.findIndex((l) => l.startsWith(starts));
    assert.ok(hit >= 0, starts);
    const rows = lines.map((_, i) => { const r = new Int8Array(256); r[i === hit ? 0 : 1] = 100; return r; });
    return rankSentences(q, [{ chunkId: 'c', text, rows }])[0]!.text;
  };
  // A short paragraph is quoted whole, without its number, and with the words the line break cut off.
  assert.equal(shown('eating snow'), "Use fresh, clean snow as a water source. Adding water to snow will help it melt faster. Avoid directly eating snow as it lowers the body's core temperature and requires the body to use more energy reserves than if the snow is heated externally.");
  // In a long paragraph, only the sentence.
  assert.equal(shown('material and hang'), 'Place snow on any porous material and hang it near a fire.');
  // A list item is its own paragraph, without the bullet.
  assert.equal(shown('Melt it in'), 'Melt it in a container near the fire.');
});

test('a truncated vector has unit length', () => {
  const v = truncateVector(new Float32Array(Array.from({ length: 768 }, (_, i) => (i % 7) - 3)));
  assert.equal(v.length, 256);
  assert.ok(Math.abs(v.reduce((a, x) => a + x * x, 0) - 1) < 1e-5);
});

test('list markers are neither sentences nor claims (#126)', async () => {
  const out = await all(numberChecked(from('1.', ' Use DEET', ' on skin.', '\n2.', ' Wear long sleeves.'), 'use DEET', async () => 'REPLACED'));
  assert.equal(out, '1. Use DEET on skin.\n2. Wear long sleeves.');
});

test('digits joined to letters are names, not numbers (#126)', () => {
  assert.deepEqual(numbersIn('Use DEET, picaridin or IR3535; an N95 mask.'), []);
  assert.deepEqual(numbersIn('wait 30 minutes'), ['30']);
});

test('a list marker is released at once, not held with its sentence (#128)', async () => {
  const seen: string[] = [];
  for await (const t of numberChecked(from('1', '.', ' Use', ' DEET.'), 'DEET', async () => 'X')) seen.push(t);
  assert.deepEqual(seen.slice(0, 2), ['1.', ' Use']);
});

test('a quote is introduced by who said it (#135)', async () => {
  const { quoteIntro } = await import('../src/grounding.ts');
  assert.equal(quoteIntro(['National Park Service — Bison Safety']), "Here's what the National Park Service says:");
  assert.equal(quoteIntro(['ATP 3-50.21 Survival 2018', 'FM 21-76 Survival 1992']), "Here's what the Army survival manual says:");
  assert.equal(quoteIntro(['CDC — Ticks', 'National Park Service — Ticks']), "Here's what my guides say:");
  assert.equal(quoteIntro(['Some new source']), "Here's what my guides say:");
  assert.equal(quoteIntro(['Wikivoyage — Desert travel']), "Here's what Wikivoyage says:");
});
