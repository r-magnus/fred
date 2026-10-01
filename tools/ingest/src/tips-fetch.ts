/**
 * Fetch the pages behind the tips packs (#96, docs/plan-tips.md).
 *
 *   node tools/ingest/src/tips-fetch.ts
 *
 * Two sources, kept apart because their licences differ (docs/licensing.md):
 *
 * - National Park Service articles on nps.gov: public domain as US Government
 *   work. Only national pages, not park-specific ones; which park pages go
 *   into state packs is a later decision.
 * - Wikivoyage travel topics: CC BY-SA 4.0. Fetched through the MediaWiki API
 *   with the revision id, so every chunk can credit the exact version it
 *   quotes.
 *
 * Wikivoyage is volunteer-written and unreviewed, so it is kept to everyday
 * know-how. Topics where bad advice injures people (dangerous animals, altitude
 * sickness, foraging, severe weather, wildfires) are deliberately not fetched;
 * NPS and the existing manuals cover them.
 *
 * Pages are cached under corpora/tips/ and never refetched, like feis-fetch.ts.
 * corpora/ is not committed.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'corpora/tips';
const PAUSE_MS = 500;
/** Wikimedia rejects API requests without a contactable user agent. */
const USER_AGENT = 'fred-ingest/0.1 (CS-195 academic project; https://github.com/r-magnus/fred)';

/** National NPS pages, chosen by topic before any was read. */
export const NPS_PAGES: readonly string[] = [
  'https://www.nps.gov/articles/hiking-safety.htm',
  'https://www.nps.gov/articles/10essentials.htm',
  'https://www.nps.gov/subjects/trails/hiking-safety.htm',
  'https://www.nps.gov/articles/hikingetiquette.htm',
  'https://www.nps.gov/articles/lightning-safety.htm',
  'https://www.nps.gov/subjects/bears/storingfood.htm',
  'https://www.nps.gov/articles/bearsafetyfood.htm',
  'https://www.nps.gov/subjects/bears/safety.htm',
  'https://www.nps.gov/articles/hiking-in-bear-country.htm',
  'https://www.nps.gov/articles/bearfindsme.htm',
  'https://www.nps.gov/articles/000/idkt_bears.htm',
  'https://www.nps.gov/subjects/watchingwildlife/7ways.htm',
  'https://www.nps.gov/subjects/watchingwildlife/people.htm',
  'https://www.nps.gov/subjects/camping/how-to-camp.htm',
  'https://www.nps.gov/subjects/camping/camp-etiquette.htm',
  'https://www.nps.gov/subjects/camping/before-the-trip.htm',
  'https://www.nps.gov/subjects/camping/staying-safe.htm',
  'https://www.nps.gov/subjects/camping/during-your-stay.htm',
  'https://www.nps.gov/articles/camp-safety-before-the-trip.htm',
  'https://www.nps.gov/articles/camp-safety-during-your-stay.htm',
  'https://www.nps.gov/articles/000/idkt_lnt.htm',
];

/** The "I Didn't Know That! Leave No Trace" series: every article it links to is fetched. */
const NPS_SERIES = ['https://www.nps.gov/articles/series.htm?id=15F149A6-E1D5-8735-B46C4ABC0A2B8EDF'];

export const WIKIVOYAGE_PAGES: readonly string[] = [
  'Wilderness backpacking', 'Hiking', 'Camping', 'Wild camping', 'Leave-no-trace camping',
  'Camping food', 'Outdoor cooking', 'Cold weather', 'Hot weather', 'Arid region safety',
  'Pests', 'Orienteering',
];

export interface WikivoyagePage {
  readonly title: string;
  readonly revid: number;
  readonly url: string;
  readonly html: string;
}

/** A file name for an NPS URL: the path, flattened. */
export const npsSlug = (url: string): string =>
  new URL(url).pathname.replace(/^\/|\.htm$/g, '').replace(/[^a-z0-9]+/gi, '_');

async function fetchText(url: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (attempt >= 3) throw new Error(`${url}: ${e instanceof Error ? e.message : String(e)}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

const pause = (): Promise<void> => new Promise((r) => setTimeout(r, PAUSE_MS));

/** Article links in an NPS series page, absolute and deduplicated. */
export function seriesLinks(html: string): string[] {
  const links = [...html.matchAll(/href="((?:https:\/\/www\.nps\.gov)?\/articles\/[^"#?]+\.htm)"/g)]
    .map((m) => new URL(m[1]!, 'https://www.nps.gov').href);
  return [...new Set(links)];
}

async function main(): Promise<void> {
  const npsDir = join(OUT, 'nps');
  const wvDir = join(OUT, 'wikivoyage');
  mkdirSync(npsDir, { recursive: true });
  mkdirSync(wvDir, { recursive: true });

  const nps = [...NPS_PAGES];
  for (const s of NPS_SERIES) {
    const links = seriesLinks(await fetchText(s)).filter((l) => l.includes('idkt'));
    console.log(`series ${s}: ${links.length} articles`);
    nps.push(...links);
    await pause();
  }
  const failures: string[] = [];
  const npsUrls = [...new Set(nps)];
  for (const url of npsUrls) {
    const file = join(npsDir, `${npsSlug(url)}.html`);
    if (existsSync(file)) continue;
    try { writeFileSync(file, await fetchText(url)); } catch (e) { failures.push(String(e)); }
    await pause();
  }
  writeFileSync(join(npsDir, 'urls.json'), JSON.stringify(npsUrls, null, 1));

  for (const title of WIKIVOYAGE_PAGES) {
    const file = join(wvDir, `${title.replace(/[^a-z0-9]+/gi, '_')}.json`);
    if (existsSync(file)) continue;
    try {
      const api = `https://en.wikivoyage.org/w/api.php?action=parse&format=json&formatversion=2&redirects=1&prop=text|revid&disableeditsection=1&page=${encodeURIComponent(title)}`;
      const res = JSON.parse(await fetchText(api)) as { parse?: { title: string; revid: number; text: string } };
      if (res.parse === undefined) throw new Error(`${title}: no parse result`);
      const page: WikivoyagePage = {
        title: res.parse.title,
        revid: res.parse.revid,
        url: `https://en.wikivoyage.org/w/index.php?title=${encodeURIComponent(res.parse.title.replace(/ /g, '_'))}&oldid=${res.parse.revid}`,
        html: res.parse.text,
      };
      writeFileSync(file, JSON.stringify(page));
    } catch (e) { failures.push(String(e)); }
    await pause();
  }

  const npsCount = npsUrls.filter((u) => existsSync(join(npsDir, `${npsSlug(u)}.html`))).length;
  console.log(`NPS: ${npsCount}/${npsUrls.length} pages cached; Wikivoyage: ${WIKIVOYAGE_PAGES.length} topics`);
  for (const f of failures) console.log(`  failed: ${f}`);
  if (failures.length > 0) process.exitCode = 1;
}

if (import.meta.main) await main();

