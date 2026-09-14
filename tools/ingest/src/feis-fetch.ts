/**
 * Fetch the USFS Fire Effects Information System (FEIS) species reviews.
 *
 *   node tools/ingest/src/feis-fetch.ts
 *
 * FEIS is the text source for the per-state flora and fauna packs
 * (docs/licensing.md): ~1,100 peer-reviewed species reviews, public domain as US
 * Government work. Each review states where the species occurs as a structured
 * "States and Provinces" line ("United States: CA OR WA"), which is what makes a
 * per-state pack possible without joining a second database.
 *
 * Pages are cached under corpora/feis/html/ and never refetched, so the crawl is
 * resumable and a rebuild does not touch the network. corpora/ is not committed.
 * Requests run a few at a time with a pause between them; this is a public
 * research site, not a CDN.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://research.fs.usda.gov/feis/species-reviews';
const OUT = 'corpora/feis';
const HTML = join(OUT, 'html');
const CONCURRENCY = 3;
const PAUSE_MS = 250;

export interface FeisReview {
  /** Lowercase FEIS abbreviation, e.g. "toxdiv". Also the URL slug. */
  readonly id: string;
  readonly common: string;
  readonly scientific: string;
  readonly year: number;
  readonly url: string;
  /** USPS codes from "States and Provinces". Empty if the review gives none. */
  readonly states: readonly string[];
  /** Section headings, used downstream to tell plant reviews from animal reviews. */
  readonly headings: readonly string[];
}

/** RFC 4180-ish: quoted fields may contain commas; doubled quotes escape. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  return rows;
}

const stripTags = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

export function parseHeadings(html: string): string[] {
  return [...html.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/g)]
    .map((m) => stripTags(m[1] ?? ''))
    .filter((h) => h !== '');
}

/**
 * USPS codes from a review's structured state list.
 *
 * Matched on stripped text, not markup: the heading is wrapped as
 * `<h3><strong>States and Provinces</strong></h3>`, and a regex anchored to the
 * heading tag silently found nothing for 420 reviews. Older reviews title the
 * same list "States". Some older reviews have no list at all, only prose; those
 * return empty rather than guessing from place names.
 */
export function parseStates(html: string): string[] {
  const m = stripTags(html).match(/\bStates(?: and Provinces)?\s+United States:\s*((?:[A-Z]{2}\b[\s,]*)+)/);
  return m ? [...new Set(m[1]!.match(/[A-Z]{2}/g) ?? [])] : [];
}

async function fetchText(url: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'fred-ingest (CS-195 academic project)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (attempt >= 3) throw new Error(`${url}: ${e instanceof Error ? e.message : String(e)}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

async function main(): Promise<void> {
  mkdirSync(HTML, { recursive: true });
  const indexPath = join(OUT, 'index.csv');
  if (!existsSync(indexPath)) writeFileSync(indexPath, await fetchText(`${BASE}/download`));
  const [header, ...rows] = parseCsv(readFileSync(indexPath, 'utf8'));
  if (header?.[0] !== 'Abbreviation') throw new Error(`unexpected FEIS index header: ${header?.join(',')}`);

  const entries = rows.map(([abbr, common, scientific, year, url]) => ({
    id: (abbr ?? '').toLowerCase(), common: common ?? '', scientific: scientific ?? '',
    year: Number(year), url: url ?? '',
  }));
  const todo = entries.filter((e) => !existsSync(join(HTML, `${e.id}.html`)));
  console.log(`${entries.length} reviews in index, ${entries.length - todo.length} cached, fetching ${todo.length}`);

  let done = 0;
  const failures: string[] = [];
  const worker = async (): Promise<void> => {
    for (let e = todo.shift(); e; e = todo.shift()) {
      try {
        writeFileSync(join(HTML, `${e.id}.html`), await fetchText(e.url));
      } catch (err) {
        failures.push(err instanceof Error ? err.message : String(err));
      }
      if (++done % 100 === 0) console.log(`  ${done} fetched`);
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const reviews: FeisReview[] = entries
    .filter((e) => existsSync(join(HTML, `${e.id}.html`)))
    .map((e) => {
      const html = readFileSync(join(HTML, `${e.id}.html`), 'utf8');
      return { ...e, states: parseStates(html), headings: parseHeadings(html) };
    });
  writeFileSync(join(OUT, 'reviews.json'), JSON.stringify(reviews, null, 1));

  const noStates = reviews.filter((r) => r.states.length === 0).length;
  console.log(`wrote ${join(OUT, 'reviews.json')}: ${reviews.length} reviews, ${noStates} without a state list`);
  for (const s of ['CA', 'OR']) console.log(`  ${s}: ${reviews.filter((r) => r.states.includes(s)).length} species`);
  if (failures.length > 0) {
    console.log(`${failures.length} failed:`);
    for (const f of failures) console.log(`  ${f}`);
  }
}

if (import.meta.main) await main();
