import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import type { FieldCard } from '../src/cards.ts';

/**
 * A card's `askedAs` phrasings are embedded with it, so a phrasing copied from
 * an eval question makes that question retrieve the card by construction and
 * inflates the score it is meant to measure. This happened: the first batch of
 * cards was written after reading the tuning set, and "the person is face down
 * and not responding, can I turn them over" sat beside uv-prone-roll-01.
 *
 * Phrasings must be short, generic ways of naming the topic. This refuses any
 * phrasing sharing half or more of its content words with any tuning or
 * held-out question.
 */
const STOP = new Set("i a the my to of and is it in on do what how can me i'm for with an be are there this that have has so or at".split(' '));
const words = (s: string): Set<string> =>
  new Set((s.toLowerCase().match(/[a-z']+/g) ?? []).filter((w) => !STOP.has(w)));

test('no card phrasing echoes an eval question', () => {
  const cards = JSON.parse(readFileSync('corpora/cards/cards.json', 'utf8')) as FieldCard[];
  // Single-question sets are arrays; two-turn sets (convo-*, holdout-convo)
  // hold conversations, and every turn of those counts as a question too.
  // Intent sets (intent-probe, holdout-intent) hold messages with `text`.
  type Convo = { id: string; turns: { question: string }[] };
  type Message = { id: string; text: string };
  const questions = readdirSync('tools/eval/data')
    .filter((f) => f.startsWith('graded-') || f.startsWith('holdout-') || f.startsWith('convo-') || f.startsWith('intent-'))
    .flatMap((f) => {
      const data = JSON.parse(readFileSync(`tools/eval/data/${f}`, 'utf8')) as
        { id: string; question: string }[] | { conversations: Convo[] } | { messages: Message[] };
      if (Array.isArray(data)) return data;
      if ('messages' in data) return data.messages.map((m) => ({ id: m.id, question: m.text }));
      return data.conversations.flatMap((c) => c.turns.map((t, i) => ({ id: `${c.id}#${i + 1}`, question: t.question })));
    });
  const leaks: string[] = [];
  for (const c of cards) {
    for (const a of c.askedAs) {
      const A = words(a);
      for (const q of questions) {
        const B = words(q.question);
        const inter = [...A].filter((w) => B.has(w)).length;
        const jaccard = inter / Math.max(1, new Set([...A, ...B]).size);
        if (jaccard >= 0.5) leaks.push(`${c.id}: "${a}" ~ ${q.id} (${jaccard.toFixed(2)})`);
      }
    }
  }
  assert.deepEqual(leaks, []);
});
