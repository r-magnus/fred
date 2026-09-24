/**
 * Per-state flora and fauna packs from cached FEIS species reviews.
 *
 *   node tools/ingest/src/feis-fetch.ts     # once: fetch and cache reviews
 *   node tools/ingest/src/feis-pack.ts CA OR
 *
 * One pack per state, holding every FEIS species whose structured state list
 * includes it. The pack serves both 'plants' and 'wildlife'; each chunk carries
 * its own domain, so retrieve()'s chunk-domain filter keeps a plant question on
 * plant reviews.
 *
 * FEIS is a fire-ecology database. Most of a review is fire effects, regeneration
 * strategy and plant-community tables, none of which answers a hiker, and all of
 * which would crowd the useful sections out of retrieval. Only identification,
 * habitat, diet and human-safety sections are kept (KEEP below).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DomainTag, LicenseEntry } from '@fred/pack-format';
import { looksLikeProcedure } from '@fred/rag-core';
import type { DraftChunk } from './chunk.ts';
import type { FeisReview } from './feis-fetch.ts';
import { loadOnnxEmbedder } from './onnx-embed.ts';
import { documentText, EMBEDDING_GEMMA, loadGgufEmbedder } from './gguf-embed.ts';
import { writePack } from './pack.ts';

const EMBED_MODEL = `${process.env.HOME}/models/gte-small.onnx`;
const EMBED_VOCAB = `${process.env.HOME}/models/gte-small-vocab.txt`;
const EMBED_MODEL_ID = 'Supabase/gte-small';

/** Leaves headroom under gte-small's 512-token limit for the species header. */
const TARGET_TOKENS = 280;

const FEIS_LICENSE: LicenseEntry = {
  id: 'feis',
  license: 'Public domain (US Government work)',
  sourceTitle: 'Fire Effects Information System (FEIS) Species Reviews',
  sourceUrl: 'https://research.fs.usda.gov/feis/species-reviews',
  attribution: 'USDA Forest Service, Rocky Mountain Research Station, Missoula Fire Sciences Laboratory. Fire Effects Information System (FEIS).',
  nonCommercial: false,
};

/** Every plant review has this heading; no animal review does. */
const PLANT_MARKER = 'Botanical and Ecological Characteristics';

/** Sections kept, in the order they are emitted. Everything else is dropped. */
const KEEP: Record<'plants' | 'wildlife', readonly string[]> = {
  plants: [
    'General Distribution', 'Site Characteristics', 'Botanical Description', 'Seasonal Development',
    'Importance to Wildlife and Livestock', 'Palatability and Nutritional Value', 'Other Uses',
    // Carries the "Safety/Medical" notes, e.g. urushiol in poison-oak.
    'Other Management Considerations',
  ],
  wildlife: [
    'General Distribution', 'Biological Characteristics', 'Predators', 'Diet', 'Preferred Habitat',
    'Cover Requirements',
  ],
};

const stripTags = (html: string): string =>
  html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<\/(p|li|tr|h\d)>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"');

/**
 * Heading -> body text. Inline citations ("[29,30,32]") are removed: they cost
 * prefill tokens, match nothing a user types, and refer to a reference list the
 * pack does not ship.
 */
export function feisSections(html: string): Map<string, string> {
  const heads = [...html.matchAll(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/g)];
  const out = new Map<string, string>();
  heads.forEach((h, i) => {
    const title = stripTags(h[2] ?? '').replace(/\s+/g, ' ').trim();
    const start = (h.index ?? 0) + h[0].length;
    const end = heads[i + 1]?.index ?? html.length;
    const body = stripTags(html.slice(start, end))
      .replace(/\s*\[\d+(?:\s*[,–-]\s*\d+)*\]/g, '')
      .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
    if (title !== '' && !out.has(title)) out.set(title, body);
  });
  return out;
}

