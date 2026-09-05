/**
 * Platform boundaries. Everything else in rag-core is pure and portable.
 *
 * The mobile app implements these with llama.rn + op-sqlite; tools/eval implements
 * them with node-llama-cpp + better-sqlite3. Same pipeline code runs in both, so
 * the numbers in the evaluation describe the system that actually ships.
 */
import type { ChunkRecord, EmbeddingSpec } from '@fred/pack-format';
import type { PromptParts } from './prompt.ts';

export interface GenerateOptions {
  /** Upper bound on generated tokens. Set by the adaptive memory manager. */
  readonly maxTokens: number;
  readonly temperature?: number;
  readonly stop?: readonly string[];
  readonly signal?: AbortSignal;
}

export interface InferenceBackend {
  /** Encode a query. Must use the encoder named in the pack's EmbeddingSpec. */
  embed(text: string): Promise<Float32Array>;
  /** The encoder this backend is actually running, for compatibility checks. */
  embeddingSpec(): EmbeddingSpec;
  /**
   * Stream generated text.
   *
   * Takes the prompt in halves rather than pre-joined so a backend with a chat
   * template can render them as separate turns. That is not cosmetic: without a
   * template the model receives no end-of-turn signal and generates until the
   * context fills, which on device produced ~1000 tokens of repetition for a
   * question needing about eighty.
   */
  generate(prompt: PromptParts, opts: GenerateOptions): AsyncIterable<string>;
  /**
   * Exact token counts for a batch of strings.
   *
   * Batched and async on purpose. node-llama-cpp tokenizes synchronously, but
   * llama.rn crosses a native bridge, so a per-string synchronous signature
   * cannot be satisfied on device — the first implementation there fell back to
   * a chars/4 heuristic, which silently made on-device compression ratios and
   * token budgets incomparable to the ones the eval harness reports. One call
   * for every sentence keeps it exact on both sides at one round trip.
   */
  countTokens(texts: readonly string[]): Promise<number[]>;
}

/** One candidate surfaced by the Stage-1 lexical pre-filter. */
export interface LexicalHit {
  readonly chunkId: string;
  readonly packId: string;
  readonly ordinal: number;
}

export interface PackStore {
  /** Manifest-declared encoder for a pack, used to reject incompatible mixes. */
  embeddingSpecFor(packId: string): EmbeddingSpec;

  /**
   * Stage 1. FTS5 MATCH across the given packs, most-relevant first.
   *
   * Deliberately diverges from PocketRAG §3.2.1, which uses a hashmap capped at
   * 5,000 keyword entries. FTS5 is faster, unbounded, and already present. The
   * hashmap variant lives in tools/eval as an ablation baseline.
   */
  searchLexical(
    packIds: readonly string[],
    terms: readonly string[],
    limit: number,
  ): Promise<readonly LexicalHit[]>;

  getChunks(chunkIds: readonly string[]): Promise<readonly ChunkRecord[]>;

  /**
   * Raw INT8 rows plus their fp16 dequantization scales, in the order requested.
   * Returned raw so scoring can run without allocating Float32Arrays per chunk.
   */
  getVectors(
    hits: readonly LexicalHit[],
  ): Promise<readonly { readonly vec: Int8Array; readonly scale: number }[]>;
}

/** Current memory pressure, driving PocketRAG §3.5's adaptive generation limit. */
export interface MemoryMonitor {
  /** Ratio in [0,1] of used to available application memory. */
  pressure(): number;
}
