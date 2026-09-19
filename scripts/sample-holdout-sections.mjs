/**
 * Draw corpus sections at random to build held-out eval questions from.
 *
 *   node scripts/sample-holdout-sections.mjs <pack-dir> <count>
 *
 * This exists to take topic choice away from whoever writes the questions. By
 * the time the held-out set was needed, the author had already read every
 * failure in the tuning set and could not unsee them — left to pick topics
 * freely, they would have picked around the known weak spots in one direction
 * or straight at them in the other, and either way the resulting score would
 * say more about the author than about Fred.
 *
 * So: exclude what the tuning set already covers, exclude headings that are PDF
 * artefacts rather than topics, and sample what is left under a fixed seed. The
 * questions are then written from the sampled passage text.
 *
 * Reproducing the shipped set means running this with the same seed against the
 * same pack versions; see docs/results-holdout.md.
 */
import { DatabaseSync } from 'node:sqlite';

/** Topics the 68 tuning questions already cover, by the words their sections use. */
const COVERED = new RegExp([
  'bleed', 'tourniquet', 'pressure dressing', 'snake', 'shock', 'burn', 'chok',
  'seizure', 'convuls', 'hypotherm', 'heat', 'fractur', 'splint', 'sprain',
  'cut', 'scrape', 'infection', 'unconscious', 'head', 'eye', 'blister',
  'water', 'fire', 'kindling', 'shelter', 'navigat', 'knot', 'hitch', 'signal',
  'plant edibility', 'poisonous', 'river', 'water cross', 'immersion', 'trench',
  'cold injur', 'food', 'lost',
].join('|'), 'i');

/** Headings that are an artefact of the source PDF, not a subject. */
const JUNK = /^(yes|no|\[?see |skills\]|introduction|overview$|module \d|multiple choice|condition|signs and symptoms|assessment|remember|[spam]:|gcs|ors|references|glossary|index|appendix|summary|contents|figure|table)/i;

/** Mulberry32 — a small seeded PRNG, so the draw does not depend on the runtime. */
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const [, , packDir, countArg] = process.argv;
if (packDir === undefined) {
  console.error('usage: node scripts/sample-holdout-sections.mjs <pack-dir> <count>');
  process.exit(1);
}
const count = Number(countArg ?? 9);

const db = new DatabaseSync(`${packDir}/chunks.sqlite`, { readOnly: true });
const pool = db
  .prepare('select section, count(*) n, min(page) page from chunks group by section')
  .all()
  // Under three chunks there is rarely enough text to ground an answer sheet.
  .filter((r) => r.n >= 3 && r.section.length >= 8)
  .filter((r) => !JUNK.test(r.section.trim()) && !COVERED.test(r.section))
  .sort((a, b) => a.section.localeCompare(b.section));

// Fisher-Yates over a copy, so the draw is a permutation rather than sampling
// with replacement — the same section must not be drawn twice.
const next = rng(20260918);
const picked = pool.slice();
for (let i = picked.length - 1; i > 0; i--) {
  const j = Math.floor(next() * (i + 1));
  [picked[i], picked[j]] = [picked[j], picked[i]];
}

console.log(`# ${packDir}: ${pool.length} eligible sections, sampling ${count}`);
for (const r of picked.slice(0, count)) console.log(`${r.page ?? '-'}\t${r.n}\t${r.section}`);
