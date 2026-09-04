/**
 * Ingest CLI — corpus PDF to on-device pack.
 *
 *   node tools/ingest/src/index.ts who-bec
 *
 * Written in TypeScript rather than Python (as originally planned) for two
 * reasons that turned out to matter: it embeds with the same llama.cpp the app
 * and eval harness use, avoiding an index/query numerical mismatch, and it
 * imports @fred/pack-format directly so the writer and reader cannot drift.
 */
import { extractPdf } from './pdf.ts';
import { cleanPage, findBoilerplate } from './clean.ts';
import { chunkPages, DEFAULT_CHUNKING, type SourcePage } from './chunk.ts';
import { classifyChunk } from './filter.ts';
import { loadEmbedder } from './embed.ts';
import { writePack, type PackInput } from './pack.ts';
import type { DomainTag, LicenseEntry } from '@fred/pack-format';

const EMBED_MODEL = `${process.env.HOME}/models/gte-small_fp16.gguf`;
const EMBED_MODEL_ID = 'thenlper/gte-small';

const WHO_BEC_LICENSE: LicenseEntry = {
  id: 'who-bec',
  license: 'CC-BY-NC-SA-3.0-IGO',
  sourceTitle: 'WHO/ICRC Basic Emergency Care: approach to the acutely ill and injured',
  sourceUrl: 'https://www.who.int/publications-detail-redirect/basic-emergency-care-approach-to-the-acutely-ill-and-injured',
  attribution: 'WHO/ICRC Basic Emergency Care (2018), CC BY-NC-SA 3.0 IGO',
  nonCommercial: true,
};

interface CorpusDef {
  readonly pdf: string;
  readonly input: Omit<PackInput, 'embedding'>;
  readonly domain: DomainTag;
}

const CORPORA: Record<string, CorpusDef> = {
  'who-bec': {
    pdf: 'corpora/who/who-bec.pdf',
    domain: 'first-aid-physical',
    input: {
      id: 'core-firstaid',
      version: '1.0.0',
      displayName: 'Physical First Aid',
      description: 'WHO/ICRC Basic Emergency Care — acute illness and injury.',
      domains: ['first-aid-physical'],
      scope: { kind: 'global' },
      source: 'WHO BEC 2018',
      licenseId: 'who-bec',
      licenses: [WHO_BEC_LICENSE],
    },
  },
};

const name = process.argv[2] ?? 'who-bec';
const def = CORPORA[name];
if (!def) {
  console.error(`unknown corpus "${name}"; known: ${Object.keys(CORPORA).join(', ')}`);
  process.exit(1);
}

console.log(`[1/5] extracting ${def.pdf}`);
const pages = await extractPdf(def.pdf);
const layouts = pages.reduce<Record<string, number>>((a, p) => {
  a[p.layout] = (a[p.layout] ?? 0) + 1;
  return a;
}, {});
const avgSuspect = pages.reduce((s, p) => s + p.suspectRatio, 0) / pages.length;
console.log(`      ${pages.length} pages, layouts ${JSON.stringify(layouts)}, avg suspect ${avgSuspect.toFixed(4)}`);

console.log('[2/5] cleaning');
const boilerplate = findBoilerplate(pages);
const cleaned: SourcePage[] = pages.map((p) => ({
  pageNumber: p.pageNumber,
  text: cleanPage(p, boilerplate),
}));
console.log(`      removed ${boilerplate.size} boilerplate lines`);

console.log(`[3/5] loading embedder ${EMBED_MODEL_ID}`);
const embedder = await loadEmbedder(EMBED_MODEL, EMBED_MODEL_ID);
console.log(`      dim ${embedder.spec.dim}, calibrated cosineFloor ${embedder.spec.cosineFloor.toFixed(4)}`);

console.log('[4/5] chunking');
const chunks = chunkPages(cleaned, {
  ...DEFAULT_CHUNKING,
  domain: def.domain,
  tokenize: (t) => embedder.tokenCount(t),
});
const kept = chunks.filter((c) => !classifyChunk(c.text).drop);
const dropped = chunks.length - kept.length;
const procedures = kept.filter((c) => c.blockKind === 'procedure').length;
console.log(`      ${chunks.length} chunks, dropped ${dropped} course-scaffolding ` +
  `(${((dropped / chunks.length) * 100).toFixed(1)}%)`);
console.log(`      ${kept.length} kept (${procedures} procedure, ${kept.length - procedures} prose)`);

console.log('[5/5] embedding + writing pack');
const vectors = await embedder.embed(kept.map((c) => c.text));
const { dir, manifest } = await writePack('packs', { ...def.input, embedding: embedder.spec }, kept, vectors);
await embedder.dispose();

const totalBytes = manifest.files.reduce((s, f) => s + f.bytes, 0);
console.log(`\nwrote ${dir}`);
for (const f of manifest.files) {
  console.log(`  ${f.path.padEnd(16)} ${(f.bytes / 1024).toFixed(0).padStart(7)} KB`);
}
console.log(`  ${'TOTAL'.padEnd(16)} ${(totalBytes / 1024 / 1024).toFixed(2).padStart(7)} MB for ${manifest.chunkCount} chunks`);
