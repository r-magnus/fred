/**
 * Pack format — the contract between `tools/ingest` (Python, build time) and the
 * TypeScript runtime (`@fred/rag-core`, on device).
 *
 * A *pack* is a versioned, self-contained, independently downloadable knowledge
 * bundle. Changing anything in this file means bumping SCHEMA_VERSION and
 * rebuilding packs, so keep it stable.
 *
 * On-disk layout:
 *   <packDir>/manifest.json      this schema
 *   <packDir>/chunks.sqlite      FTS5-indexed chunk text + metadata
 *   <packDir>/vectors.i8         flat INT8 matrix, row-major, chunkCount x dim
 *   <packDir>/vectors.scale      per-row fp16 dequantization scales
 */

export const SCHEMA_VERSION = 1;

/** Query domains a pack can serve. Drives routing (see rag-core/router.ts). */
export const DOMAIN_TAGS = [
  'first-aid-physical',
  'first-aid-psychological',
  'survival',
  'plants',
  'wildlife',
  // Everyday know-how (#96): toilets, campsites, food storage, layering, trail
  // etiquette. Added without a schema bump: packs that predate it stay valid.
  'outdoor-skills',
] as const;
export type DomainTag = (typeof DOMAIN_TAGS)[number];

/**
 * Whether a chunk may be broken up by selective context compression.
 *
 * 'procedure' marks ordered, step-wise content (CPR sequences, bleeding control,
 * shelter construction). These are ATOMIC: included whole or not at all. Dropping
 * step 3 of a 5-step sequence yields confidently wrong output, which in this
 * domain can be lethal. See rag-core/compress.ts.
 */
export const BLOCK_KINDS = ['prose', 'procedure'] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

/** Geographic applicability. Wildlife/plant packs are scoped to one US state. */
export type PackScope =
  | { readonly kind: 'global' }
  | { readonly kind: 'us-state'; readonly state: string }; // USPS code, e.g. "CO"

/**
 * Identifies the encoder that produced this pack's vectors.
 *
 * Cosine similarity between vectors from *different* encoders is meaningless, so
 * the runtime refuses to search across packs whose EmbeddingSpec disagrees.
 * See rag-core/retrieve.ts:assertCompatibleEmbedding.
 */
export interface EmbeddingSpec {
  /** HF id or local identifier, e.g. "thenlper/gte-small". */
  readonly modelId: string;
  /** Vector dimensionality, e.g. 384. */
  readonly dim: number;
  /** Storage quantization. Only per-row symmetric INT8 is defined today. */
  readonly quantization: 'int8-per-row';
  /** Whether fp32 vectors were L2-normalized before quantization. */
  readonly normalized: boolean;
  /**
   * A canonical text and the L2-normalized vector this encoder produced for it
   * at ingest, so a runtime can verify it reproduces the index's embeddings.
   *
   * This exists because it silently failed. The pack was embedded with
   * node-llama-cpp and the app embeds queries with llama.rn; both wrap
   * llama.cpp, but they produce different vectors for identical text, so cosine
   * was being computed across two implementations. Retrieval still returned
   * plausible-looking chunks with plausible-looking scores — just the wrong
   * ones. Nothing threw. See docs/results-m3.md.
   */
  readonly probe: {
    readonly text: string;
    /** L2-normalized, so comparison is scale-independent. */
    readonly vector: readonly number[];
  };

  /**
   * Empirical cosine similarity between UNRELATED text for this encoder.
   *
   * BERT-family encoders do not spread cosine over [0,1]. Measured for
   * gte-small, two unrelated sentences score ~0.71 and a closely related pair
   * ~0.84 — the entire useful signal lives in a narrow band near the top.
   *
   * Without correcting for this, any absolute threshold on the fused score is
   * meaningless: at alpha=0.6 an unrelated chunk already scores 0.6*0.71 = 0.43,
   * so an abstention gate set at 0.35 could never fire. Retrieval rescales
   * cosine against this floor before fusing (see rag-core/score.ts:rescaleCosine).
   *
   * Calibrate per encoder at ingest time; do not guess it.
   */
  readonly cosineFloor: number;
  /**
   * How a query is wrapped before embedding, with `{text}` standing for the
   * question. Absent means the query is embedded as-is (gte-small).
   *
   * Instruction-tuned encoders embed questions and passages differently.
   * EmbeddingGemma expects "task: search result | query: ..." on the question
   * side and "title: ... | text: ..." on the passage side, and searching with
   * the wrong wrapper silently costs recall. It lives in the pack because the
   * pack is what the phone has: a runtime that guessed would be wrong without
   * anything failing.
   */
  readonly queryTemplate?: string;
  /** The passage-side wrapper used at ingest, recorded for provenance. */
  readonly documentTemplate?: string;
}

export interface PackFileEntry {
  /** Path relative to the pack directory. */
  readonly path: string;
  readonly bytes: number;
  /** Lowercase hex SHA-256, verified on install. */
  readonly sha256: string;
}

