/** Evaluation schema for the ablation ladder. */
import type { DomainTag } from '@fred/pack-format';

/**
 * Where a question came from, which changes what a score means.
 *
 * 'corpus-derived' questions are written from the indexed corpus, matching
 * PocketRAG's methodology and directly comparable to its Table 1. They measure
 * retrieval and reading comprehension.
 *
 * 'independent' questions are written from general first-aid knowledge without
 * consulting the corpus. They catch the failure mode corpus-derived sets cannot
 * see: retrieval succeeding only because the question borrows the source
 * passage's exact vocabulary. The gap between the two is itself a result.
 */
export type Provenance = 'corpus-derived' | 'independent';

export interface EvalQuestion {
  readonly id: string;
  readonly question: string;
  /** Exactly four options, rendered as A-D in the order given. */
  readonly options: readonly [string, string, string, string];
  /** Index into options of the correct answer. */
  readonly answer: 0 | 1 | 2 | 3;
  readonly provenance: Provenance;
  readonly domain: DomainTag;
  /** Passage justifying the key, so verification needs no clinical expertise. */
  readonly cite?: { readonly page: number; readonly quote: string };
}

export const CONDITIONS = ['vanilla', 'rag', 'rag-rerank', 'rag-rerank-compress'] as const;
export type ConditionId = (typeof CONDITIONS)[number];

export interface QuestionResult {
  readonly questionId: string;
  readonly condition: ConditionId;
  readonly chosen: number;
  readonly correct: boolean;
  /** Time to the constrained answer token, the MCQ analogue of TTFT. */
  readonly latencyMs: number;
  readonly promptTokens: number;
  /** Top fused score; 0 for vanilla. Used for abstention analysis. */
  readonly topScore: number;
  /** Whether the gate WOULD have fired. MCQ forces an answer regardless. */
  readonly wouldAbstain: boolean;
  readonly retrievedPages: readonly number[];
}

export interface ConditionSummary {
  readonly condition: ConditionId;
  readonly n: number;
  readonly accuracy: number;
  readonly meanLatencyMs: number;
  readonly meanPromptTokens: number;
  readonly abstainRate: number;
  /** Accuracy restricted to questions the gate would have answered. */
  readonly accuracyWhenAnswering: number;
}
