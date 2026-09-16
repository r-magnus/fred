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

/** One question run through the real pipeline, before grading. */
export interface GradedRun {
  readonly questionId: string;
  readonly question: string;
  readonly outcome: ExpectedOutcome;
  /** Empty when the pipeline declined. */
  readonly answer: string;
  /** Top fused score U. Drives gate calibration; 0 when nothing was retrieved. */
  readonly topScore: number;
  readonly topDomain: DomainTag | null;
  readonly citations: readonly string[];
  readonly latencyMs: number;
  readonly promptTokens: number;
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
