/**
 * Run chat sets turn by turn, as the phone app asks them (#98 round 2,
 * docs/plan-understand-2.md).
 *
 *   node tools/eval/src/run-chats.ts out.jsonl [set.json ...]
 *
 * Every turn is asked with what App.tsx passes: the previous message when Fred
 * answered it, and the last CONDITION_HISTORY messages as `history`. A chat
 * with a `variant` is also run in its second wording. Answers are generated
 * (GENERATE=0 skips it, for decision-only runs). Run with INTENT=1 and the
 * phone's packs (PACKS_DIR) to match the app. STATE=CA asks as if the hiker
 * were in California.
 *
 * Prints one line per turn and a count of turns whose outcome breaks their
 * expectation. The outcome check is only the kind of reply; key points and
 * the chat's unsafe list are graded blind afterwards (score-chats.ts).
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { ask, isRefusal, CONDITION_HISTORY } from '@fred/rag-core';
import { openHarness } from './harness.ts';
import { askOptionsFromEnv } from './retrieval-env.ts';

export type Expect = 'answer' | 'help-now' | 'no-dead-end' | 'not-urgent' | 'not-chat' | 'decline' | 'chat' | 'any';
/** What the hiker sees, in the sets' terms. */
export type Outcome = 'answer' | 'help-now' | 'watch' | 'decline' | 'chat' | 'refer' | 'needs-location';

interface Chat {
  readonly id: string;
  readonly kind: string;
  readonly turns: readonly { readonly q: string; readonly expect: Expect; readonly keyPoints?: readonly string[] }[];
  readonly unsafe: readonly string[];
  readonly variant?: readonly string[];
}

/** Whether an outcome can pass an expectation (the reply's content is graded separately). */
export function outcomeFits(expect: Expect, outcome: Outcome): boolean {
  switch (expect) {
    case 'answer': return outcome === 'answer';
    case 'help-now': return outcome === 'answer' || outcome === 'help-now';
    case 'no-dead-end': return outcome !== 'decline' && outcome !== 'chat';
    case 'not-urgent': return outcome !== 'help-now';
    case 'not-chat': return outcome !== 'chat';
    case 'decline': return outcome === 'decline' || outcome === 'chat' || outcome === 'refer';
    case 'chat': return outcome !== 'help-now';
    case 'any': return true;
  }
}

const outPath = process.argv[2] ?? 'chat-runs.jsonl';
const sets = process.argv.length > 3 ? process.argv.slice(3) : ['tools/eval/data/holdout-chats.json'];
const defaultState = process.env.STATE ?? null;
const generate = process.env.GENERATE !== '0';
const harness = await openHarness();
const askOptions = askOptionsFromEnv();

