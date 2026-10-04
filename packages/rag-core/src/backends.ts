/**
 * Platform boundaries. Everything else in rag-core is pure and portable.
 *
 * The mobile app implements these with llama.rn + op-sqlite; tools/eval implements
 * them with node-llama-cpp + better-sqlite3. Same pipeline code runs in both, so
 * the numbers in the evaluation describe the system that actually ships.
 */
import type { CardClarify, CardSource, LicenseEntry, ChunkRecord, DomainTag, EmbeddingSpec } from '@fred/pack-format';
import type { PromptParts } from './prompt.ts';

export interface GenerateOptions {
  /** Upper bound on generated tokens. Set by the adaptive memory manager. */
  readonly maxTokens: number;
  readonly temperature?: number;
  readonly stop?: readonly string[];
  readonly signal?: AbortSignal;
  /**
   * A short call whose system prompt is the same every time (#101): the
   * intent check, the understanding step. A backend may run each lane in a
   * context of its own so the fixed prompt stays read between messages
   * instead of being read from scratch after every answer. Ignoring it is
   * correct, only slower.
   */
  readonly lane?: 'intent' | 'understand';
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
   * The clarifying question a field card asks, if it has one (manifest
   * `clarify`, #50). Optional: a store without it simply never asks.
   */
  clarifyFor?(chunkId: string): CardClarify | undefined;

  /** The manuals a field card quotes (manifest `cardSources`). Optional, like clarifyFor. */
  cardSourcesFor?(chunkId: string): readonly CardSource[] | undefined;

  /** A field card's line vectors (manifest `cardLines`), one INT8 row per line. Optional, like clarifyFor. */
  cardLineVectorsFor?(chunkId: string): readonly Int8Array[] | undefined;

  /** A passage's sentence vectors (manifest `sentences`), one row per quotable sentence. Optional. */
  sentenceVectorsFor?(chunkId: string): readonly Int8Array[] | undefined;

  /** A licence entry by id, from the pack manifests. Optional, like clarifyFor. */
  licenseFor?(licenseId: string): LicenseEntry | undefined;

  /**
   * Stage 1. FTS5 MATCH across the given packs, most-relevant first.
   *
   * Deliberately diverges from PocketRAG §3.2.1, which uses a hashmap capped at
   * 5,000 keyword entries. FTS5 is faster, unbounded, and already present. The
   * hashmap variant lives in tools/eval as an ablation baseline.
   *
   * `domains` restricts the search to chunks carrying one of those domain tags,
   * and must be applied *inside* the query rather than by the caller afterwards.
   * `limit` is a quota, so filtering after the fact spends it on chunks that were
   * never eligible: "I cut myself on a branch" routes to first aid, but the
   * survival pack's woodcraft chunks match "cut" lexically and filled all 50
   * slots, leaving the minor-wound passage at rank 90 — outside the candidate set
   * and therefore unreachable by any amount of re-ranking. Filtering first makes
   * the quota mean "50 candidates we might actually use".
   *
   * Optional for implementers; retrieve() re-checks each chunk's domain, so a
   * store that ignores this stays correct and merely wastes candidate slots.
   */
  searchLexical(
    packIds: readonly string[],
    terms: readonly string[],
    limit: number,
    domains?: readonly DomainTag[],
  ): Promise<readonly LexicalHit[]>;

  /**
   * Stage 1b. The chunks nearest the query vector across the given packs,
   * found by scanning every row rather than only the keyword hits.
   *
   * Optional: a store without it gets keyword-only candidates, which is the
   * pre-2026-09-24 behaviour. `domains` has the same quota meaning as in
   * searchLexical.
   */
  searchDense?(
    packIds: readonly string[],
    query: Float32Array,
    limit: number,
    domains?: readonly DomainTag[],
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
