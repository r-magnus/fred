/**
 * Build the field-card pack from corpora/cards/cards.json.
 *
 *   node tools/ingest/src/cards-pack.ts              # every card
 *   CARDS=approved node tools/ingest/src/cards-pack.ts reviews.json
 *
 * Refuses to build if any card cites a quote its source does not contain
 * (validateCards). With CARDS=approved, only cards whose review decision is
 * "approved" at their current revision go in: that is the shipping mode, and a
 * card Ryan has not signed off never reaches a phone. The unfiltered build is
 * for measuring while review is under way.
 *
 * One chunk per card. The card is small enough to embed whole, and splitting it
 * would reopen the problem cards exist to close: a step read without the
 * "don't" beneath it.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CardClarify, CardSource, LicenseEntry } from '@fred/pack-format';
import { cardText, validateCards, type FieldCard, type PassageText } from './cards.ts';
import { loadOnnxEmbedder } from './onnx-embed.ts';
import { documentText, EMBEDDING_GEMMA, loadGgufEmbedder } from './gguf-embed.ts';
import { ATP_FIRST_AID_LICENSE, ATP_SURVIVAL_LICENSE, WHO_BEC_LICENSE } from './licenses.ts';
import { writePack } from './pack.ts';
import type { DraftChunk } from './chunk.ts';

const PACKS = process.env.PACKS_OUT ?? 'packs';

/**
 * Cards paraphrase their sources, so they inherit the strictest terms among
 * them. WHO BEC is NonCommercial-ShareAlike, and at least one card draws on it,
 * so the pack as a whole is marked nonCommercial (docs/licensing.md).
 */
const CARDS_LICENSE: LicenseEntry = {
  id: 'fred-field-cards',
  license: 'Derived work: CC-BY-NC-SA-3.0-IGO (from WHO BEC) and public domain (US Army ATP 3-50.21, ATP 4-02.11)',
  sourceTitle: 'Fred field cards, written from WHO BEC 2018, ATP 3-50.21 and ATP 4-02.11',
  sourceUrl: 'corpora/cards/cards.json',
  attribution: 'Adapted from WHO/ICRC Basic Emergency Care (2018), CC BY-NC-SA 3.0 IGO, and US Army ATP 3-50.21 (2018) and ATP 4-02.11 (2026).',
  nonCommercial: true,
};

function revOf(c: FieldCard): string {
  const sorted = (v: unknown): unknown => Array.isArray(v) ? v.map(sorted)
    : v !== null && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])]))
      : v;
  return createHash('sha1').update(JSON.stringify(sorted(c))).digest('hex').slice(0, 12);
}

// Passages to validate against: the core packs in PACKS_SOURCE (default packs/).
const source = process.env.PACKS_SOURCE ?? 'packs';
const passages: PassageText[] = [];
for (const d of readdirSync(source).filter((d) => d.startsWith('core-') && existsSync(join(source, d, 'chunks.sqlite')))) {
  const db = new DatabaseSync(join(source, d, 'chunks.sqlite'), { readOnly: true });
  passages.push(...(db.prepare('SELECT source, page, text FROM chunks').all() as unknown as PassageText[]));
  db.close();
}

let cards = JSON.parse(readFileSync('corpora/cards/cards.json', 'utf8')) as FieldCard[];
const problems = validateCards(cards, passages);
if (problems.length > 0) {
  for (const p of problems) console.error(`${p.cardId}: ${p.problem}`);
  throw new Error(`${problems.length} card problems; fix them before building`);
}

if (process.env.CARDS === 'approved') {
  const reviewsPath = process.argv[2];
  if (reviewsPath === undefined) throw new Error('CARDS=approved needs the exported reviews JSON as an argument');
  const reviews = JSON.parse(readFileSync(reviewsPath, 'utf8')) as Record<string, { decision: string; rev: string }>;
  // Changes Claude made and self-reviewed after Ryan's review, per his
  // 2026-09-24 instruction to escalate only serious conflicts. Each entry names
  // the card revision it covers, so a later edit needs a new entry.
  const selfPath = 'corpora/cards/self-reviews.json';
  const self = (existsSync(selfPath) ? JSON.parse(readFileSync(selfPath, 'utf8')) : []) as { id: string; rev: string }[];
  const before = cards.length;
  cards = cards.filter((c) =>
    (reviews[c.id]?.decision === 'approved' && reviews[c.id]?.rev === revOf(c)) ||
    self.some((r) => r.id === c.id && r.rev === revOf(c)));
  console.log(`approved at current revision: ${cards.length} of ${before}`);
}
if (cards.length === 0) throw new Error('no cards to build');

