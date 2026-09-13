import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { classifyChunk } from './filter.ts';

const db = new DatabaseSync('packs/core-firstaid-v1.0.0/chunks.sqlite', { readOnly: true });
const rows = db.prepare('SELECT ordinal,page,text FROM chunks').all() as { ordinal: number; page: number; text: string }[];

const dropped = rows.filter((r) => classifyChunk(r.text).drop);
console.log(`would drop ${dropped.length} of ${rows.length} (${(dropped.length / rows.length * 100).toFixed(1)}%)`);

// Every eval question cites a passage. If the filter removes the chunk holding
// that passage, the question becomes unanswerable and accuracy would fall for
// the wrong reason. This must be zero.
const qs = JSON.parse(readFileSync('tools/eval/data/bec-corpus.json', 'utf8')) as
  { id: string; cite?: { page: number; quote: string } }[];

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const words = (s: string): string[] => norm(s).split(' ').filter((w) => w.length > 2);

/**
 * Citations quote the SOURCE PDF, where a sentence is contiguous. In the
 * extracted text it may not be: multi-column tables interleave cells, so
 * "A large quantity of blood can also be lost into the chest" arrives as
 * "A large quantity of blood can also - Bruising around the be lost into the
 * chest". Substring matching therefore reports false casualties and tempts you
 * to edit correct quotes to satisfy a brittle checker.
 *
 * Word overlap is the right test: it tolerates interleaving while still
 * catching the case this exists to catch, which is content the filter removed.
 */
const OVERLAP_REQUIRED = 0.7;

let casualties = 0;
for (const q of qs) {
  if (!q.cite) continue;
  const want = words(q.cite.quote);
  if (want.length === 0) continue;
  const covers = (text: string): boolean => {
    const have = new Set(words(text));
    return want.filter((w) => have.has(w)).length / want.length >= OVERLAP_REQUIRED;
  };
  const holders = rows.filter((r) => covers(r.text));
  if (holders.length === 0) {
    console.log(`  ${q.id} p.${q.cite.page}: quote not found in pack at all`);
    casualties++;
    continue;
  }
  const survivors = holders.filter((r) => !classifyChunk(r.text).drop);
  if (survivors.length === 0) {
    console.log(`  !! ${q.id} p.${q.cite.page}: ALL ${holders.length} holding chunk(s) dropped`);
    console.log(`     reason: ${classifyChunk(holders[0]!.text).reason}`);
    casualties++;
  }
}
console.log(casualties === 0 ? '\nOK: no cited passage lost' : `\nFAIL: ${casualties} questions lost their source`);
