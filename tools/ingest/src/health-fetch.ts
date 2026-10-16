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
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DomainTag } from '@fred/pack-format';
import { extractPdf } from './pdf.ts';
import { tmpdir } from 'node:os';

const OUT = 'corpora/health';
const PAUSE_MS = 500;
const USER_AGENT = 'fred-ingest/0.1 (CS-195 academic project; https://github.com/r-magnus/fred)';

export type Publisher = 'cdc' | 'epa' | 'nws' | 'fda' | 'nih' | 'nps' | 'blm' | 'usfs' | 'army';

export interface HealthPage {
  /** A file name. */
  readonly key: string;
  readonly publisher: Publisher;
  /** CDC syndication media id; the others are fetched from `url`. */
  readonly mediaId?: number;
  readonly url?: string;
  /** A PDF: its text is extracted, and its capitalised question lines become headings. */
  readonly pdf?: boolean;
  /** The pack it goes in: the health pack unless said (#115's hazards pack). */
  readonly pack?: 'core-hazards';
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
  // Bloom water: CDC's backcountry page says filters and boiling don't remove
  // the toxins, but it is behind the 403; without that line the model told a
  // hiker to boil scum-covered lake water (health set, #51). EPA's FAQ says it.
  { key: 'epa-hab-faq', publisher: 'epa', pdf: true, url: 'https://www.epa.gov/sites/default/files/2016-11/documents/harmful_algal_blooms_and_cyanotoxins_frequently_asked_questions.pdf', domain: 'survival' },
  { key: 'epa-emergency-disinfection', publisher: 'epa', url: 'https://www.epa.gov/ground-water-and-drinking-water/emergency-disinfection-drinking-water', domain: 'survival' },
  // Common trail ailments (#116): diarrhea and rehydration, handwashing,
  // sun, sore and injured knees. Chosen from tools/eval/data/holdout-ailments.json
  // before any was read.
  { key: 'niddk-diarrhea', publisher: 'nih', url: 'https://www.niddk.nih.gov/health-information/digestive-diseases/diarrhea', domain: 'first-aid-physical' },
  { key: 'niddk-diarrhea-symptoms', publisher: 'nih', url: 'https://www.niddk.nih.gov/health-information/digestive-diseases/diarrhea/symptoms-causes', domain: 'first-aid-physical' },
  { key: 'niddk-diarrhea-treatment', publisher: 'nih', url: 'https://www.niddk.nih.gov/health-information/digestive-diseases/diarrhea/treatment', domain: 'first-aid-physical' },
  cdc('norovirus-prevention', 402715),
  { key: 'fda-sun-tips', publisher: 'fda', url: 'https://www.fda.gov/consumers/consumer-updates/tips-stay-safe-sun-sunscreen-sunglasses', domain: 'first-aid-physical' },
  { key: 'fda-sunscreen', publisher: 'fda', url: 'https://www.fda.gov/drugs/understanding-over-counter-medicines/sunscreen-how-help-protect-your-skin-sun', domain: 'first-aid-physical' },
  { key: 'epa-sun-safety', publisher: 'epa', url: 'https://www.epa.gov/sunsafety/action-steps-sun-safety', domain: 'first-aid-physical' },
  { key: 'niams-sports-injuries', publisher: 'nih', url: 'https://www.niams.nih.gov/health-topics/sports-injuries', domain: 'first-aid-physical' },
  { key: 'niams-sports-injuries-treatment', publisher: 'nih', url: 'https://www.niams.nih.gov/health-topics/sports-injuries/diagnosis-treatment-and-steps-to-take', domain: 'first-aid-physical' },
  // Heat and cold.
  { key: 'nws-heat-illness', publisher: 'nws', url: 'https://www.weather.gov/safety/heat-illness', domain: 'first-aid-physical' },
  { key: 'nws-cold-during', publisher: 'nws', url: 'https://www.weather.gov/safety/cold-during', domain: 'first-aid-physical' },
  // Weather and terrain hazards (#115), packed as core-hazards: lightning,
  // flash floods, rivers, wildfire. Chosen from tools/eval/data/
  // holdout-hazards.json's topics before any was read; everything here is
  // what to do on the spot, with no signal.
  { key: 'nws-lightning-safety', publisher: 'nws', pack: 'core-hazards', url: 'https://www.weather.gov/safety/lightning-safety', domain: 'survival' },
  { key: 'nws-lightning-outdoors', publisher: 'nws', pack: 'core-hazards', url: 'https://www.weather.gov/safety/lightning-outdoors', domain: 'survival' },
  { key: 'nws-lightning-struck', publisher: 'nws', pack: 'core-hazards', url: 'https://www.weather.gov/safety/lightning-struck', domain: 'first-aid-physical' },
  { key: 'nws-lightning-tips', publisher: 'nws', pack: 'core-hazards', url: 'https://www.weather.gov/safety/lightning-tips', domain: 'survival' },
  // The only NWS page that says a victim is safe to touch (#115).
  { key: 'nws-lightning-myths', publisher: 'nws', pack: 'core-hazards', url: 'https://www.weather.gov/safety/lightning-myths', domain: 'first-aid-physical' },
  // NWS's backcountry lightning sheet (a PDF) was tried: its columns extract
  // as run-together words, and the web pages carry the same advice.
  { key: 'nws-flood-turn-around', publisher: 'nws', pack: 'core-hazards', url: 'https://www.weather.gov/safety/flood-turn-around-dont-drown', domain: 'survival' },
  { key: 'nws-flood-during', publisher: 'nws', pack: 'core-hazards', url: 'https://www.weather.gov/safety/flood-during', domain: 'survival' },
  { key: 'blm-flash-floods', publisher: 'blm', pack: 'core-hazards', url: 'https://www.blm.gov/flash-floods-tread-safely', domain: 'survival' },
  { key: 'nps-zion-flash-flood', publisher: 'nps', pack: 'core-hazards', url: 'https://www.nps.gov/zion/planyourvisit/flash-flood.htm', domain: 'survival' },
  { key: 'nps-river-crossings', publisher: 'nps', pack: 'core-hazards', url: 'https://www.nps.gov/articles/safe-river-crossings.htm', domain: 'survival' },
  { key: 'nps-wildland-fire-visitors', publisher: 'nps', pack: 'core-hazards', url: 'https://www.nps.gov/subjects/fire/wildland-fire-safety-for-park-visitors.htm', domain: 'survival' },
  { key: 'nws-wildfire', publisher: 'nws', pack: 'core-hazards', url: 'https://www.weather.gov/safety/wildfire', domain: 'survival' },
  { key: 'usfs-fire', publisher: 'usfs', pack: 'core-hazards', url: 'https://www.fs.usda.gov/visit/know-before-you-go/fire', domain: 'survival' },
  { key: 'usfs-superior-stay-safe', publisher: 'usfs', pack: 'core-hazards', url: 'https://www.fs.usda.gov/r09/superior/safety-ethics/stay-safe', domain: 'survival' },
  { key: 'usfs-burned-areas', publisher: 'usfs', pack: 'core-hazards', url: 'https://www.fs.usda.gov/r06/fire/management/safety-burned-areas', domain: 'survival' },
  // #100: thunder on a ridge found nothing to answer from. The NWS Blacksburg
  // office's outdoor page (ridges, water, lone trees). Left out: NPS Grand
  // Canyon's lightning page, which still teaches the crouch NWS dropped in
  // 2008, and the AirNow and EPA smoke pages, written for people at home
  // (clean-air rooms, choosing a respirator): for "the smoke is so thick
  // it's hard to breathe" the answer became how to fit an N95.
  { key: 'nws-rnk-outdoors-lightning', publisher: 'nws', pack: 'core-hazards', url: 'https://www.weather.gov/rnk/outdoorslightning', domain: 'survival' },
  // #100: a hiker who sees a wildfire, for the wildfire card: what to do when
  // caught in the open or in the backcountry (Fort Huachuca's fire prevention
  // office, army.mil). Left out: NIOSH's wildfire-smoke page for outdoor
  // workers, written for employers; "the smoke is so thick it's hard to
  // breathe", a danger sign, was answered with "Require and encourage workers
  // to take frequent breaks".
  { key: 'army-wildfire-survival', publisher: 'army', pack: 'core-hazards', url: 'https://www.army.mil/article/125204/Prepare_for_wildfire_survival_now/', domain: 'survival' },
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

/** A run of capitalised lines, the first ending in nothing and the last in "?" or not. */
const CAPS = /^[A-Z0-9 ,'’()&/-]{6,}\??$/;

/** The first capitalised heading, in title case: the document's own name. */
function pdfTitle(text: string): string {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => CAPS.test(l) && l !== 'FREQUENTLY ASKED QUESTIONS');
  const head: string[] = [];
  for (const l of lines) { head.push(l); if (l.endsWith('?')) break; }
  const t = head.join(' ').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Capitalised question lines become h3 headings; the rest becomes paragraphs. */
function pdfHtml(text: string): string {
  const out: string[] = [];
  let head: string[] = [];
  let para: string[] = [];
  const flushPara = (): void => { if (para.length > 0) out.push(`<p>${para.join(' ')}</p>`); para = []; };
  for (const raw of text.split('\n')) {
    const l = raw.trim();
    if (l === '' || l === 'FREQUENTLY ASKED QUESTIONS' || /^EPA: \d/.test(l)) continue;
    if (CAPS.test(l)) {
      flushPara();
      head.push(l);
      if (l.endsWith('?')) { out.push(`<h3>${head.join(' ')}</h3>`); head = []; }
      continue;
    }
    if (head.length > 0) { out.push(`<h3>${head.join(' ')}</h3>`); head = []; }
    para.push(l);
  }
  flushPara();
  return out.join('\n');
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
      } else if (p.pdf === true) {
        const res = await fetch(p.url!, { headers: { 'user-agent': USER_AGENT } });
        if (!res.ok) throw new Error(`${p.url}: HTTP ${res.status}`);
        const tmp = join(tmpdir(), `${p.key}.pdf`);
        writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
        const pages = await extractPdf(tmp);
        rmSync(tmp);
        page = { title: pdfTitle(pages.map((x) => x.text).join('\n')), sourceUrl: p.url!, html: pdfHtml(pages.map((x) => x.text).join('\n')), fetchedAt: new Date().toISOString() };
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
