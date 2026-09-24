/**
 * Ingest CLI — corpus PDF to on-device pack.
 *
 *   node tools/ingest/src/index.ts who-bec
 *   node tools/ingest/src/index.ts atp-3-50-21
 *   node tools/ingest/src/index.ts atp-4-02-11
 *
 * Written in TypeScript rather than Python (as originally planned) for two
 * reasons that turned out to matter: it embeds with the same encoder code the app
 * and eval harness use, avoiding an index/query numerical mismatch, and it
 * imports @fred/pack-format directly so the writer and reader cannot drift.
 */
import { extractPdf } from './pdf.ts';
import { cleanPage, findBoilerplate, type CleanRules } from './clean.ts';
import { chunkByStructure, chunkPages, DEFAULT_CHUNKING, type SourcePage } from './chunk.ts';
import { classifyChunk } from './filter.ts';
import { loadOnnxEmbedder } from './onnx-embed.ts';
import { writePack, type PackInput } from './pack.ts';
import { contextualize } from './contextualize.ts';
import { documentText, EMBEDDING_GEMMA, loadGgufEmbedder } from './gguf-embed.ts';
import type { DomainTag, LicenseEntry } from '@fred/pack-format';

// ONNX rather than GGUF: the device must reproduce these vectors exactly, and
// two llama.cpp wrappers did not agree with each other or with the reference
// (docs/results-m3.md). rag-core supplies the tokenizer and pooling, so the only
// thing that differs between here and the phone is the ONNX execution provider.
const EMBED_MODEL = `${process.env.HOME}/models/gte-small.onnx`;
const EMBED_VOCAB = `${process.env.HOME}/models/gte-small-vocab.txt`;
const EMBED_MODEL_ID = 'Supabase/gte-small';

import { ATP_FIRST_AID_LICENSE, ATP_SURVIVAL_LICENSE, WHO_BEC_LICENSE } from './licenses.ts';

interface CorpusDef {
  readonly pdf: string;
  readonly input: Omit<PackInput, 'embedding'>;
  readonly domain: DomainTag;
  /** Inclusive PDF page ranges holding usable body text. Default: every page. */
  readonly pages?: readonly (readonly [number, number])[];
  readonly clean?: CleanRules;
  /**
   * Overrides the chunk domain for part of a corpus. The pack's routing domains
   * are unchanged; this only affects what a chunk reports about itself, which is
   * what decides whether an answer is flagged medical.
   */
  readonly domainForPage?: (page: number) => DomainTag | undefined;
  /**
   * Chunks dropped by content, after chunking. For material that sits inside an
   * otherwise useful chapter but must never reach a user of this app.
   */
  readonly dropChunks?: readonly RegExp[];
}

/**
 * Contextual retrieval changes what is indexed and what the generator sees, so
 * a contextualized pack is a different pack. Packs are replaced wholesale and
 * never patched in place, and a device holding the old version has no way to
 * discover the difference unless the version says so — hence the minor bump on
 * all three core corpora when CONTEXTUALIZE landed.
 */
