/**
 * How often does the battery estimate's prediction match what Fred then did?
 * (US-13, #80, docs/results-battery-estimate.md)
 *
 *   PACKS_DIR=... SAID=... STATE=CA node tools/eval/src/predict-check.ts <runs-dir>
 *
 * For every reply in a decision sweep's run files, predictCost() is asked the
 * message alone, as the app asks it while the hiker is still typing, and
 * compared with the reply the run recorded: written (model-written answer) or
 * quick (a card, small talk, a decline, a location request).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { predictCost } from '@fred/rag-core';
import { openHarness } from './harness.ts';
import { askOptionsFromEnv } from './retrieval-env.ts';

const dir = process.argv[2];
if (dir === undefined) throw new Error('usage: predict-check.ts <runs-dir>');
const h = await openHarness();
const opts = { ...askOptionsFromEnv(), state: process.env.STATE ?? null };
let n = 0, right = 0, saidWritten = 0, wasWritten = 0, both = 0;
const wrong: string[] = [];
for (const f of readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()) {
  let fn = 0, fr = 0;
  for (const line of readFileSync(`${dir}/${f}`, 'utf8').split('\n').filter((l) => l.trim() !== '')) {
    const r = JSON.parse(line) as { question: string; outcome: string; cardAnswer?: string | null; turn?: number };
    const actual = r.outcome === 'answer' && (r.cardAnswer === undefined || r.cardAnswer === null) ? 'written' : 'quick';
    const predicted = await predictCost(r.question, h, opts);
    n++; fn++;
    if (predicted === actual) { right++; fr++; } else wrong.push(`${f.replace('.jsonl', '')} predicted ${predicted}, was ${actual}${r.turn ? ` (turn ${r.turn + 1})` : ''}: "${r.question}"`);
    if (predicted === 'written') saidWritten++;
    if (actual === 'written') wasWritten++;
    if (predicted === 'written' && actual === 'written') both++;
  }
  console.log(`${f.replace('.jsonl', '').padEnd(24)} ${fr}/${fn}`);
}
console.log(`\nright ${right}/${n} (${(100 * right / n).toFixed(1)}%)`);
console.log(`written answers: ${wasWritten}; predicted written ${saidWritten}, of which ${both} were (${wasWritten - both} written answers predicted quick)`);
if (process.env.VERBOSE === '1') console.log(wrong.join('\n'));
await h.close();
