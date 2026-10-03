import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadGradedSet, describeSet, GRADED_SETS, HOLDOUT_SETS, BREADTH_SETS, EVERYDAY_SETS, setsFor } from '../src/graded-types.ts';

const read = (p: string): string => readFileSync(p, 'utf8');
const SETS = [
  'tools/eval/data/graded-firstaid.json',
  'tools/eval/data/graded-survival.json',
  'tools/eval/data/graded-flora-fauna.json',
  'tools/eval/data/graded-negative.json',
  'tools/eval/data/graded-unknown-vocab.json',
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

/**
 * The held-out set only means anything while it stays separate from the set
 * everything was tuned on. These guard that property, because nothing about the
 * files themselves would reveal that it had been broken.
 */
test('every holdout set parses', () => {
  for (const path of HOLDOUT_SETS) {
    const qs = loadGradedSet(path, read);
    assert.ok(qs.length > 0, `${path} is empty`);
  }
});

test('no question appears in both the tuning and holdout sets', () => {
  const ids = new Map<string, string>();
  for (const path of [...GRADED_SETS, ...HOLDOUT_SETS]) {
    for (const q of loadGradedSet(path, read)) {
      const clash = ids.get(q.id);
      assert.equal(clash, undefined, `id "${q.id}" is in both ${clash} and ${path}`);
      ids.set(q.id, path);
    }
  }

  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const tuning = new Set(GRADED_SETS.flatMap((p) => loadGradedSet(p, read)).map((q) => norm(q.question)));
  for (const path of HOLDOUT_SETS) {
    for (const q of loadGradedSet(path, read)) {
      assert.ok(!tuning.has(norm(q.question)), `"${q.question}" is already in the tuning set`);
    }
  }
});

test('setsFor selects a family and rejects anything else', () => {
  assert.deepEqual(setsFor(undefined), GRADED_SETS);
  assert.deepEqual(setsFor('tuning'), GRADED_SETS);
  assert.deepEqual(setsFor('holdout'), HOLDOUT_SETS);
  assert.equal(setsFor('all').length, GRADED_SETS.length + HOLDOUT_SETS.length);
  assert.deepEqual(setsFor('breadth'), BREADTH_SETS);
  assert.deepEqual(setsFor('everyday'), EVERYDAY_SETS);
  assert.throws(() => setsFor('graded'), /tuning \| holdout \| breadth \| colloquial \| everyday \| health \| health-confirm \| ailments \| wildlife \| hazards \| states \| grounded-confirm \| all/);
});

test('the holdout set covers every corpus and both non-answer outcomes', () => {
  const qs = HOLDOUT_SETS.flatMap((p) => loadGradedSet(p, read));
  for (const pack of ['core-firstaid-army', 'core-firstaid', 'core-survival',
                      'state-CA-flora-fauna', 'state-OR-flora-fauna']) {
    assert.ok(qs.some((q) => q.pack === pack), `no holdout question for ${pack}`);
  }
  assert.ok(qs.some((q) => q.expect === 'abstain'), 'no abstain case');
  assert.ok(qs.some((q) => q.expect === 'needs-location'), 'no needs-location case');
});
