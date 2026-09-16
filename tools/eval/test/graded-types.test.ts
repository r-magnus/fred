import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadGradedSet, describeSet } from '../src/graded-types.ts';

const read = (p: string): string => readFileSync(p, 'utf8');
const SETS = [
  'tools/eval/data/graded-firstaid.json',
  'tools/eval/data/graded-survival.json',
  'tools/eval/data/graded-flora-fauna.json',
  'tools/eval/data/graded-negative.json',
];

/** Load from an inline string, so validation is tested without touching disk. */
function loadInline(json: string): ReturnType<typeof loadGradedSet> {
  return loadGradedSet('inline', () => json);
}

const VALID = {
  id: 'x-1',
  question: 'How do I control severe external bleeding?',
  state: null,
  expect: 'answer',
  domains: ['first-aid-physical'],
  keyPoints: ['Apply firm direct pressure'],
  provenance: 'corpus-derived',
  pack: 'core-firstaid-army',
};

test('every shipped graded set parses', () => {
  for (const s of SETS) {
    const qs = loadGradedSet(s, read);
    assert.ok(qs.length > 0, `${s} is empty`);
  }
});

test('the combined set spans all five packs and both outcomes', () => {
  const qs = SETS.flatMap((s) => loadGradedSet(s, read));
  const packs = new Set(qs.map((q) => q.pack));
  for (const p of [
    'core-firstaid', 'core-firstaid-army', 'core-survival',
    'state-CA-flora-fauna', 'state-OR-flora-fauna',
  ]) {
    assert.ok(packs.has(p), `no question targets ${p}`);
  }
  // A set with no unanswerable questions cannot calibrate a gate, whatever its
  // accuracy says — the threshold would have nothing to be wrong about.
  assert.ok(qs.some((q) => q.expect === 'abstain'), 'no abstain cases');
  assert.ok(qs.some((q) => q.expect === 'needs-location'), 'no needs-location cases');
  assert.ok(qs.some((q) => q.provenance === 'independent'), 'no independent questions');
  assert.ok(qs.some((q) => q.provenance === 'corpus-derived'), 'no corpus-derived questions');
});

test('ids are unique across the shipped sets', () => {
  const qs = SETS.flatMap((s) => loadGradedSet(s, read));
  const ids = new Set(qs.map((q) => q.id));
  assert.equal(ids.size, qs.length, 'duplicate id across files');
});

test('red flags exist on the questions whose corpus passages invert', () => {
  const qs = SETS.flatMap((s) => loadGradedSet(s, read));
  // These are the cases docs/results-alpha.md records as having been stored with
  // their polarity stripped. If a future edit drops their red flags, an answer
  // telling someone to cut a snakebite open would score as acceptable.
  for (const id of ['fa-snake-01', 'sv-plant-01', 'sv-plant-02']) {
    const q = qs.find((x) => x.id === id);
    assert.ok(q, `${id} missing from the set`);
    assert.ok((q.redFlags?.length ?? 0) > 0, `${id} must carry red flags`);
  }
});

test('an answerable question must carry key points and a domain', () => {
  assert.throws(() => loadInline(JSON.stringify([{ ...VALID, keyPoints: [] }])), /key point/);
  assert.throws(() => loadInline(JSON.stringify([{ ...VALID, domains: [] }])), /expected domain/);
});

test('a declined question must not carry key points', () => {
  // Otherwise a question could be scored both ways: declined by outcome and
  // graded on content the judge never saw.
  assert.throws(
    () => loadInline(JSON.stringify([{ ...VALID, expect: 'abstain', domains: [], keyPoints: ['x'] }])),
    /must not carry key points/,
  );
});

test('needs-location requires no state to have been given', () => {
  assert.throws(
    () => loadInline(JSON.stringify([{ ...VALID, expect: 'needs-location', domains: [], keyPoints: [], state: 'CA' }])),
    /state to be null/,
  );
});

test('duplicate ids and bad enums are rejected', () => {
  assert.throws(() => loadInline(JSON.stringify([VALID, VALID])), /duplicate id/);
  assert.throws(() => loadInline(JSON.stringify([{ ...VALID, expect: 'maybe' }])), /expect must be/);
  assert.throws(() => loadInline(JSON.stringify([{ ...VALID, provenance: 'vibes' }])), /provenance must be/);
});

test('describeSet reports composition rather than just a count', () => {
  const d = describeSet(loadInline(JSON.stringify([VALID])));
  assert.match(d, /n=1/);
  assert.match(d, /answer=1/);
  assert.match(d, /corpus-derived=1/);
});
