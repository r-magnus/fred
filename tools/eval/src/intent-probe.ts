/**
 * When does a field card fire? (docs/results-intent-probe.md)
 *
 *   node tools/eval/src/intent-probe.ts [out.json]
 *
 * Runs tools/eval/data/intent-probe.json through ask() without generating:
 * whether a card is shown word for word is decided before any text is
 * written, so this takes seconds. Reports, per label, how often a card fired,
 * the model would have answered from passages, or Fred declined.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { ask } from '@fred/rag-core';
import { openHarness } from './harness.ts';
import { askOptionsFromEnv } from './retrieval-env.ts';

interface Probe { id: string; label: string; state: string | null; text: string }
const set = JSON.parse(readFileSync('tools/eval/data/intent-probe.json', 'utf8')) as { messages: Probe[] };
const h = await openHarness();
const opts = askOptionsFromEnv();
const rows: { id: string; label: string; text: string; result: string; card: string | null; top: number }[] = [];
for (const m of set.messages) {
  const r = await ask(m.text, h, { ...opts, state: m.state });
  const card = r.kind === 'answer' && r.diagnostics.cardAnswer !== undefined ? r.citations[0]!.section : null;
  const result = card !== null ? 'card' : r.kind === 'answer' ? 'model' : r.kind;
  rows.push({ id: m.id, label: m.label, text: m.text, result, card, top: Number(r.diagnostics.topScore.toFixed(3)) });
}
await h.close();
for (const label of ['no-card', 'prevention', 'card', 'either']) {
  const rs = rows.filter((r) => r.label === label);
  const count = (k: string): number => rs.filter((r) => r.result === k).length;
  console.log(`\n${label} (${rs.length}): card ${count('card')}, model ${count('model')}, declined ${count('abstain') + count('needs-location')}`);
  for (const r of rs) console.log(`  ${r.result.padEnd(14)} ${String(r.top).padEnd(6)} ${(r.card ?? '').padEnd(32)} ${r.text}`);
}
writeFileSync(process.argv[2] ?? 'docs/intent-probe-runs.json', JSON.stringify(rows, null, 1) + '\n');
