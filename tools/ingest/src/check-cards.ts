/**
 * Check every field card's quotes against the packs they cite.
 *
 *   node tools/ingest/src/check-cards.ts [packsDir]
 *
 * Exits non-zero if any quote is missing, so a card cannot be built into a pack
 * with a claim its source does not make.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { validateCards, type FieldCard, type PassageText } from './cards.ts';

const dir = process.argv[2] ?? 'packs';
const passages: PassageText[] = [];
for (const d of readdirSync(dir).filter((d) => d.startsWith('core-') && existsSync(join(dir, d, 'chunks.sqlite')))) {
  const db = new DatabaseSync(join(dir, d, 'chunks.sqlite'), { readOnly: true });
  for (const r of db.prepare('SELECT source, page, text FROM chunks').all() as { source: string; page: number | null; text: string }[]) {
    passages.push(r);
  }
  db.close();
}
const cards = JSON.parse(readFileSync('corpora/cards/cards.json', 'utf8')) as FieldCard[];
const problems = validateCards(cards, passages);
for (const p of problems) console.log(`${p.cardId}: ${p.problem}`);
const quotes = cards.reduce((n, c) => n + c.sources.length, 0);
console.log(`${cards.length} cards, ${quotes} quotes, ${problems.length} problems`);
process.exit(problems.length === 0 ? 0 : 1);