const CORPORA: Record<string, CorpusDef> = {
  'who-bec': {
    pdf: 'corpora/who/who-bec.pdf',
    domain: 'first-aid-physical',
    input: {
      id: 'core-firstaid',
      version: '1.1.0',
      displayName: 'Physical First Aid',
      description: 'WHO/ICRC Basic Emergency Care — acute illness and injury.',
      domains: ['first-aid-physical'],
      scope: { kind: 'global' },
      source: 'WHO BEC 2018',
      licenseId: 'who-bec',
      licenses: [WHO_BEC_LICENSE],
    },
  },
  // Current Army survival doctrine. It supersedes FM 3-05.70 (2002), which
  // superseded the FM 21-76 (1992) that docs/licensing.md originally planned on;
  // same public-domain status, 26 years newer.
  'atp-3-50-21': {
    pdf: 'corpora/survival/atp-3-50-21.pdf',
    domain: 'survival',
    // p13 is Chapter 1; p218 ends Appendix A. Contents, preface, glossary,
    // references and index are excluded: none can answer a question, and a
    // contents page outranking real procedures already happened once (clean.ts).
    pages: [[13, 218]],
    clean: {
      dropLines: [
        /^This page intentionally left blank\.?$/i,
        // Footer: "<page label> ATP 3-50.21 <date>" in either order.
        /^(?:\S+\s+)?ATP 3-50\.21(?:\s+\S+)?$/,
        // The footer date is set in a font pdfjs cannot map; "September" arrives
        // shifted as "6HSWHPEHU". It is never content.
        /HSWHPEHU/,
      ],
      dropEdgeLines: [
        /^Chapter \d+$/,
        /^Appendix A$/,
        /^(?:Overview|Survival Medicine|Water|Food|Fire|Shelter and Clothing|Movement and Navigation|Survival Equipment|Survival Knots and Rope)$/,
      ],
      // Bullets are a Wingdings glyph that extracts as a literal "z".
      rewrites: [[/^z (?=\S)/gm, '- ']],
    },
    // Chapter 2, Survival Medicine, tagged medical so answers drawn from it carry
    // the disclaimer. The pack routes for first aid as well, because this chapter
    // is where minor-wound cleaning and sprained-ankle care actually live; the two
    // first-aid manuals cover neither well. Chunk-domain filtering in retrieve()
    // keeps the rest of the pack (snares, fire, knots) out of first-aid answers.
    domainForPage: (page) => (page >= 19 && page <= 54 ? 'first-aid-physical' : undefined),
    input: {
      id: 'core-survival',
      // 1.1.0: rebuilt with list-header carrying; 1.0.0 has inverted negated lists.
      version: '1.2.0',
      displayName: 'Wilderness Survival',
      description: 'US Army ATP 3-50.21 Survival — water, food, fire, shelter, navigation, knots.',
      domains: ['survival', 'first-aid-physical'],
      scope: { kind: 'global' },
      source: 'ATP 3-50.21 Survival 2018',
      licenseId: 'atp-3-50-21',
      licenses: [ATP_SURVIVAL_LICENSE],
    },
  },
  // The Army's first-aid manual for nonmedical personnel; supersedes TC 4-02.1
  // (2016), which superseded FM 4-25.11 (2002). Added because WHO BEC is written
  // for health facilities and has no minor-injury care: the proposal's own
  // "I cut myself on a branch" abstained against it (docs/results-alpha.md).
  'atp-4-02-11': {
    pdf: 'corpora/army/atp-4-02-11.pdf',
    domain: 'first-aid-physical',
    // Only the chapters a civilian responder can act on. Excluded: Ch 1 unit
    // casualty-response operations, Ch 3 TCCC doctrine, Ch 9 combat wound
    // medication packs, Ch 15 military evacuation and DD Form 1380, Ch 18 sickle
    // cell trait screening, Ch 19 chemical/nerve agents, Ch 20 combat stress,
    // appendices (kit inventories), and all front and back matter.
    pages: [
      [37, 39], // Ch 2 casualty extraction and carries
      [57, 106], // Ch 4-8 bleeding, airway, breathing, circulation/shock, hypothermia
      [111, 164], // Ch 10-14 eye, head, burns, fractures and splinting, bandaging
      [173, 197], // Ch 16-17 bites and stings, climatic and environmental injuries
    ],
    clean: {
      dropLines: [
        /^This page intentionally left blank\.?$/i,
        // Footer: "23 March 2026 ATP 4-02.11 139" or "140 ATP 4-02.11 23 March 2026".
        /^[\d\s]*(?:March\s+\d+\s*)?ATP 4-02\.11[\d\s]*(?:March\s+\d+)?$/,
      ],
      dropEdgeLines: [
        /^Chapter \d+$/,
        /^(?:Casualty Extraction and Movement|Massive Bleeding Control|Airway Control|Respiration and Breathing Control|Circulation Control|Hypothermia Control|Eye Trauma|Head Injury|Burns|Fractures and Splinting|Expedient Techniques for other Secondary Injuries|Bites and Stings|Climatic and Environmental Injuries)$/,
        /^PART THREE$/,
      ],
      rewrites: [
        // Word-export bookmark ids fused onto headings: "208BOVERVIEW OF ...".
        // Left in, "208BOVERVIEW" is neither a heading nor a searchable word.
        [/^\d{1,3}B(?=[A-Z])/gm, ''],
        [/^▪ /gm, '- '],
      ],
    },
    // Invasive procedures a hiker must never be walked through by a 0.6B model.
    //
    // Matching instructions, not mentions. The first version dropped any chunk
    // naming an NPA and removed 19 chunks, including the recovery position (p.79)
    // and CPR (p.94), which share chunks with a passing reference. What must go
    // is anything that teaches inserting an airway tube or a needle into a chest.
    // Needle decompression is dropped on any mention: every chunk naming it is
    // about performing it, and p.94 advises it *instead of* CPR, which is wrong
    // for a civilian cardiac arrest. Tourniquets and wound packing stay; they are
    // current civilian guidance too.
    dropChunks: [
      /needle (?:chest )?decompression|\bNDC\b/i,
      /\binsert(?:s|ing)? (?:an|the) NPA\b|\b(?:sizing|lubricat\w*) the NPA\b/i,
      /cricothyro|intraosseous|autoinjector/i,
    ],
    input: {
      id: 'core-firstaid-army',
      // 1.1.0: rebuilt with list-header carrying; 1.0.0 has inverted negated lists.
      version: '1.2.0',
      displayName: 'Field First Aid',
      description: 'US Army ATP 4-02.11 — first aid for nonmedical responders: bleeding, airway, burns, fractures, bites, heat and cold.',
      domains: ['first-aid-physical'],
      scope: { kind: 'global' },
      source: 'ATP 4-02.11 First Aid 2026',
      licenseId: 'atp-4-02-11',
      licenses: [ATP_FIRST_AID_LICENSE],
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
const allPages = await extractPdf(def.pdf);
const ranges = def.pages ?? [[1, allPages.length]];
const pages = allPages.filter((p) => ranges.some(([a, b]) => p.pageNumber >= a && p.pageNumber <= b));
const layouts = pages.reduce<Record<string, number>>((a, p) => {
  a[p.layout] = (a[p.layout] ?? 0) + 1;
  return a;
}, {});
const avgSuspect = pages.reduce((s, p) => s + p.suspectRatio, 0) / pages.length;
console.log(`      ${pages.length} of ${allPages.length} pages (${ranges.map(([a, b]) => `${a}-${b}`).join(', ')}), ` +
  `layouts ${JSON.stringify(layouts)}, avg suspect ${avgSuspect.toFixed(4)}`);

console.log('[2/5] cleaning');
const boilerplate = findBoilerplate(pages);
const cleaned: SourcePage[] = pages.map((p) => ({
  pageNumber: p.pageNumber,
  text: cleanPage(p, boilerplate, def.clean),
}));
console.log(`      removed ${boilerplate.size} boilerplate lines`);

// EMBEDDER=embeddinggemma builds the pack for EmbeddingGemma-300M instead of
// gte-small. The pack records which, and every runtime reads it from there.
const embedderName = process.env.EMBEDDER ?? 'gte-small';
if (embedderName !== 'gte-small' && embedderName !== 'embeddinggemma') {
  throw new Error(`EMBEDDER must be gte-small or embeddinggemma, got ${embedderName}`);
}
console.log(`[3/5] loading embedder ${embedderName === 'gte-small' ? EMBED_MODEL_ID : EMBEDDING_GEMMA.modelId}`);
const embedder = embedderName === 'gte-small'
  ? await loadOnnxEmbedder(EMBED_MODEL, EMBED_VOCAB, EMBED_MODEL_ID)
  : await loadGgufEmbedder(EMBEDDING_GEMMA);
console.log(`      dim ${embedder.spec.dim}, calibrated cosineFloor ${embedder.spec.cosineFloor.toFixed(4)}`);

// CHUNKING=structure cuts at the manual's own paragraphs (chunkByStructure).
// Measured 2026-09-24 and NOT the default: it cut mid-sentence starts from
// 35-68% to 1-7%, but put the answer's source passage in the top 4 for 23 of 49
// cited tuning questions against the windows' 27, even at an equal token
// budget (EmbeddingGemma, pure semantic ranking). Readable passages are the
// field cards' job instead (docs/results-phase1.md).
const chunking = process.env.CHUNKING ?? 'window';
if (chunking !== 'structure' && chunking !== 'window') throw new Error(`CHUNKING must be structure or window, got ${chunking}`);
console.log(`[4/5] chunking (${chunking})`);
const chunks = (chunking === 'structure' ? chunkByStructure : chunkPages)(cleaned, {
  ...DEFAULT_CHUNKING,
  domain: def.domain,
  tokenize: (t) => embedder.tokenCount(t),
}).map((c) => ({ ...c, domain: (c.page === null ? undefined : def.domainForPage?.(c.page)) ?? c.domain }));
const scaffolding = chunks.filter((c) => classifyChunk(c.text).drop);
const excluded = chunks.filter((c) => !classifyChunk(c.text).drop && def.dropChunks?.some((re) => re.test(c.text)));
const kept = chunks.filter((c) => !scaffolding.includes(c) && !excluded.includes(c));
const procedures = kept.filter((c) => c.blockKind === 'procedure').length;
console.log(`      ${chunks.length} chunks, dropped ${scaffolding.length} course-scaffolding ` +
  `(${((scaffolding.length / chunks.length) * 100).toFixed(1)}%), ${excluded.length} by corpus exclusion rules`);
for (const c of excluded) {
  console.log(`        excluded p.${c.page} ${c.section.slice(0, 40)}: ${c.text.replace(/\s+/g, ' ').slice(0, 80)}...`);
}
console.log(`      ${kept.length} kept (${procedures} procedure, ${kept.length - procedures} prose)`);
const byDomain = kept.reduce<Record<string, number>>((a, c) => {
  a[c.domain] = (a[c.domain] ?? 0) + 1;
  return a;
}, {});
console.log(`      by domain ${JSON.stringify(byDomain)}`);

// CONTEXTUALIZE=1 adds a contextual-retrieval preamble to every chunk. Opt-in
// because it needs a local generation model and turns a two-minute ingest into
// a much longer one; see docs/results-improvement-research.md for why it earns
// that. Packs built without it stay valid — the column is nullable.
let contextualized = kept;
if (process.env.CONTEXTUALIZE === '1') {
  const genModel = process.env.GEN_MODEL ?? `${process.env.HOME}/models/Qwen3-1.7B-Q4_K_M.gguf`;
  console.log(`[5/6] contextualizing ${kept.length} chunks with ${genModel.split('/').pop()}`);
  const started = Date.now();
  const contexts = await contextualize(kept, {
    modelPath: genModel,
    documentTitle: def.input.source,
    onProgress: (done, total) => {
      if (done % 25 !== 0 && done !== total) return;
      const rate = (Date.now() - started) / done;
      const left = ((total - done) * rate) / 1000;
      process.stdout.write(`\r      ${done}/${total}  ~${left.toFixed(0)}s remaining   `);
    },
  });
  process.stdout.write('\n');
  contextualized = kept.map((c, i) => ({ ...c, context: contexts[i] ?? '' }));
  const labelled = contexts.filter((c) => c.includes('AVOID')).length;
  console.log(`      ${labelled} chunks labelled as prohibitions`);
}

console.log(`[${process.env.CONTEXTUALIZE === '1' ? '6/6' : '5/5'}] embedding + writing pack`);
// The preamble is embedded with the text, which is the whole point: it is what
// gives an out-of-vocabulary passage surface to match on.
// Structure chunks are shorter and most no longer open on their heading, so the
// section title is prepended for embedding only (the stored text is unchanged).
// A passage that says "tie the tails at the side" is then indexed as being about
// SHOULDER BANDAGE. HEADINGS=0 turns it off for comparison.
const withHeading = (c: { section: string; text: string }): string =>
  chunking === 'structure' && process.env.HEADINGS !== '0' && !c.text.startsWith(c.section)
    ? `${c.section}\n${c.text}`
    : c.text;
// An encoder with a passage template takes the section as its title field, so
// the heading prefix above would say the same thing twice.
const passage = (c: { section: string; text: string; context?: string }): string => {
  const body = c.context === undefined || c.context === '' ? c.text : `${c.context}\n${c.text}`;
  return embedder.spec.documentTemplate === undefined
    ? (c.context === undefined || c.context === '' ? withHeading(c) : `${c.context}\n${withHeading(c)}`)
    : documentText(EMBEDDING_GEMMA, c.section, body);
};
const vectors = await embedder.embed(contextualized.map(passage));
const { dir, manifest } = await writePack(process.env.PACKS_OUT ?? 'packs', { ...def.input, embedding: embedder.spec }, contextualized, vectors);
await embedder.dispose();

const totalBytes = manifest.files.reduce((s, f) => s + f.bytes, 0);
console.log(`\nwrote ${dir}`);
for (const f of manifest.files) {
  console.log(`  ${f.path.padEnd(16)} ${(f.bytes / 1024).toFixed(0).padStart(7)} KB`);
}
console.log(`  ${'TOTAL'.padEnd(16)} ${(totalBytes / 1024 / 1024).toFixed(2).padStart(7)} MB for ${manifest.chunkCount} chunks`);
