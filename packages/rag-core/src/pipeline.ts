/**
 * End-to-end query pipeline, tying together routing, hybrid retrieval, selective
 * context compression, the abstention gate, and generation.
 *
 * Pure orchestration — every platform-specific concern arrives through the
 * interfaces in backends.ts, so this exact code path runs both on device and in
 * tools/eval.
 */
import type { InferenceBackend, MemoryMonitor, PackStore } from './backends.ts';
import { compressContext, DEFAULT_COMPRESSION } from './compress.ts';
import { extractKeywords, type Keyword } from './lexicon.ts';
import { buildPromptParts, buildSufficiencyParts, readSufficiency, type ContextBlock } from './prompt.ts';
import { retrieve, DEFAULT_RETRIEVAL, type RetrievalOptions, type ScoredChunk } from './retrieve.ts';
import { route, type RoutablePack, type RouteResult } from './router.ts';

/**
 * Abstention threshold on the fused score U_i.
 *
 * Below this, Fred says it does not know instead of generating. An SLM handed
 * weak context will still produce fluent, confident prose, and in this domain a
 * confident wrong answer is worse than no answer. Tune against the eval set's
 * abstention precision/recall, not by feel.
 */
/**
 * Fused-score floor below which the pipeline declines.
 *
 * 0.35 was set by hand and never validated. It could not be lowered while the
 * router searched first aid for every unrecognised query, because the gate was
 * the only thing standing between a scuba question and an answer.
 *
 * With the scope gate in router.ts doing that job, this threshold is no longer
 * load-bearing for out-of-scope queries and only has to separate weak retrieval
 * from usable retrieval. Measured over the graded set, every out-of-scope query
 * that survives routing scores 0.277 or above 0.39, while three answerable ones
 * sit at 0.293, 0.332 and 0.341 — a sprained ankle, a tarp shelter at dusk, and
 * food storage at camp. Moving to 0.29 recovers all three and admits none.
 *
 * Fitted to 68 examples with a 0.016 margin, so treat it as provisional: the
 * durable version of this is a sufficient-context signal rather than one scalar
 * on a similarity score (docs/results-akr2.md).
 */
export const DEFAULT_ABSTAIN_THRESHOLD = 0.29;

/**
 * The bar when routing matched no vocabulary and searched everything anyway.
 *
 * Deliberately equal to the normal gate rather than higher. A raised bar here
 * would need a number, and the only data that could set one is the held-out
 * set — where the separating value is 0.50 (docs/results-holdout.md). Fitting
 * to that set would destroy the one honest measurement this project has, so
 * this ships at the already-fitted threshold and the option exists for when
 * there are unknown-vocabulary tuning questions to fit against.
 */
export const DEFAULT_FALLBACK_THRESHOLD = DEFAULT_ABSTAIN_THRESHOLD;

/** PocketRAG §3.5 — generation budget under memory pressure. */
export function maxTokensForPressure(pressure: number): number {
  if (pressure >= 0.85) return 256; // critical
  if (pressure >= 0.7) return 768; // moderate
  return 1024; // safe
}

export interface PipelineDeps {
  readonly backend: InferenceBackend;
  readonly store: PackStore;
  readonly packs: readonly RoutablePack[];
  readonly memory?: MemoryMonitor;
}

export interface AskOptions {
  readonly state: string | null;
  /** Search every domain when no vocabulary matches. See RouteContext. */
  readonly allowRoutingFallback?: boolean;
  /** Overrides DEFAULT_FALLBACK_THRESHOLD on the fallback path. */
  readonly fallbackThreshold?: number;
  /**
   * Ask the model whether the retrieved passages answer the question, and
   * abstain if not. Costs a second prefill of the same context.
   */
  readonly checkSufficiency?: boolean;
  readonly retrieval?: RetrievalOptions;
  readonly abstainThreshold?: number;
  readonly signal?: AbortSignal;
}

export interface Citation {
  readonly index: number;
  readonly chunkId: string;
  readonly source: string;
  readonly section: string;
  readonly page: number | null;
  readonly licenseId: string;
  readonly score: number;
}

export interface Diagnostics {
  readonly keywords: readonly Keyword[];
  readonly route: RouteResult;
  readonly candidates: readonly ScoredChunk[];
  readonly topScore: number;
  readonly tokensBefore: number;
  readonly tokensAfter: number;
  readonly contextReduction: number;
  readonly maxTokens: number;
  readonly memoryPressure: number;
  /** Model's verdict on whether the context answers the question; null if unchecked. */
  readonly sufficient?: boolean | null;
}

