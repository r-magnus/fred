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
}

/** A retrievable unit of knowledge. Mirrors one row of chunks.sqlite. */
export interface ChunkRecord {
  /** Globally unique: `${packId}:${ordinal}`. */
  readonly id: string;
  readonly packId: string;
  /** Row index into vectors.i8. Must equal the SQLite rowid ordering. */
  readonly ordinal: number;
  readonly text: string;
  /** Human-readable heading path, e.g. "Approach to shock > Recognition". */
  readonly section: string;
  /** Short source label shown in citations, e.g. "WHO BEC 2018". */
  readonly source: string;
  readonly page: number | null;
  readonly domain: DomainTag;
  readonly licenseId: string;
  readonly blockKind: BlockKind;
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
    a.normalized === b.normalized
  );
  // cosineFloor is deliberately excluded: it is a calibration constant of the
  // encoder, not part of vector identity. Retrieval takes it from the running
  // backend, and packs record it only for provenance.
}
