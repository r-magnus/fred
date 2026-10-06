/**
 * The opening line alone (#130): what the model writes for each message and
 * whether the check keeps it. OPENER_SET=sealed runs tools/eval/data/opener.json
 * (once, at the end); otherwise the practice messages below, which the prompt
 * was tuned on.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { explainOpener, dangerSign, type InferenceBackend } from '@fred/rag-core';
import { openHarness } from './harness.ts';

interface Msg { id: string; kind: string; question: string; history?: string[] }
const PRACTICE: Msg[] = [
  'how do i hang a hammock between trees', 'what birds are those black ones with red wings', 'how do i read a topo map',
  'my calves keep cramping up on the climb', 'i scraped my knee on some rocks', 'my shoulders are sore from my pack',
  'i got poison oak on my arm i think', 'we ran out of snacks and everyone is grumpy', 'so tired, we still have a long way to go',
  'it is so cold tonight i cant sleep', 'just made it to the summit!', 'my dog is panting a lot in this heat',
  'are these mushrooms ok to eat', 'is the water from this creek ok to drink', 'how far is too far to hike in a day',
  'there is a rattlesnake on the trail ahead', 'we heard wolves howling last night', 'my headlamp died, how do i get back',
].map((question, i) => ({ id: `p-${i + 1}`, kind: 'practice', question }));

const msgs: Msg[] = process.env.OPENER_SET !== undefined
  ? (JSON.parse(readFileSync(`tools/eval/data/${process.env.OPENER_SET === 'sealed' ? 'opener' : process.env.OPENER_SET}.json`, 'utf8')) as { questions: Msg[] }).questions
  : PRACTICE;
const h = await openHarness();
const backend: InferenceBackend = h.backend;
const { makeOpenerRaw } = await import('./opener-raw.ts');
const rows = [];
for (const m of msgs) {
  const earlier = m.history ?? [];
  const skipped = dangerSign([...earlier, m.question]);
  const raw = skipped ? '' : await makeOpenerRaw(m.question, earlier, backend);
  const verdict = skipped ? { line: null } : explainOpener(raw, [...earlier.slice(-2), m.question]);
  const kept = verdict.line;
  rows.push({ id: m.id, kind: m.kind, question: m.question, skipped, raw, kept, ...(verdict.why === undefined ? {} : { why: verdict.why }) });
  console.log(`${skipped ? 'SKIP' : kept === null ? 'DROP' : 'KEEP'} ${m.question.slice(0, 50).padEnd(50)} | ${raw}${verdict.why === undefined ? '' : `  [${verdict.why}]`}`);
}
await h.close();
const tried = rows.filter((r) => !r.skipped);
console.log(`\nkept ${tried.filter((r) => r.kept !== null).length} of ${tried.length} tried; ${rows.length - tried.length} skipped (danger sign)`);
writeFileSync(process.argv[2] ?? '/dev/null', JSON.stringify(rows, null, 1) + '\n');
