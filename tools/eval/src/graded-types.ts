/**
 * Schema for the free-form graded eval (A-KR2).
 *
 * The proposal (README §04, QR-02) verifies accuracy by giving "an enterprise
 * model a test to administer to Fred, alongside an answer sheet", then deciding
 * "if an answer is acceptable or not". That is a different measurement from
 * `types.ts`, which scores multiple choice under a single-token grammar.
 *
 * The MCQ harness cannot see the failures that actually occur. It constrains
 * output to one letter, so an answer that invents "if bleeding continues after
 * 30 minutes, apply a dressing" scores the same as one that does not. This
 * schema exists to make free-form prose gradeable.
 */
import type { DomainTag } from '@fred/pack-format';
import type { Provenance } from './types.ts';

/**
 * What the pipeline should do with a question.
 *
 * Carrying the non-answer outcomes as first-class expectations is what lets the
 * same file calibrate the abstention gate: a set of only answerable questions
 * can measure accuracy but says nothing about where the threshold belongs,
 * because it contains no case the gate should stop.
 */
export type ExpectedOutcome = 'answer' | 'abstain' | 'needs-location';

export interface GradedQuestion {
  readonly id: string;
  readonly question: string;
  /** USPS code, for state-scoped questions. Null means no location given. */
  readonly state: string | null;
  readonly expect: ExpectedOutcome;
  /**
   * Domains the top chunk may belong to. Empty when `expect` is not 'answer' —
   * there is no correct citation for a question that should be declined.
   */
  readonly domains: readonly DomainTag[];
  /**
   * The answer sheet: points a correct answer must convey. Graded semantically
   * by the judge, not by string matching — "apply firm direct pressure" and
   * "press hard on the wound" are the same point.
   */
  readonly keyPoints: readonly string[];
  /**
   * Content that makes an answer unacceptable however many key points it hits.
   *
   * This field exists because of a defect the key points would have missed
   * entirely. ATP 3-50.21's "Do not -" snakebite list was chunked away from its
   * header, so the indexed text read "Make any deep cuts at the bite site" as an
   * instruction (docs/results-alpha.md). An answer built on that chunk can name
   * every correct step and still tell someone to cut a snakebite open. Grading
   * only for presence of good content cannot detect an inverted instruction.
   */
  readonly redFlags?: readonly string[];
  readonly provenance: Provenance;
  /** Pack expected to supply the answer, for per-corpus reporting. */
  readonly pack: string;
  /** Passage justifying the key points, so verification needs no expertise. */
  readonly cite?: { readonly page: number | null; readonly quote: string };
}

/**
 * The tuning set: 68 questions, and the one every measurement so far was taken
 * on. The scope gate, the lay lexicon, the prompt shape and the abstention
 * threshold were all fitted against it — the threshold with a 0.016 margin —
 * so a score here is a training score and cannot tell improvement from
 * overfitting.
 */
export const GRADED_SETS = [
  'tools/eval/data/graded-firstaid.json',
  'tools/eval/data/graded-survival.json',
  'tools/eval/data/graded-flora-fauna.json',
  'tools/eval/data/graded-negative.json',
  // Added 2026-09-19. The original 68 could not tune the fallback path, because
  // every one of them routed successfully — the set had no case where the
  // lexicon fails, which is exactly the case the held-out set showed dominates.
  // 32 questions using vocabulary the lexicon does not carry, half answerable
  // and half out of scope, so the threshold on that path has something to
  // separate. Being narrow was the original sin; this widens it.
  'tools/eval/data/graded-unknown-vocab.json',
] as const;

/**
 * The held-out set: 40 questions nothing has been tuned against, and the number
 * to quote for A-KR2.
 *
 * Topic choice was taken out of the author's hands on purpose, because the
 * author had already seen every failure in the tuning set and could not unsee
 * them. scripts/build-state-boundaries.mjs has no bearing here; the relevant
 * tool is the sampler recorded in docs/results-holdout.md, which drew sections
 * from the pack databases under a fixed seed after excluding topics the tuning
 * set already covers. The questions were then written from the sampled passage
 * text, not from anything Fred got wrong.
 *
 * Keep it that way. The moment a threshold is fitted to this set it stops being
 * held out, and there is no way to tell from the file that it happened.
 */
export const HOLDOUT_SETS = [
  'tools/eval/data/holdout-firstaid.json',
  'tools/eval/data/holdout-survival.json',
  'tools/eval/data/holdout-flora-fauna.json',
  'tools/eval/data/holdout-negative.json',
] as const;

/**
 * The breadth set (2026-09-27): 57 questions written after every change it is
 * used to judge, to check those changes against topics and phrasings none of
 * them were fitted to. Half from passages drawn at random from the packs
 * (seed 20260927), a third from a general wilderness first-aid and survival
 * syllabus, the rest out of scope. Compared old Fred against new, graded
 * blind (docs/results-breadth.md).
 */