// Each turn is written as it finishes, so a run that is stopped keeps what it did.
writeFileSync(outPath, '');
const records: object[] = [];
let misses = 0;
let turnsRun = 0;
for (const set of sets) {
  const all = (JSON.parse(readFileSync(set, 'utf8')) as { chats: Chat[] }).chats;
  // CHAT_IDS=a,b runs only those chats, e.g. the ones a decision sweep saw change.
  const chats = process.env.CHAT_IDS === undefined ? all : all.filter((c) => process.env.CHAT_IDS!.split(',').includes(c.id));
  for (const c of chats) {
    const wordings: (readonly string[])[] = [c.turns.map((t) => t.q), ...(c.variant === undefined ? [] : [c.variant])];
    for (const [w, qs] of wordings.entries()) {
      const asked: { q: string; kind: string; topScore: number }[] = [];
      let lastCard: string | undefined;
      let lastWasPet = false;
      for (const [i, q] of qs.entries()) {
        const turn = c.turns[i]!;
        const last = asked.at(-1);
        const previous = last !== undefined && last.kind === 'answer' ? { question: last.q, topScore: last.topScore } : undefined;
        const history = asked.slice(-CONDITION_HISTORY).map((a) => a.q);
        const t0 = Date.now();
        const r = await ask(q, harness, {
          ...askOptions, state: defaultState,
          ...(previous === undefined ? {} : { previous }),
          ...(history.length === 0 ? {} : { history }),
          ...(lastCard === undefined ? {} : { lastCard }),
          ...(lastWasPet ? { previousWasPet: true } : {}),
        });
        const decideMs = Date.now() - t0;
        let text = '';
        if (r.kind === 'answer' && (generate || r.card !== undefined)) for await (const tok of r.stream) text += tok;
        // #130: the opening line is recorded apart, so the answer compares word for word.
        const opener = r.kind === 'answer' ? r.opener?.text ?? undefined : undefined;
        if (opener != null && text.startsWith(`${opener}\n`)) text = text.slice(opener.length + 1);
        const refused = r.kind === 'answer' && generate && isRefusal(text);
        const outcome: Outcome =
          r.kind === 'answer' ? (refused ? 'decline' : 'answer')
          : r.kind === 'chat' ? 'chat'
          : r.kind === 'needs-location' ? 'needs-location'
          : r.reason === 'safety-net' ? 'help-now'
          : r.reason === 'watch' ? 'watch'
          : r.reason === 'provider-only' ? 'refer'
          : 'decline';
        const d = r.diagnostics;
        const fits = outcomeFits(turn.expect, outcome);
        if (!fits) misses++;
        turnsRun++;
        const offer = (r.kind === 'abstain' || r.kind === 'chat') && r.offer != null ? r.offer.title
          : r.kind === 'answer' && r.card !== undefined ? r.card.title : undefined;
        const rec = {
          set, chatId: c.id, kind: c.kind, wording: w, turn: i, question: q, expect: turn.expect, outcome, fits,
          answer: text.trim(),
          ...(opener == null ? {} : { opener }),
          ...(r.kind === 'chat' ? { reply: r.reply } : {}),
          ...(r.kind === 'abstain' ? { abstainReason: r.reason } : {}),
          ...(r.kind === 'abstain' && r.lead !== undefined ? { lead: r.lead } : {}),
          ...(r.kind === 'abstain' && r.decline !== undefined ? { decline: r.decline } : {}),
          ...(offer === undefined ? {} : { offer }),
          citations: r.kind === 'answer' ? r.citations.map((x) => `${x.source} — ${x.section}`) : [],
          cardAnswer: d.cardAnswer ?? null,
          topScore: d.topScore, intent: d.intent ?? null,
          ...(d.understood === undefined ? {} : { understood: d.understood }),
          ...(d.conditions === undefined ? {} : { conditions: d.conditions }),
          ...(d.blocked === undefined ? {} : { blocked: d.blocked }),
          ...(d.agreedCard === undefined ? {} : { agreedCard: d.agreedCard }),
          ...(d.repeatHeld === undefined ? {} : { repeatHeld: d.repeatHeld }),
          ...(d.followUp === undefined ? {} : { followUp: d.followUp }),
          ...(d.scope === undefined ? {} : { scope: d.scope }),
          ...(d.said === undefined ? {} : { said: d.said }),
          ...(d.everyday === undefined ? {} : { everyday: d.everyday }),
          ...(d.answerGuard?.refused === true ? { modelRefused: true } : {}),
          ...(d.nearSentence === undefined ? {} : { nearSentence: { similarity: Number(d.nearSentence.similarity.toFixed(3)), text: d.nearSentence.text } }),
          ...(d.answerGuard?.replacedBy === undefined ? {} : { guardedBy: d.answerGuard.replacedBy }),
          keyPoints: turn.keyPoints ?? [], unsafe: c.unsafe,
          decideMs, timing: d.timing ?? null,
        };
        records.push(rec);
        appendFileSync(outPath, JSON.stringify(rec) + '\n');
        const where = r.kind === 'answer' ? ` ${d.cardAnswer ? 'card' : 'gen'}=${r.citations[0]?.section ?? ''}` : offer === undefined ? '' : ` offer=${offer}`;
        console.log(`${fits ? 'ok  ' : 'MISS'} ${c.id}${w > 0 ? "'" : ''}#${i + 1} ${turn.expect.padEnd(11)} ${outcome.padEnd(9)} U=${d.topScore.toFixed(3)} ${d.intent ?? ''}${where}  "${q}"`);
        asked.push({ q, kind: r.kind === 'answer' && !refused ? 'answer' : r.kind, topScore: d.topScore });
        lastWasPet = d.said?.pet === true;
        // As App.tsx: the card shown, when the reply was a field card.
        lastCard = r.kind === 'answer' && !refused && r.citations[0]?.source === 'Fred field card' ? r.citations[0].section : undefined;
      }
    }
  }
}
console.log(`\nwrote ${records.length} turns to ${outPath}; outcome misses ${misses}/${turnsRun}`);
await harness.close();
