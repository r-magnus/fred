/**
 * Fetch the pages behind the health pack (#51): public-domain US Government
 * guidance on the health risks hikers meet.
 *
 *   node tools/ingest/src/health-fetch.ts
 *
 * - CDC pages come through the CDC's content syndication API
 *   (tools.cdc.gov/api/v2), its supported way of republishing its pages.
 *   www.cdc.gov refuses automated requests (HTTP 403), and that refusal is
 *   respected rather than worked around.
 * - EPA, FDA and National Weather Service pages are fetched directly, as
 *   tips-fetch.ts does for NPS.
 *
 * Pages were chosen by topic, from the questions in
 * tools/eval/data/holdout-health.json, before any was read. Cached under
 * corpora/health/ and never refetched; corpora/ is not committed.
 * Everything is fetched once, here: Fred never fetches at run time.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DomainTag } from '@fred/pack-format';

const OUT = 'corpora/health';
const PAUSE_MS = 500;
const USER_AGENT = 'fred-ingest/0.1 (CS-195 academic project; https://github.com/r-magnus/fred)';

export type Publisher = 'cdc' | 'epa' | 'nws' | 'fda';

export interface HealthPage {
  /** A file name. */
  readonly key: string;
  readonly publisher: Publisher;
  /** CDC syndication media id; the others are fetched from `url`. */
  readonly mediaId?: number;
  readonly url?: string;
  readonly domain: DomainTag;
}

const cdc = (key: string, mediaId: number, domain: DomainTag = 'first-aid-physical'): HealthPage => ({ key, publisher: 'cdc', mediaId, domain });

export const HEALTH_PAGES: readonly HealthPage[] = [
  // Ticks and tick-borne disease.
  cdc('ticks-after-a-bite', 123006),
  cdc('ticks-preventing-bites', 123009),
  cdc('ticks-about', 123010),
  cdc('lyme-rashes', 224377),
  cdc('lyme-signs-symptoms', 122747),
  // Heat. (The NIOSH Fast Facts on stinging insects, poisonous plants, heat
  // stress and sun are PDFs: the syndication API returns only an attribution
  // line for them, and the PDFs are behind the same 403. Poisonous plants come
  // from FDA instead; stings stay with the field card and manuals; sun is #116.)
  cdc('niosh-heat-related-illnesses', 382287),
  // Poisonous plants.
  { key: 'fda-poison-ivy', publisher: 'fda', url: 'https://www.fda.gov/consumers/consumer-updates/outsmarting-poison-ivy-and-other-poisonous-plants', domain: 'first-aid-physical' },
  // Mosquitoes.
  cdc('mosquito-borne-diseases-workers', 278653),
  cdc('mosquito-preventing-bites', 730348),
  // Rabies, hantavirus, plague: animals and rodents.
  cdc('rabies-about', 735536),
  cdc('rabies-prevention', 122113),
  cdc('hantavirus-about', 127008),
  cdc('hantavirus-prevention', 217989),
  cdc('plague-preventing', 264238),
  cdc('plague-signs-symptoms', 264240),
  // Water.
  cdc('giardia-about', 223502, 'survival'),
  cdc('harmful-algal-blooms-freshwater-symptoms', 279389, 'survival'),
  { key: 'epa-emergency-disinfection', publisher: 'epa', url: 'https://www.epa.gov/ground-water-and-drinking-water/emergency-disinfection-drinking-water', domain: 'survival' },
  // Heat and cold.
  { key: 'nws-heat-illness', publisher: 'nws', url: 'https://www.weather.gov/safety/heat-illness', domain: 'first-aid-physical' },
  { key: 'nws-cold-during', publisher: 'nws', url: 'https://www.weather.gov/safety/cold-during', domain: 'first-aid-physical' },
];

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

/** What is cached per page: the HTML and where it came from. */
export interface CachedPage {
  readonly title: string;
  readonly sourceUrl: string;
  readonly html: string;
  readonly fetchedAt: string;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const failures: string[] = [];
  for (const p of HEALTH_PAGES) {
    const file = join(OUT, `${p.key}.json`);
    if (existsSync(file)) continue;
    try {
      let page: CachedPage;
      if (p.mediaId !== undefined) {
        const res = JSON.parse(await fetchText(`https://tools.cdc.gov/api/v2/resources/media/${p.mediaId}/syndicate`)) as
          { results: { name: string; sourceUrl: string; content: string } };
        page = { title: res.results.name, sourceUrl: res.results.sourceUrl, html: res.results.content, fetchedAt: new Date().toISOString() };
      } else {
        const html = await fetchText(p.url!);
        const title = (html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? p.key).replace(/\s+/g, ' ').trim();
        page = { title, sourceUrl: p.url!, html, fetchedAt: new Date().toISOString() };
      }
      writeFileSync(file, JSON.stringify(page));
    } catch (e) { failures.push(String(e)); }
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
  const cached = HEALTH_PAGES.filter((p) => existsSync(join(OUT, `${p.key}.json`))).length;
  console.log(`health: ${cached}/${HEALTH_PAGES.length} pages cached`);
  for (const f of failures) console.log(`  failed: ${f}`);
  if (failures.length > 0) process.exitCode = 1;
}

if (import.meta.main) await main();