export const BREADTH_SETS = ['tools/eval/data/holdout-breadth.json'] as const;

/**
 * Casual, first-person messages about field-card topics (2026-09-28), written
 * and committed before the cards' plain-language phrasings were added, to
 * judge them. The overlap test keeps any phrasing from copying one.
 */
export const COLLOQUIAL_SETS = ['tools/eval/data/holdout-colloquial.json'] as const;

/**
 * Everyday outdoor questions (2026-09-28, #96), written and committed before any
 * National Park Service or Wikivoyage page was fetched, to judge the tips packs
 * (docs/plan-tips.md). 28 everyday questions, 6 emergencies phrased near tip
 * topics to catch tips crowding out first aid, and 6 Fred should still decline.
 */
export const EVERYDAY_SETS = ['tools/eval/data/holdout-everyday.json'] as const;

/** Which family a run is against. `EVAL_SET=holdout` selects the held-out one. */
export function setsFor(name: string | undefined): readonly string[] {
  switch (name === undefined || name === '' ? 'tuning' : name) {
    case 'tuning': return GRADED_SETS;
    case 'holdout': return HOLDOUT_SETS;
    case 'breadth': return BREADTH_SETS;
    case 'colloquial': return COLLOQUIAL_SETS;
    case 'everyday': return EVERYDAY_SETS;
    case 'all': return [...GRADED_SETS, ...HOLDOUT_SETS];
    default: throw new Error(`EVAL_SET must be tuning | holdout | breadth | colloquial | everyday | all, got "${name}"`);
  }
}

/** One question run through the real pipeline, before grading. */
export interface GradedRun {
  readonly questionId: string;
  readonly question: string;
  /** 'chat' only when intent is on (INTENT=1): small talk, no answer. */
  readonly outcome: ExpectedOutcome | 'chat';
  /** Empty when the pipeline declined. */
  readonly answer: string;
  /** Top fused score U. Drives gate calibration; 0 when nothing was retrieved. */
  readonly topScore: number;
  readonly topDomain: DomainTag | null;
  readonly citations: readonly string[];
  readonly latencyMs: number;
  readonly promptTokens: number;
  /** Why Fred declined, when it did: 'low-score', 'insufficient' or 'provider-only'. */
  readonly abstainReason?: string;
  /** The field card offered folded beside a decline or small talk (INTENT=1), by title. */
  readonly offer?: string;
  /** Set when the answer came from a field card (CARD_ANSWER). */
  readonly cardAnswer?: string;
  /** The manual-wording restatement and its score, when a second search ran (SECOND_SEARCH). */
  readonly secondSearch?: { readonly rewrite: string; readonly topScore: number };
  /** The passages retrieved, best first, with their packs and scores. Absent in runs before 2026-09-25. */
  readonly retrieved?: readonly { readonly packId: string; readonly chunkId: string; readonly section: string; readonly score: number }[];
}

/** The judge's decision on one answer. */
export interface Verdict {
  readonly questionId: string;
  readonly acceptable: boolean;
  /** Key points the judge found conveyed, by index into `keyPoints`. */
  readonly pointsHit: readonly number[];
  /** Red flags the judge found present. Any non-empty list forces a fail. */
  readonly redFlagsHit: readonly number[];
  readonly reasoning: string;
  /**
   * The four-part rubric adopted 2026-09-23 (docs/results-strategy-research.md
   * §2). Optional so verdicts written before it still load; rubric.ts scores
   * a verdict that lacks them from `acceptable` and `redFlagsHit` alone.
   */
  /** Nothing in the answer could hurt someone. A red flag always makes this false. */
  readonly safe?: boolean;
  /** Critical actions from the answer sheet present, in usable order. */
  readonly correctness?: 'full' | 'partial' | 'miss';
  /** It answers what was asked, not the neighbouring topic. */
  readonly onQuestion?: boolean;
  /** Plain words, no "casualty" or "SOURCE 1", calm tone. Never outweighs the rest. */
  readonly soundsLikeFred?: boolean;
}

/**
 * Strict loader. Validation is deliberately noisy: a malformed expectation
 * silently becomes a wrong accuracy number that looks entirely plausible, which
 * is the failure `dataset.ts` was already written to prevent for the MCQ set.
 */
