/**
 * #286: what a hiker gets for each choice of a question back. Reads a run
 * (run-graded.ts with ASKBACK=1) and asks every kept choice as the next
 * message, the declined one before it, as the app does on a tap. Writes one
 * line per choice: the outcome, what answered it and the answer's words.
 *
 *   node tools/eval/src/ask-back-taps.ts <run.jsonl> <out.jsonl>
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { ask } from '@fred/rag-core';
import { openHarness } from './harness.ts';
import { askOptionsFromEnv } from './retrieval-env.ts';

const [inPath, outPath] = process.argv.slice(2) as [string, string];
const runs = readFileSync(inPath, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as { questionId?: string; question: string; askBack?: { kept: string[] } });
const harness = await openHarness();
const { backend, store, packs } = harness;
const opts = askOptionsFromEnv();
const state = process.env.STATE ?? null;
writeFileSync(outPath, '');
for (const r of runs) {
  for (const choice of r.askBack?.kept ?? []) {
    const res = await ask(choice, { backend, store, packs }, { ...opts, state, ...(process.env.HISTORY === '0' ? {} : { history: [r.question] }) });
    let answer = '';
    if (res.kind === 'answer' && (process.env.GENERATE !== '0' || res.card !== undefined)) for await (const t of res.stream) answer += t;
    const rec = {
      questionId: r.questionId, question: r.question, choice, outcome: res.kind,
      ...(res.kind === 'abstain' ? { reason: res.reason, askBack: res.askBack ?? null } : {}),
      ...(res.kind === 'chat' ? { reply: res.reply } : {}),
      by: res.kind === 'answer' ? res.citations.map((c) => `${c.source} — ${c.section}`).slice(0, 2) : [],
      card: res.diagnostics.cardAnswer ?? null, answer: answer.trim(),
    };
    appendFileSync(outPath, JSON.stringify(rec) + '\n');
    console.log(`${res.kind.padEnd(8)} ${choice}`);
  }
}
harness.close?.();
