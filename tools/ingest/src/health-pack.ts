/**
 * The health pack (#51): public-domain US Government guidance on the health
 * risks hikers meet: ticks and Lyme disease, rabies, hantavirus, plague,
 * mosquitoes, poisonous plants, heat and cold illness, and making water safe.
 *
 *   node tools/ingest/src/health-fetch.ts           # once: fetch and cache pages
 *   node tools/ingest/src/health-pack.ts --dump     # cleaned chunks to corpora/health/, no embedding
 *   node tools/ingest/src/health-pack.ts
 *
 * Every page is a US Government work (CDC, EPA, FDA, NWS), so the pack is
 * public domain; each chunk credits its own publisher. Sections that point
 * elsewhere (resources, related pages, data) are dropped, as are clinical
 * sections meant for doctors (diagnosis, testing, treatment regimens): Fred
 * refers those, it does not teach them.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LicenseEntry } from '@fred/pack-format';
import type { DraftChunk } from './chunk.ts';
import { contextualize } from './contextualize.ts';
import { documentText, EMBEDDING_GEMMA, loadGgufEmbedder } from './gguf-embed.ts';
import { HEALTH_PAGES, type CachedPage, type HealthPage, type Publisher } from './health-fetch.ts';
import { writePack } from './pack.ts';
import { pageChunks, sections } from './tips-pack.ts';

const DIR = 'corpora/health';

const PUBLISHERS: Record<Publisher, { source: string; license: LicenseEntry }> = {
  cdc: {
    source: 'CDC',
    license: {
      id: 'cdc', license: 'Public domain (US Government work)',
      sourceTitle: 'US Centers for Disease Control and Prevention, through the CDC content syndication service',
      sourceUrl: 'https://tools.cdc.gov/medialibrary/index.aspx#/usageguidelines/info',
      attribution: 'Content provided and maintained by the US Centers for Disease Control and Prevention (CDC).',
      nonCommercial: false,
    },
  },
  epa: {
    source: 'EPA',
    license: {
      id: 'epa', license: 'Public domain (US Government work)', sourceTitle: 'US Environmental Protection Agency (epa.gov)',
      sourceUrl: 'https://www.epa.gov/web-policies-and-procedures/epa-disclaimers',
      attribution: 'US Environmental Protection Agency, epa.gov.', nonCommercial: false,
    },
  },
  fda: {
    source: 'FDA',
    license: {
      id: 'fda', license: 'Public domain (US Government work)', sourceTitle: 'US Food and Drug Administration (fda.gov)',
      sourceUrl: 'https://www.fda.gov/about-fda/about-website/website-policies',
      attribution: 'US Food and Drug Administration, fda.gov.', nonCommercial: false,
    },
  },
  nws: {
    source: 'National Weather Service',
    license: {
      id: 'nws', license: 'Public domain (US Government work)', sourceTitle: 'National Weather Service (weather.gov)',
      sourceUrl: 'https://www.weather.gov/disclaimer',
      attribution: 'National Weather Service, NOAA, weather.gov.', nonCommercial: false,
    },
  },
};

/** Headings never kept: pointers elsewhere, and clinical material for doctors. */
const DROP = new Set([
  'resources', 'related resources', 'more information', 'additional resources', 'related pages', 'sources',
  'keep reading', 'learn more', 'for more information', 'related links', 'more resources', 'additional water guidance',
  'featured', 'products', 'topics', 'information for', 'content current as of:', 'regulated product(s)', 'health topic(s)',
  'discover.', 'connect.', 'ask.', 'follow.', 'ground water and drinking water', 'on this page',
  'diagnosis and testing', 'testing and diagnosis', 'treatment', 'treatment and recovery', 'for healthcare providers',
  'data and statistics', 'surveillance', 'what cdc is doing', 'clinical overview',
  // EPA's bloom FAQ is about tap water: its advisory levels, dialysis and
  // utilities are not a hiker's; boiling, health effects and animals are kept.
  'what are health advisories?', 'what are the health advisories for cyanotoxins?', '10-day health advisories level',
  'why are there different health advisories for the two population groups?',
  'why do older children have different health advisory levels than younger children?',
  'what happens if you exceed the', 'value, what happens if you exceed for a smaller number of days?',
  'what do the green, yellow and red advisory levels of cyanotoxins mean?', 'advisory level actionaction advisory level',
  'which advisory level should sensitive populations or nursing mothers follow?', 'can dialysis be impacted by cyanotoxins?',
  'what is my public water system doing to address harmful algal blooms or cyanotoxins?',
  'where can i find more information about harmful algal blooms and cyanotoxins?',
  'what can we do to help prevent cyanotoxins from occurring in my drinking water sources?',
  'if a drinking water advisory is issued, is the tap water safe for other uses other than drinking?',
  // Home and workplace advice, not a hiker's.
  'reducing risk of tick exposure around homes', 'employer recommendations', 'staying safe during power outages',
]);

/** NWS's program banner and breadcrumb, which survive as text across their tags. */
const NAV_TEXT = /Safety National Program Weather\.gov > Safety > [^\n]*?(?= [A-Z][a-z]+ [a-z])|Safety National Program|(?:Heat|Cold) Safety Resources|Cold Resources/g;