/** Split a section into windows of whole sentences, each prefixed with its header. */
function windows(header: string, body: string, count: (t: string) => number): string[] {
  const sentences = body.split(/(?<=[.!?])\s+(?=[A-Z(])|\n/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  let cur: string[] = [];
  let tokens = count(header);
  const flush = (): void => {
    if (cur.length > 0) out.push(`${header}\n${cur.join(' ')}`);
    cur = [];
    tokens = count(header);
  };
  for (const s of sentences) {
    const n = count(s);
    if (tokens + n > TARGET_TOKENS && cur.length > 0) flush();
    cur.push(s);
    tokens += n;
  }
  flush();
  return out;
}

export function reviewChunks(r: FeisReview, html: string, count: (t: string) => number): DraftChunk[] {
  const domain: DomainTag = r.headings.includes(PLANT_MARKER) ? 'plants' : 'wildlife';
  const sections = feisSections(html);
  const aka = sections.get('Other Common Names');
  const name = `${r.common} (${r.scientific})`;
  const chunks: DraftChunk[] = [];
  for (const title of KEEP[domain]) {
    let body = sections.get(title) ?? '';
    if (title === 'General Distribution' && aka) body = `Also called: ${aka.replace(/\n/g, ', ')}.\n${body}`;
    // "None", "No entry.", and one-line stubs carry nothing retrievable.
    if (body.length < 60) continue;
    for (const text of windows(`${name} — ${title}`, body, count)) {
      chunks.push({
        text,
        section: `${r.common} > ${title}`,
        page: null,
        domain,
        blockKind: looksLikeProcedure(text) ? 'procedure' : 'prose',
      });
    }
  }
  return chunks;
}

async function main(): Promise<void> {
  const states = process.argv.slice(2).map((s) => s.toUpperCase());
  if (states.length === 0 || !states.every((s) => /^[A-Z]{2}$/.test(s))) {
    console.error('usage: feis-pack.ts <USPS code> [...]   e.g. CA OR');
    process.exit(1);
  }
  const reviews = JSON.parse(readFileSync('corpora/feis/reviews.json', 'utf8')) as FeisReview[];
  // EMBEDDER=embeddinggemma builds for EmbeddingGemma-300M; see index.ts.
  const embedder = process.env.EMBEDDER === 'embeddinggemma'
    ? await loadGgufEmbedder(EMBEDDING_GEMMA)
    : await loadOnnxEmbedder(EMBED_MODEL, EMBED_VOCAB, EMBED_MODEL_ID);
  const count = (t: string): number => embedder.tokenCount(t);

  for (const state of states) {
    const species = reviews.filter((r) => r.states.includes(state));
    const chunks = species.flatMap((r) => reviewChunks(r, readFileSync(join('corpora/feis/html', `${r.id}.html`), 'utf8'), count));
    const plants = species.filter((r) => r.headings.includes(PLANT_MARKER)).length;
    const empty = species.filter((r) => !chunks.some((c) => c.section.startsWith(`${r.common} >`))).map((r) => r.common);
    console.log(`${state}: ${species.length} species (${plants} plants, ${species.length - plants} animals), ${chunks.length} chunks`);
    if (empty.length > 0) console.log(`  ${empty.length} species contributed no chunks: ${empty.slice(0, 10).join(', ')}${empty.length > 10 ? ', …' : ''}`);

    const vectors = await embedder.embed(chunks.map((c) =>
      embedder.spec.documentTemplate === undefined ? c.text : documentText(EMBEDDING_GEMMA, c.section, c.text)));
    const { dir, manifest } = await writePack(process.env.PACKS_OUT ?? 'packs', {
      id: `state-${state}-flora-fauna`,
      version: '1.0.0',
      displayName: `${state} Plants and Wildlife`,
      description: `USFS FEIS species reviews for ${species.length} species recorded in ${state}: identification, habitat, diet and safety notes.`,
      domains: ['plants', 'wildlife'],
      scope: { kind: 'us-state', state },
      source: 'USFS FEIS',
      licenseId: 'feis',
      licenses: [FEIS_LICENSE],
      embedding: embedder.spec,
    }, chunks, vectors);
    const mb = manifest.files.reduce((s, f) => s + f.bytes, 0) / 1024 / 1024;
    console.log(`  wrote ${dir}: ${manifest.chunkCount} chunks, ${mb.toFixed(2)} MB`);
  }
  await embedder.dispose();
}

if (import.meta.main) await main();
