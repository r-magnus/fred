import { test } from 'node:test';
import assert from 'node:assert/strict';
import { npsArticle, pageChunks, sections, wikivoyageLicense } from '../src/tips-pack.ts';

const words = (t: string): number => t.split(/\s+/).length;
const pad = (s: string): string => `${s} ${'More useful words about this topic here. '.repeat(3)}`;

test('NPS: dropping a heading does not drop the article after it', () => {
  // "Contact Us" is an h2 and the article's own headings are h3s after it.
  const html = `<h2>Tags</h2><p>hiking safety</p><h3>Pack a trowel</h3><p>${pad('Dig a cathole six inches deep.')}</p>`;
  const secs = sections(html, new Set(['tags']), false);
  assert.deepEqual(secs.map((s) => s.path.join(' > ')), ['Tags > Pack a trowel']);
});

test('Wikivoyage: dropping a heading drops its subsections, until the next heading at its level', () => {
  const html = '<h2>Destinations</h2><p>Go to Peru.</p><h3>Peru</h3><p>Nice.</p><h2>Sleep</h2><p>Pick a flat site.</p>';
  const secs = sections(html, new Set(['destinations']), true);
  assert.deepEqual(secs.map((s) => s.path.join(' > ')), ['Sleep']);
});

test('Wikivoyage: drop-own removes a section but keeps what is under it', () => {
  const html = '<h3>Ticks</h3><p>Lyme disease is treated with antibiotics.</p><h4>How to prevent tick bites</h4><p>Tuck pants into socks.</p>';
  const secs = sections(html, new Set(), true, new Set(['ticks']));
  assert.deepEqual(secs.map((s) => s.path.join(' > ')), ['Ticks > How to prevent tick bites']);
});

test('NPS: photos, captions, the contact heading and the LNT copyright line are removed', () => {
  const page = `<title>Dispose of Waste (U.S. National Park Service)</title><div id="main">
    <h2>Contact Us</h2><h1>Dispose of Waste</h1>
    <figure><img src="x.jpg"><figcaption>Photo courtesy of Leave No Trace</figcaption></figure>
    <p>${pad('Walk 200 feet from water before you dig.')}</p>
    <p>Leave No Trace 7 Principles © 1999 by the Leave No Trace Center for Outdoor Ethics</p>
    <footer>site footer</footer></div>`;
  const { title, html } = npsArticle(page);
  assert.equal(title, 'Dispose of Waste');
  const chunks = pageChunks(title, sections(html, new Set(), false), words);
  const all = chunks.map((c) => c.text).join('\n');
  assert.match(all, /Walk 200 feet/);
  assert.doesNotMatch(all, /courtesy|©|Contact Us|footer/);
  assert.equal(chunks[0]?.domain, 'outdoor-skills');
});

test('Wikivoyage chunks carry a per-article licence pinned to the revision', () => {
  const lic = wikivoyageLicense({ title: 'Wild camping', revid: 42, url: 'https://en.wikivoyage.org/w/index.php?title=Wild_camping&oldid=42' });
  assert.equal(lic.id, 'wikivoyage:Wild_camping');
  assert.equal(lic.license, 'CC-BY-SA-4.0');
  assert.match(lic.attribution, /Wikivoyage contributors/);
  assert.match(lic.sourceUrl, /oldid=42/);
  const chunks = pageChunks('Wild camping', [{ path: ['Sleep'], body: pad('Choose a flat site away from water.') }], words, lic.id);
  assert.equal(chunks[0]?.licenseId, 'wikivoyage:Wild_camping');
});
