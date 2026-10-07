/**
 * Ask a few messages and print what Fred decides and what the search found.
 *
 *   node tools/eval/src/probe.ts messages.txt
 *
 * One chat per line, turns separated by " / ". Lines starting with # are
 * skipped. Asked as the app asks them (run-chats.ts): the previous message
 * when Fred answered it, the earlier messages as history, the card last
 * shown. No answer is generated; a card's text is not printed.
 */
import { readFileSync } from 'node:fs';
import { ask, dangerSign, CONDITION_HISTORY } from '@fred/rag-core';
import { openHarness } from './harness.ts';
import { askOptionsFromEnv } from './retrieval-env.ts';

const file = process.argv[2];
if (file === undefined) throw new Error('usage: probe.ts messages.txt');
const chats = readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'))
  .map((l) => l.split(' / '));
const harness = await openHarness();
const askOptions = askOptionsFromEnv();
const state = process.env.STATE ?? null;

for (const turns of chats) {
  const asked: { q: string; kind: string; topScore: number }[] = [];
  let lastCard: string | undefined;
  for (const q of turns) {
    const last = asked.at(-1);
    const previous = last !== undefined && last.kind === 'answer' ? { question: last.q, topScore: last.topScore } : undefined;
    const history = asked.slice(-CONDITION_HISTORY).map((a) => a.q);
    const r = await ask(q, harness, {
      ...askOptions, state,
      ...(previous === undefined ? {} : { previous }),
      ...(history.length === 0 ? {} : { history }),
      ...(lastCard === undefined ? {} : { lastCard }),
    });
    const d = r.diagnostics;
    const what = r.kind === 'answer' ? (d.cardAnswer ? `CARD ${r.citations[0]?.section ?? ''}` : `MODEL from ${r.citations.map((c) => c.section).join(' | ')}`)
      : r.kind === 'chat' ? `CHAT${r.offer ? ` offer=${r.offer.title}` : ''}`
      : r.kind === 'needs-location' ? 'NEEDS-LOCATION'
      : `${r.reason.toUpperCase()}${r.offer ? ` offer=${r.offer.title}` : ''}`;
    console.log(`\n"${q}"${asked.length > 0 ? `  (turn ${asked.length + 1})` : ''}`);
    console.log(`  -> ${what}`);
    console.log(`  intent=${d.intent ?? '-'} top=${d.topScore.toFixed(3)} danger=${dangerSign([...history, q])}` +
      `${d.scope ? ` scope=${d.scope.z.toFixed(2)}[${d.scope.used.join(',')}]` : ''}` +
      `${d.conditions ? ` conditions=${d.conditions.join(',')}` : ''}${d.agreedCard ? ` agreed=${d.agreedCard}` : ''}` +
      `${d.understood ? ` understood="${d.understood.request}"${d.understood.used ? ' (used)' : ''}` : ''}`);
    for (const c of [...(d.candidates ?? [])].sort((a, b) => b.score - a.score).slice(0, 4)) {
      console.log(`     ${c.score.toFixed(3)} ${c.chunk.packId} | ${c.chunk.section.slice(0, 70)}`);
    }
    asked.push({ q, kind: r.kind, topScore: d.topScore });
    lastCard = r.kind === 'answer' && r.citations[0]?.source === 'Fred field card' ? r.citations[0].section : undefined;
  }
}
await harness.close();