export interface LicenseEntry {
  /** Stable key referenced by ChunkRecord.licenseId. */
  readonly id: string;
  /** SPDX id where one exists, else a descriptive string. */
  readonly license: string;
  readonly sourceTitle: string;
  readonly sourceUrl: string;
  /** Rendered verbatim in the app's attribution screen. */
  readonly attribution: string;
  /** True for CC BY-NC-* sources. Blocks commercial release; surfaced in docs. */
  readonly nonCommercial: boolean;
}

export interface PackManifest {
  readonly schemaVersion: number;
  /** Stable id without version, e.g. "core-firstaid", "state-CO-wildlife". */
  readonly id: string;
  /** Semver. Packs are replaced wholesale, never patched in place. */
  readonly version: string;
  readonly displayName: string;
  readonly description: string;
  readonly domains: readonly DomainTag[];
  readonly scope: PackScope;
  readonly embedding: EmbeddingSpec;
  readonly chunkCount: number;
  readonly files: readonly PackFileEntry[];
  readonly licenses: readonly LicenseEntry[];
  /** ISO-8601 build timestamp. */
  readonly builtAt: string;
  /** Version of tools/ingest that produced this pack, for reproducibility. */
  readonly ingestVersion: string;
  /**
   * Field-card packs only: the cards whose advice depends on one detail, keyed
   * by chunk id. Fred asks the question with a button per answer, and each
   * answer shows a subset of the card's own steps (#50).
   */
  readonly clarify?: Readonly<Record<string, CardClarify>>;
  /** Field-card packs only: the manuals and pages each card quotes, keyed by chunk id. */
  readonly cardSources?: Readonly<Record<string, readonly CardSource[]>>;
  /**
   * Field-card packs only (#109): one INT8 vector per card line (its steps,
   * then its don'ts, get-help line and notes, as the app parses them), keyed by
   * chunk id and base64-encoded, `embedding.dim` bytes a line. A specific
   * question is matched to the lines that answer it without a model call.
   */
  readonly cardLines?: Readonly<Record<string, string>>;
}

/** A manual a field card quotes, and the pages quoted. */
export interface CardSource {
  readonly source: string;
  readonly pages: readonly number[];
}

/** One question a field card asks when its steps depend on the situation. */
export interface CardClarify {
  /** "What does the burned skin look like?" */
  readonly question: string;
  readonly choices: readonly {
    /** Button text: "Blistered". */
    readonly label: string;
    /** Phrases that already answer the question when the hiker says them. */
    readonly words: readonly string[];
    /** 1-based card steps to show, in the order to show them. */
    readonly steps: readonly number[];
  }[];
}

/**
 * Who a passage is written for.
 *
 * WHO BEC is a course for health workers, and its skill stations (IV lines,
 * needle decompression, airway devices) score well against questions a hiker
 * should be referred on, not walked through (docs/plan-phase3.md, class B).
 * Marking them keeps them searchable, so they still identify the question as
 * clinical, while the pipeline refuses to build an answer from them.
 */
export type ChunkAudience = 'everyone' | 'provider';

/** A retrievable unit of knowledge. Mirrors one row of chunks.sqlite. */
export interface ChunkRecord {
  /** Globally unique: `${packId}:${ordinal}`. */
  readonly id: string;
  readonly packId: string;
  /** Row index into vectors.i8. Must equal the SQLite rowid ordering. */
  readonly ordinal: number;
  readonly text: string;
  /**
   * Contextual-retrieval preamble: one line saying what this passage is.
   *
   * Empty for packs built before this shipped — the column is additive so the
   * fifty state packs stay readable without re-ingesting. Prepended before
   * embedding, indexed in FTS5 beside the text, and shown to the generator,
   * which is what stops a "Do not" list reading as instructions.
   */
  readonly context: string;
  /** Human-readable heading path, e.g. "Approach to shock > Recognition". */
  readonly section: string;
  /** Short source label shown in citations, e.g. "WHO BEC 2018". */
  readonly source: string;
  readonly page: number | null;
  readonly domain: DomainTag;
  readonly licenseId: string;
  readonly blockKind: BlockKind;
  /** 'everyone' for packs built before the column existed. */
  readonly audience: ChunkAudience;
}

export function isDomainTag(v: unknown): v is DomainTag {
  return typeof v === 'string' && (DOMAIN_TAGS as readonly string[]).includes(v);
}

export function isBlockKind(v: unknown): v is BlockKind {
  return typeof v === 'string' && (BLOCK_KINDS as readonly string[]).includes(v);
}

/** Bytes per row in vectors.i8 (INT8) plus its fp16 scale in vectors.scale. */
export function vectorBytesPerChunk(dim: number): number {
  return dim + 2;
}

/**
 * Two packs may be searched together only if their vectors are comparable.
 * Guards against silently meaningless cosine scores across encoders.
 */
export function embeddingsCompatible(a: EmbeddingSpec, b: EmbeddingSpec): boolean {
  return (
    a.modelId === b.modelId &&
    a.dim === b.dim &&
    a.quantization === b.quantization &&
    a.normalized === b.normalized &&
    (a.queryTemplate ?? '') === (b.queryTemplate ?? '')
  );
  // cosineFloor is deliberately excluded: it is a calibration constant of the
  // encoder, not part of vector identity. Retrieval takes it from the running
  // backend, and packs record it only for provenance.
}
