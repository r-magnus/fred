/**
 * Run the understanding set: conversations of 1-3 messages (docs/plan-understand.md).
 *
 *   node tools/eval/src/run-understand.ts out.jsonl
 *
 * Earlier messages are asked and searched but not generated, as in
 * run-conversations.ts. The last message gets what the app gives it: the
 * previous message as `previous` when Fred answered it (plan-memory.md), and
 * every earlier message as `history`. UNDERSTAND=0 turns the understanding
 * step off; STATE=CA asks as if the hiker were in California.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { ask } from '@fred/rag-core';
import { openHarness } from './harness.ts';
import { askOptionsFromEnv } from './retrieval-env.ts';

interface Conversation {
  readonly id: string;
  readonly kind: string;
  readonly turns: readonly { readonly question: string; readonly state: string | null }[];
  readonly expect: 'answer' | 'abstain' | 'safety-net';
  readonly keyPoints?: readonly string[];
  readonly redFlags?: readonly string[];
  readonly note?: string;
}

const file = process.env.UNDERSTAND_SET ?? 'tools/eval/data/holdout-understand.json';
const conversations = (JSON.parse(readFileSync(file, 'utf8')) as { conversations: Conversation[] }).conversations;
const outPath = process.argv[2] ?? 'docs/understand-runs.jsonl';
const defaultState = process.env.STATE ?? null;
const harness = await openHarness();
const askOptions = askOptionsFromEnv();

/** What the hiker sees, in the set's terms: a safety-net reply is its own outcome. */
const outcomeOf = (r: Awaited<ReturnType<typeof ask>>): string =>
  r.kind === 'abstain' && r.reason === 'safety-net' ? 'safety-net' : r.kind;

const records: object[] = [];
for (const [i, c] of conversations.entries()) {
  const history: string[] = [];
  let previous: { question: string; topScore: number } | undefined;
  const earlier: { question: string; outcome: string }[] = [];
  for (const t of c.turns.slice(0, -1)) {
    const r = await ask(t.question, harness, {
      ...askOptions, state: t.state ?? defaultState,
      ...(previous === undefined ? {} : { previous }),
      ...(history.length === 0 ? {} : { history: [...history] }),
    });
    earlier.push({ question: t.question, outcome: outcomeOf(r) });
    previous = r.kind === 'answer' ? { question: t.question, topScore: r.diagnostics.topScore } : undefined;
    history.push(t.question);
  }
  const last = c.turns.at(-1)!;
  const t0 = Date.now();
  const res = await ask(last.question, harness, {
    ...askOptions, state: last.state ?? defaultState,
    ...(previous === undefined ? {} : { previous }),
    ...(history.length === 0 ? {} : { history }),
  });
  let answer = '';
  if (res.kind === 'answer' && process.env.GENERATE !== '0') for await (const tok of res.stream) answer += tok;
  const d = res.diagnostics;
  const outcome = outcomeOf(res);
  records.push({
    convoId: c.id,
    kind: c.kind,
    earlier,
    question: last.question,
    expect: c.expect,
    outcome,
    answer: answer.trim(),
    ...(res.kind === 'abstain' ? { abstainReason: res.reason } : {}),
    ...(res.kind === 'abstain' || res.kind === 'chat' ? { reply: 'text' in res ? res.text : res.kind === 'chat' ? res.reply : '' } : {}),
    ...((res.kind === 'abstain' || res.kind === 'chat') && res.offer != null ? { offer: res.offer.title } : {}),
    topScore: d.topScore,
    intent: d.intent ?? null,
    ...(d.understood === undefined ? {} : { understood: d.understood }),
    cardAnswer: d.cardAnswer ?? null,
    citations: res.kind === 'answer'
      ? res.citations.map((x) => `${x.source}${x.page === null ? '' : ` p.${x.page}`} — ${x.section}`)
      : [],
    latencyMs: Date.now() - t0,
    keyPoints: c.keyPoints ?? [],
    redFlags: c.redFlags ?? [],
    ...(c.note === undefined ? {} : { note: c.note }),
  });
  const ok = outcome === c.expect || (c.expect === 'abstain' && (outcome === 'chat' || outcome === 'abstain'));
  console.log(`[${String(i + 1).padStart(2)}/${conversations.length}] ${ok ? 'ok  ' : 'DIFF'} ${c.id.padEnd(20)} expect=${c.expect.padEnd(10)} got=${outcome.padEnd(14)} U=${d.topScore.toFixed(3)} ${d.intent ?? ''}${d.understood === undefined ? '' : ` understood="${d.understood.request}"`}`);
}
writeFileSync(outPath, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
const ok = records.filter((r) => {
  const x = r as { outcome: string; expect: string };
  return x.outcome === x.expect || (x.expect === 'abstain' && (x.outcome === 'chat' || x.outcome === 'abstain'));
}).length;
console.log(`\nwrote ${records.length} to ${outPath}; outcome matches ${ok}/${records.length}`);
await harness.close();