export function loadGradedSet(path: string, read: (p: string) => string): GradedQuestion[] {
  const raw = JSON.parse(read(path)) as unknown;
  if (!Array.isArray(raw)) throw new Error(`${path}: expected a JSON array`);

  const seen = new Set<string>();
  return raw.map((entry, i) => {
    const q = entry as Partial<GradedQuestion>;
    const where = `${path}[${i}]`;
    if (typeof q.id !== 'string' || q.id === '') throw new Error(`${where}: missing id`);
    if (seen.has(q.id)) throw new Error(`${where}: duplicate id "${q.id}"`);
    seen.add(q.id);
    if (typeof q.question !== 'string' || q.question.trim() === '') {
      throw new Error(`${where}: missing question`);
    }
    if (q.expect !== 'answer' && q.expect !== 'abstain' && q.expect !== 'needs-location') {
      throw new Error(`${where}: expect must be answer | abstain | needs-location`);
    }
    if (!Array.isArray(q.keyPoints)) throw new Error(`${where}: keyPoints must be an array`);
    if (q.expect === 'answer' && q.keyPoints.length === 0) {
      throw new Error(`${where}: an answerable question needs at least one key point`);
    }
    if (q.expect !== 'answer' && q.keyPoints.length > 0) {
      throw new Error(`${where}: a declined question must not carry key points`);
    }
    if (!Array.isArray(q.domains)) throw new Error(`${where}: domains must be an array`);
    if (q.expect === 'answer' && q.domains.length === 0) {
      throw new Error(`${where}: an answerable question needs an expected domain`);
    }
    if (q.state !== null && typeof q.state !== 'string') {
      throw new Error(`${where}: state must be a USPS code or null`);
    }
    if (q.expect === 'needs-location' && q.state !== null) {
      throw new Error(`${where}: needs-location requires state to be null`);
    }
    if (q.provenance !== 'corpus-derived' && q.provenance !== 'independent') {
      throw new Error(`${where}: provenance must be corpus-derived | independent`);
    }
    if (typeof q.pack !== 'string' || q.pack === '') throw new Error(`${where}: missing pack`);
    return q as GradedQuestion;
  });
}

/** Composition of a set, so a skewed mix cannot be mistaken for a result. */
export function describeSet(qs: readonly GradedQuestion[]): string {
  const by = (f: (q: GradedQuestion) => string): string =>
    Object.entries(qs.reduce<Record<string, number>>((a, q) => {
      const k = f(q);
      a[k] = (a[k] ?? 0) + 1;
      return a;
    }, {})).sort().map(([k, n]) => `${k}=${n}`).join(' ');
  return `n=${qs.length}  outcome: ${by((q) => q.expect)}  provenance: ${by((q) => q.provenance)}  pack: ${by((q) => q.pack)}`;
}

/**
 * Load grader verdicts and check them against the runs they judge.
 *
 * Grading is done by reading `grading-packet.ts` output, so the verdict file is
 * written by hand rather than emitted by a program. That makes validation matter
 * more, not less: a question silently missing its verdict would quietly shrink
 * the denominator and inflate the score.
 */
export function loadVerdicts(
  path: string,
  read: (p: string) => string,
  questions: ReadonlyMap<string, GradedQuestion>,
  runs: readonly GradedRun[],
): Verdict[] {
  const raw = JSON.parse(read(path)) as { verdicts?: unknown };
  if (!Array.isArray(raw.verdicts)) throw new Error(`${path}: expected a "verdicts" array`);

  const seen = new Set<string>();
  const verdicts = raw.verdicts.map((entry, i) => {
    const v = entry as Partial<Verdict>;
    const where = `${path}.verdicts[${i}]`;
    if (typeof v.questionId !== 'string') throw new Error(`${where}: missing questionId`);
    if (!questions.has(v.questionId)) throw new Error(`${where}: unknown question "${v.questionId}"`);
    if (seen.has(v.questionId)) throw new Error(`${where}: duplicate verdict for "${v.questionId}"`);
    seen.add(v.questionId);
    if (typeof v.acceptable !== 'boolean') throw new Error(`${where}: acceptable must be a boolean`);
    if (!Array.isArray(v.pointsHit) || !Array.isArray(v.redFlagsHit)) {
      throw new Error(`${where}: pointsHit and redFlagsHit must be arrays`);
    }
    // The safety rule is enforced here rather than trusted: a verdict that
    // reports a red flag and still passes the answer has contradicted itself.
    if (v.redFlagsHit.length > 0 && v.acceptable) {
      throw new Error(`${where}: "${v.questionId}" trips red flags ${JSON.stringify(v.redFlagsHit)} but is marked acceptable`);
    }
    const q = questions.get(v.questionId)!;
    for (const n of v.pointsHit) {
      if (typeof n !== 'number' || n < 0 || n >= q.keyPoints.length) {
        throw new Error(`${where}: pointsHit index ${n} is outside 0..${q.keyPoints.length - 1}`);
      }
    }
    for (const n of v.redFlagsHit) {
      if (typeof n !== 'number' || n < 0 || n >= (q.redFlags?.length ?? 0)) {
        throw new Error(`${where}: redFlagsHit index ${n} is outside this question's red flags`);
      }
    }
    return v as Verdict;
  });

  const needed = runs.filter((r) => {
    const q = questions.get(r.questionId);
    return q !== undefined && q.expect === 'answer' && r.outcome === 'answer';
  });
  const missing = needed.filter((r) => !seen.has(r.questionId)).map((r) => r.questionId);
  if (missing.length > 0) {
    throw new Error(`${path}: ${missing.length} answered question(s) have no verdict: ${missing.join(', ')}`);
  }
  return verdicts;
}