export type AskResult =
  /** Retrieval succeeded and cleared the gate; stream the answer. */
  | {
      readonly kind: 'answer';
      readonly stream: AsyncIterable<string>;
      readonly citations: readonly Citation[];
      readonly medical: boolean;
      readonly diagnostics: Diagnostics;
    }
  /** The query needs a state pack but the location is unknown. */
  | {
      readonly kind: 'needs-location';
      readonly candidatePacks: readonly string[];
      readonly diagnostics: Diagnostics;
    }
  /** Nothing retrieved cleared the threshold. */
  | {
      readonly kind: 'abstain';
      readonly nearest: readonly Citation[];
      readonly diagnostics: Diagnostics;
    };

const MEDICAL_DOMAINS = new Set(['first-aid-physical', 'first-aid-psychological']);

export async function ask(
  query: string,
  deps: PipelineDeps,
  opts: AskOptions,
): Promise<AskResult> {
  const { backend, store, packs, memory } = deps;
  const retrievalOpts = opts.retrieval ?? DEFAULT_RETRIEVAL;
  const threshold = opts.abstainThreshold ?? DEFAULT_ABSTAIN_THRESHOLD;

  const pressure = memory?.pressure() ?? 0;
  const maxTokens = maxTokensForPressure(pressure);

  const keywords = extractKeywords(query);
  const routed = route(keywords, packs, {
    state: opts.state,
    ...(opts.allowRoutingFallback === true ? { allowFallback: true } : {}),
  });
  const effectiveThreshold = routed.fallback
    ? (opts.fallbackThreshold ?? DEFAULT_FALLBACK_THRESHOLD)
    : threshold;

  const baseDiag = {
    keywords,
    route: routed,
    maxTokens,
    memoryPressure: pressure,
  };

  const candidates = await retrieve(keywords, routed.packIds, store, backend, retrievalOpts, routed.domains);
  const topScore = candidates[0]?.score ?? 0;

  if (candidates.length === 0 || topScore < effectiveThreshold) {
    const weak = {
      ...baseDiag,
      candidates,
      topScore,
      tokensBefore: 0,
      tokensAfter: 0,
      contextReduction: 0,
    };
    // Asking for a location is now a post-retrieval decision, made on evidence
    // rather than on which domain a word happens to be tagged with. It fires
    // only when the unscoped packs were searched and had nothing worth saying,
    // while a state pack that was skipped might have. That ordering is the
    // difference between "which state are you in?" and an answer for questions
    // like spoiled fish or testing cordage, where a plants/wildlife word routed
    // to state packs but core-survival held the answer all along.
    if (routed.skippedStatePacks.length > 0) {
      return { kind: 'needs-location', candidatePacks: routed.skippedStatePacks, diagnostics: weak };
    }
    return { kind: 'abstain', nearest: candidates.slice(0, 2).map(toCitation), diagnostics: weak };
  }

  // Stage 3 — compress before prefill.
  const compressed = await compressContext(
    candidates.map((c) => c.chunk),
    keywords,
    { ...DEFAULT_COMPRESSION, countTokens: (texts) => backend.countTokens(texts) },
  );

  const blocks: ContextBlock[] = compressed.chunks.map((c) => ({
    chunk: c.chunk,
    text: c.text,
  }));

  // The sufficiency check runs here, after compression, so it sees exactly the
  // passages the answer would be built from. Asking before compression would
  // judge material the generator never gets.
  let sufficient: boolean | null = null;
  if (opts.checkSufficiency === true) {
    let verdict = '';
    for await (const tok of backend.generate(buildSufficiencyParts(query, blocks), {
      maxTokens: 4, temperature: 0,
    })) {
      verdict += tok;
      if (verdict.trim().length >= 3) break;
    }
    sufficient = readSufficiency(verdict);
    if (!sufficient) {
      return {
        kind: 'abstain',
        nearest: candidates.slice(0, 2).map(toCitation),
        diagnostics: {
          ...baseDiag,
          candidates,
          topScore,
          tokensBefore: compressed.tokensBefore,
          tokensAfter: compressed.tokensAfter,
          contextReduction: compressed.reduction,
          sufficient,
        },
      };
    }
  }

  const prompt = buildPromptParts(query, blocks);
  const generateOpts = opts.signal
    ? { maxTokens, signal: opts.signal }
    : { maxTokens };

  return {
    kind: 'answer',
    stream: backend.generate(prompt, generateOpts),
    citations: candidates.map(toCitation),
    medical: candidates.some((c) => MEDICAL_DOMAINS.has(c.chunk.domain)),
    diagnostics: {
      ...baseDiag,
      candidates,
      topScore,
      sufficient,
      tokensBefore: compressed.tokensBefore,
      tokensAfter: compressed.tokensAfter,
      contextReduction: compressed.reduction,
    },
  };
}

function toCitation(c: ScoredChunk, i: number): Citation {
  return {
    index: i + 1,
    chunkId: c.chunk.id,
    source: c.chunk.source,
    section: c.chunk.section,
    page: c.chunk.page,
    licenseId: c.chunk.licenseId,
    score: c.score,
  };
}