const embedderName = process.env.EMBEDDER ?? 'embeddinggemma';
const embedder = embedderName === 'embeddinggemma'
  ? await loadGgufEmbedder(EMBEDDING_GEMMA)
  : await loadOnnxEmbedder(`${process.env.HOME}/models/gte-small.onnx`, `${process.env.HOME}/models/gte-small-vocab.txt`, 'Supabase/gte-small');

// Clarifying questions (#50), keyed by the chunk id each card will get. An
// entry pinned to an older card revision is refused: its step numbers may no
// longer point at the steps they were written for.
const clarifyFile = JSON.parse(readFileSync('corpora/cards/clarify.json', 'utf8')) as
  Record<string, CardClarify & { rev: string }>;
const clarify: Record<string, CardClarify> = {};
for (const [id, entry] of Object.entries(clarifyFile)) {
  if (id.startsWith('_')) continue;
  const at = cards.findIndex((c) => c.id === id);
  if (at === -1) { console.log(`clarify: ${id} not in this build, skipped`); continue; }
  const card = cards[at]!;
  if (entry.rev !== revOf(card)) throw new Error(`clarify.json ${id} is for card revision ${entry.rev || '(none)'}, the card is ${revOf(card)}; re-check its step numbers`);
  for (const ch of entry.choices) {
    for (const n of ch.steps) {
      if (!Number.isInteger(n) || n < 1 || n > card.steps.length) throw new Error(`clarify.json ${id} "${ch.label}": no step ${n}`);
    }
  }
  clarify[`core-fieldcards:${at}`] = { question: entry.question, choices: entry.choices };
}

// The manuals each card quotes, with the pages, for its citation in the app.
// Taken from the same quotes validateCards has already checked word for word.
const cardSources: Record<string, CardSource[]> = {};
cards.forEach((c, at) => {
  const bySource = new Map<string, Set<number>>();
  for (const q of c.sources) {
    const pages = bySource.get(q.source) ?? new Set<number>();
    if (q.page !== null) pages.add(q.page);
    bySource.set(q.source, pages);
  }
  cardSources[`core-fieldcards:${at}`] = [...bySource].map(([source, pages]) => ({ source, pages: [...pages].sort((a, b) => a - b) }));
});

const chunks: DraftChunk[] = cards.map((c) => ({
  text: cardText(c),
  section: c.title,
  page: null,
  domain: c.domain,
  blockKind: 'procedure',
}));
// The ways a hiker might ask are embedded with the card but never shown to the
// model: they give lay wording ("I twisted my ankle") something to match.
const embedInput = cards.map((c, i) => {
  const body = `${chunks[i]!.text}\n${c.askedAs.join('\n')}`;
  return embedder.spec.documentTemplate === undefined ? body : documentText(EMBEDDING_GEMMA, c.title, body);
});
const vectors = await embedder.embed(embedInput);

const { dir } = await writePack(PACKS, {
  id: 'core-fieldcards',
  version: '0.5.0',
  displayName: 'Field Cards',
  description: 'Plain-language answers for common wilderness first-aid and survival situations, each written from and checked against the manuals.',
  domains: ['first-aid-physical', 'survival'],
  scope: { kind: 'global' },
  source: 'Fred field card',
  licenseId: CARDS_LICENSE.id,
  licenses: [CARDS_LICENSE, WHO_BEC_LICENSE, ATP_SURVIVAL_LICENSE, ATP_FIRST_AID_LICENSE],
  embedding: embedder.spec,
  clarify,
  cardSources,
}, chunks, vectors);
await embedder.dispose();
console.log(`wrote ${dir}: ${cards.length} cards`);
