import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseHeadings, parseStates, type FeisReview } from '../src/feis-fetch.ts';
import { feisSections, reviewChunks } from '../src/feis-pack.ts';

const words = (t: string): number => t.split(/\s+/).filter(Boolean).length;

test('the FEIS index CSV keeps quoted commas and escaped quotes inside fields', () => {
  const rows = parseCsv('Abbreviation,"Common Title"\nTOXSPP,"eastern poison-ivy, western poison-ivy"\nX,"say ""hi"""\n');
  assert.deepEqual(rows, [
    ['Abbreviation', 'Common Title'],
    ['TOXSPP', 'eastern poison-ivy, western poison-ivy'],
    ['X', 'say "hi"'],
  ]);
});

test('state lists are read from current reviews, whose heading is wrapped in <strong>', () => {
  // Anchoring the match to the heading markup missed exactly this, for 420 reviews.
  const html = '<h3><strong>States and Provinces</strong></h3><ul><li data-x="1">United States: AK CA OR WA</li>' +
    '<li>Canada: BC</li></ul><h2>Site Characteristics</h2><p>Maritime climate.</p>';
  assert.deepEqual(parseStates(html), ['AK', 'CA', 'OR', 'WA']);
});

test('state lists are read from older reviews titled "States", ignoring trailing citations', () => {
  assert.deepEqual(parseStates('<h3>States</h3><p>United States: CA [61]</p><h2>Site Characteristics</h2>'), ['CA']);
});

test('a review with only prose distribution yields no states rather than a guess', () => {
  const html = '<header><p>An official website of the United States government</p></header>' +
    '<h2>General Distribution</h2><p>Found in New York, Virginia, and Colorado [1,9].</p>';
  assert.deepEqual(parseStates(html), []);
});

test('headings are extracted as plain text', () => {
  assert.deepEqual(parseHeadings('<h2>Taxonomy</h2><h4><strong>Botanical and Ecological Characteristics</strong></h4>'),
    ['Taxonomy', 'Botanical and Ecological Characteristics']);
});

test('section bodies drop inline citations', () => {
  const s = feisSections('<h2>Botanical Description</h2><p>A many-stemmed shrub [29,30,32]. Leaflets in threes [4].</p><h2>Next</h2>');
  assert.equal(s.get('Botanical Description'), 'A many-stemmed shrub. Leaflets in threes.');
});

const review = (headings: readonly string[]): FeisReview => ({
  id: 'toxdiv', common: 'Pacific poison-oak', scientific: 'Toxicodendron diversilobum', year: 1994,
  url: 'https://example.invalid', states: ['CA'], headings,
});

test('plant reviews keep identification and safety sections and drop fire ecology', () => {
  const body = 'This sentence has enough words in it to clear the stub threshold for a section body.';
  const html = `<h3>Other Common Names</h3><p>Pacific poison oak</p>
    <h2>General Distribution</h2><p>${body}</p>
    <h2>Botanical Description</h2><p>${body}</p>
    <h2>Immediate Fire Effects</h2><p>Fire top-kills it. ${body}</p>
    <h2>Other Management Considerations</h2><p>Safety/Medical: urushiol. ${body}</p>
    <h2>Federal Status</h2><p>None</p>`;
  const chunks = reviewChunks(review(['Botanical and Ecological Characteristics']), html, words);

  assert.deepEqual(chunks.map((c) => c.section), [
    'Pacific poison-oak > General Distribution',
    'Pacific poison-oak > Botanical Description',
    'Pacific poison-oak > Other Management Considerations',
  ]);
  assert.ok(chunks.every((c) => c.domain === 'plants' && c.page === null));
  assert.ok(chunks.every((c) => c.text.startsWith('Pacific poison-oak (Toxicodendron diversilobum) — ')),
    'every chunk names its species; a mid-review chunk without the name cannot be retrieved by it');
  assert.ok(!chunks.some((c) => /Fire top-kills/.test(c.text)));
  assert.match(chunks[0]!.text, /Also called: Pacific poison oak\./);
});

test('animal reviews are tagged wildlife and keep diet and habitat', () => {
  const body = 'Mountain lions feed primarily on large ungulates such as deer and elk across their range.';
  const html = `<h2>Diet</h2><p>${body}</p><h2>Fire Effects on Habitat</h2><p>${body}</p><h2>Preferred Habitat</h2><p>${body}</p>`;
  const chunks = reviewChunks({ ...review(['Biological Characteristics and Habitat']), common: 'mountain lion', scientific: 'Puma concolor' }, html, words);
  assert.deepEqual(chunks.map((c) => c.section), ['mountain lion > Diet', 'mountain lion > Preferred Habitat']);
  assert.ok(chunks.every((c) => c.domain === 'wildlife'));
});

test('long sections split on sentence boundaries under the token target', () => {
  const sentence = Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ') + '.';
  const html = `<h2>Botanical Description</h2><p>${Array.from({ length: 20 }, () => `Leaf ${sentence}`).join(' ')}</p>`;
  const chunks = reviewChunks(review(['Botanical and Ecological Characteristics']), html, words);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => words(c.text) <= 280 + 41), 'a window may exceed the target by at most one sentence');
  assert.ok(chunks.every((c) => c.text.trimEnd().endsWith('.')), 'no window ends mid-sentence');
});