/** The part of a cached page that is the article itself. */
function body(page: CachedPage, publisher: Publisher): string {
  let h = page.html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/g, ' ');
  const between = (start: string, end: RegExp): void => {
    const s = h.indexOf(start);
    if (s >= 0) h = h.slice(s);
    const e = h.search(end);
    if (e > 0) h = h.slice(0, e);
  };
  if (publisher === 'epa' || publisher === 'fda') between('<main', /<\/main>|Content current as of/);
  if (publisher === 'nws') between('<div class="div-full">', /<div[^>]*class="footer/);
  return h
    .replace(/<div id="cdcAttribution"[\s\S]*?<\/div>/g, ' ')
    .replace(/<figure[\s\S]*?<\/figure>/g, ' ')
    .replace(/<h1[\s\S]*?<\/h1>/g, ' ')
    // Expand/collapse controls on NWS headings ("+Watch for Frostbite").
    .replace(/<span class="control">[^<]*<\/span>/g, '')
    // Site navigation: EPA's breadcrumb heading and trail, NWS's program banner.
    .replace(/<h2[^>]*>\s*Breadcrumb\s*<\/h2>/g, ' ')
    .replace(/<nav[\s\S]*?<\/nav>|<ol[^>]*breadcrumb[\s\S]*?<\/ol>/g, ' ')
    .replace(/Safety National Program|Weather\.gov &gt; Safety &gt; [^<]*|(?:Heat|Cold) Safety Resources|Cold Resources|Información relacionada disponible en español/g, ' ');
}

export function healthChunks(count: (t: string) => number, pages: readonly HealthPage[] = HEALTH_PAGES): DraftChunk[] {
  return pages.flatMap((p) => {
    const cached = JSON.parse(readFileSync(join(DIR, `${p.key}.json`), 'utf8')) as CachedPage;
    const title = cached.title.replace(/<[^>]+>/g, '').replace(/(?:\s*\|\s*(?:US EPA|FDA|CDC|Rabies))+\s*$/, '').replace(/\s+/g, ' ').trim();
    const pub = PUBLISHERS[p.publisher];
    // A short answer can be the whole point: "No, boiling water will not
    // remove cyanotoxins and may increase toxin levels." is 76 characters.
    return pageChunks(title, sections(body(cached, p.publisher), DROP, true), count, pub.license.id, 40)
      .map((c) => ({ ...c, text: c.text.replace(NAV_TEXT, ' ').replace(/ {2,}/g, ' '), domain: p.domain, source: pub.source }));
  });
}

async function main(): Promise<void> {
  if (process.argv.includes('--dump')) {
    const count = (t: string): number => Math.ceil(t.split(/\s+/).length * 1.3);
    mkdirSync(DIR, { recursive: true });
    const chunks = healthChunks(count);
    writeFileSync(join(DIR, 'chunks.json'), JSON.stringify(chunks, null, 1));
    console.log(`health: ${chunks.length} chunks -> ${join(DIR, 'chunks.json')}`);
    return;
  }
  const embedder = await loadGgufEmbedder(EMBEDDING_GEMMA);
  let chunks = healthChunks((t) => embedder.tokenCount(t));
  // CONTEXTUALIZE=1: a one-line lead-in per passage, written by the local
  // model (contextualize.ts), so a hiker's everyday words ("a raccoon bit my
  // kid") can reach the agencies' clinical ones ("post-exposure prophylaxis").
  // Written by a model rather than by hand, so no phrasing comes from whoever
  // wrote the test questions.
  if (process.env.CONTEXTUALIZE === '1') {
    const contexts = await contextualize(chunks, {
      modelPath: process.env.GEN_MODEL ?? `${process.env.HOME}/models/Qwen3-1.7B-Q4_K_M.gguf`,
      documentTitle: 'US Government health guidance for people outdoors',
    });
    chunks = chunks.map((c, i) => ({ ...c, context: contexts[i] ?? '' }));
  }
  const vectors = await embedder.embed(chunks.map((c) =>
    documentText(EMBEDDING_GEMMA, c.section, c.context === undefined || c.context === '' ? c.text : `${c.context}\n${c.text}`)));
  const { dir, manifest } = await writePack(process.env.PACKS_OUT ?? 'packs', {
    id: 'core-health', version: '1.0.0', displayName: 'Health Risks Outdoors',
    description: 'Public-domain US Government guidance (CDC, EPA, FDA, National Weather Service): ticks and Lyme disease, rabies, hantavirus, plague, mosquitoes, poisonous plants, heat and cold illness, safe drinking water.',
    domains: ['first-aid-physical', 'survival'], scope: { kind: 'global' }, source: 'CDC',
    licenseId: PUBLISHERS.cdc.license.id, licenses: Object.values(PUBLISHERS).map((p) => p.license), embedding: embedder.spec,
  }, chunks, vectors);
  const mb = manifest.files.reduce((s, f) => s + f.bytes, 0) / 1024 / 1024;
  console.log(`wrote ${dir}: ${manifest.chunkCount} chunks, ${mb.toFixed(2)} MB`);
  await embedder.dispose();
}

if (import.meta.main) await main();
