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
let casualties = 0;
for (const q of qs) {
  if (!q.cite) continue;
  // Match on a distinctive fragment of the cited quote.
  const frag = norm(q.cite.quote).split(' ').slice(0, 8).join(' ');
  const holders = rows.filter((r) => norm(r.text).includes(frag));
  if (holders.length === 0) { console.log(`  ${q.id}: quote not found in pack (pre-existing)`); continue; }
  const survivors = holders.filter((r) => !classifyChunk(r.text).drop);
  if (survivors.length === 0) {
    console.log(`  !! ${q.id} p.${q.cite.page}: ALL ${holders.length} holding chunk(s) dropped`);
    console.log(`     reason: ${classifyChunk(holders[0]!.text).reason}`);
    casualties++;
  }
}
console.log(casualties === 0 ? '\nOK: no cited passage lost' : `\nFAIL: ${casualties} questions lost their source`);
