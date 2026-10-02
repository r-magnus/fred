/**
 * Run two-turn conversations through the real pipeline (docs/plan-memory.md).
 *
 *   CONVO_SET=follow-up,switch,oos node tools/eval/src/run-conversations.ts out.jsonl
 *
 * Sets: follow-up, switch, oos (tools/eval/data/convo-*.json), holdout
 * (holdout-convo.json, run once at the end), and regression: every tuning
 * question with an unrelated first turn, to show memory leaves single
 * questions alone.
 *
 * The first turn is searched but not generated: memory passes the earlier
 * *question* only, never the answer, so generating it would cost minutes and
 * change nothing. Its outcome and any field card it would show are recorded,
 * so a second turn that repeats the same card can be counted.
 *
 * MEMORY=0 answers the second turn alone, which is today's behaviour and the
 * baseline memory has to beat. PROMPT_MEMORY=0 keeps the search half only.
 * Each record carries the second turn's answer sheet, so grading needs nothing
 * else.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { ask, type AskResult } from '@fred/rag-core';
import { openHarness } from './harness.ts';
import { GRADED_SETS, HOLDOUT_SETS, loadGradedSet, type ExpectedOutcome, type GradedQuestion } from './graded-types.ts';
import { askOptionsFromEnv } from './retrieval-env.ts';

interface Turn { readonly question: string; readonly state: string | null }
interface Conversation {
  readonly id: string;
  readonly kind: 'follow-up' | 'switch' | 'oos-follow-up' | 'regression';
  readonly turns: readonly [Turn, Turn];
  readonly expect: ExpectedOutcome;
  readonly sheet?: string;
  readonly keyPoints?: readonly string[];
  readonly redFlags?: readonly string[];
}

const read = (p: string): string => readFileSync(p, 'utf8');
const sheets = new Map<string, GradedQuestion>(
  [...GRADED_SETS, ...HOLDOUT_SETS].flatMap((s) => loadGradedSet(s, read)).map((q) => [q.id, q]),
);
const tuning = GRADED_SETS.flatMap((s) => loadGradedSet(s, read));

const FILES: Record<string, string> = {
  'follow-up': 'tools/eval/data/convo-follow-up.json',
  switch: 'tools/eval/data/convo-switch.json',
  oos: 'tools/eval/data/convo-oos.json',
  holdout: 'tools/eval/data/holdout-convo.json',
};

/**
 * Every tuning question after an unrelated opener. Survival and plant
 * questions follow a blister question; everything else follows a tarp knot.
 */
function regression(): Conversation[] {
  const blister = sheets.get('fa-blister-01')!.question;
  const knot = sheets.get('sv-knot-01')!.question;
  return tuning.filter((q) => q.id !== 'fa-blister-01' && q.id !== 'sv-knot-01').map((q) => ({
    id: `rg-${q.id}`,
    kind: 'regression' as const,
    turns: [{ question: /^(sv|ff)-/.test(q.id) ? blister : knot, state: q.state }, { question: q.question, state: q.state }] as const,
    expect: q.expect,
    sheet: q.id,
  }));
}

const setNames = (process.env.CONVO_SET ?? 'follow-up,switch,oos').split(',');
const conversations: Conversation[] = setNames.flatMap((n) => {
  if (n === 'regression') return regression();
  const file = FILES[n];
  if (file === undefined) throw new Error(`unknown CONVO_SET ${n}; use ${[...Object.keys(FILES), 'regression'].join(', ')}`);
  return (JSON.parse(read(file)) as { conversations: Conversation[] }).conversations;
});

// CONVO_IDS=a,b runs only those conversations, e.g. the ones a sweep saw change.
const onlyIds = process.env.CONVO_IDS?.split(',');
if (onlyIds !== undefined) conversations.splice(0, conversations.length, ...conversations.filter((c) => onlyIds.includes(c.id)));
const memoryOn = process.env.MEMORY !== '0';
const outPath = process.argv[2] ?? 'docs/convo-runs.jsonl';
console.log(`${conversations.length} conversations (${setNames.join(', ')}), memory ${memoryOn ? 'on' : 'off'}`
  + `${process.env.PROMPT_MEMORY === '0' ? ' (search only)' : ''}`);

const harness = await openHarness();
const askOptions = askOptionsFromEnv();

/** The card a result would show word for word, if any. */
const cardOf = (r: AskResult): string | null =>
  r.kind === 'answer' && r.diagnostics.cardAnswer !== undefined ? r.citations[0]?.chunkId ?? null : null;

const records: object[] = [];
for (const [i, c] of conversations.entries()) {
  const [t1, t2] = c.turns;
  const first = await ask(t1.question, harness, { ...askOptions, state: t1.state });
  const t0 = Date.now();
  const res = await ask(t2.question, harness, {
    ...askOptions,
    state: t2.state,
    ...(memoryOn ? { previous: { question: t1.question, topScore: first.diagnostics.topScore }, history: [t1.question] } : {}),
  });
  let answer = '';
  // GENERATE=0 records the decision only, for a quick sweep (as run-graded.ts).
  if (res.kind === 'answer' && (process.env.GENERATE !== '0' || res.card !== undefined)) for await (const tok of res.stream) answer += tok;
  const d = res.diagnostics;
  const sheet = c.sheet === undefined ? undefined : sheets.get(c.sheet);
  if (c.sheet !== undefined && sheet === undefined) throw new Error(`${c.id}: no answer sheet ${c.sheet}`);
  const card1 = cardOf(first), card2 = cardOf(res);

  records.push({
    convoId: c.id,
    kind: c.kind,
    turn1: { question: t1.question, outcome: first.kind, card: card1 },
    question: t2.question,
    state: t2.state,
    expect: c.expect,
    outcome: res.kind,
    answer: answer.trim(),
    ...(res.kind === 'abstain' ? { abstainReason: res.reason } : {}),
    topScore: d.topScore,
    followUp: d.followUp ?? null,
    ...(d.understood === undefined ? {} : { understood: d.understood }),
    cardAnswer: card2,
    cardRepeat: card2 !== null && card2 === card1,
    ...(res.kind === 'answer' && res.card !== undefined ? { offer: res.card.title } : {}),
    citations: res.kind === 'answer'
      ? res.citations.map((x) => `${x.source}${x.page === null ? '' : ` p.${x.page}`} — ${x.section}`)
      : [],
    latencyMs: Date.now() - t0,
    sheet: c.sheet ?? null,
    keyPoints: c.keyPoints ?? sheet?.keyPoints ?? [],
    redFlags: c.redFlags ?? sheet?.redFlags ?? [],
  });

  const joined = d.followUp === undefined ? '' : ` alone=${d.followUp.standaloneTopScore.toFixed(3)} joined=${d.followUp.joinedTopScore.toFixed(3)}${d.followUp.used ? ' USED' : ''}`;
  console.log(`[${String(i + 1).padStart(3)}/${conversations.length}] ${res.kind === c.expect ? 'ok  ' : 'DIFF'} ${c.id.padEnd(22)} `
    + `expect=${c.expect.padEnd(14)} got=${res.kind.padEnd(14)} U=${d.topScore.toFixed(3)}${joined}`
    + `${card2 !== null && card2 === card1 ? ' CARD-REPEAT' : ''}`);
}

writeFileSync(outPath, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
const agree = records.filter((r) => (r as { outcome: string; expect: string }).outcome === (r as { expect: string }).expect).length;
console.log(`\nwrote ${records.length} conversations to ${outPath}; outcome matches expectation ${agree}/${records.length}`);
await harness.close();
