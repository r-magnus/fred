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
import { buildPromptParts, type ContextBlock } from './prompt.ts';
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
export const DEFAULT_ABSTAIN_THRESHOLD = 0.35;

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
  const routed = route(keywords, packs, { state: opts.state });

  const baseDiag = {
    keywords,
    route: routed,
    maxTokens,
    memoryPressure: pressure,
  };

  // Location gate before retrieval: the answer likely exists but is state-scoped.
  if (routed.packIds.length === 0 && routed.skippedStatePacks.length > 0) {
    return {
      kind: 'needs-location',
      candidatePacks: routed.skippedStatePacks,
      diagnostics: {
        ...baseDiag,
        candidates: [],
        topScore: 0,
        tokensBefore: 0,
        tokensAfter: 0,
        contextReduction: 0,
      },
    };
  }

  const candidates = await retrieve(keywords, routed.packIds, store, backend, retrievalOpts);
  const topScore = candidates[0]?.score ?? 0;

  if (candidates.length === 0 || topScore < threshold) {
    return {
      kind: 'abstain',
      nearest: candidates.slice(0, 2).map(toCitation),
      diagnostics: {
        ...baseDiag,
        candidates,
        topScore,
        tokensBefore: 0,
        tokensAfter: 0,
        contextReduction: 0,
      },
    };
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
