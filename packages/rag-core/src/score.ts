/**
 * Scoring: PocketRAG Eq. 2 (lexical), Eq. 3 (hybrid fusion), and INT8 vector math.
 */
import { stem, tokenize, type Keyword } from './lexicon.ts';

/** PocketRAG Eq. 3: weight on the semantic term. Paper sets 0.6 empirically. */
export const DEFAULT_ALPHA = 0.6;

/**
 * Build the matchable term set W_c for a chunk.
 *
 * Holds both surface and stemmed forms because extractKeywords leaves recognized
 * domain terms unstemmed (they are lexicon keys) but stems everything else.
 * Carrying both makes matching symmetric regardless of which path a term took.
 */
export function chunkTermSet(text: string): Set<string> {
  const set = new Set<string>();
  for (const tok of tokenize(text)) {
    set.add(tok);
    set.add(stem(tok));
  }
  return set;
}

/**
 * PocketRAG Eq. 2, generalized to weighted terms:
 *
 *   S_lex(q, c) = sum(weight of matched keywords) / sum(all keyword weights)
 *
 * Reduces exactly to the paper's |K_q ∩ W_c| / |K_q| when all weights are equal.
 * Always in [0,1], which matters because Eq. 3 fuses it with a cosine — an
 * unbounded score like raw BM25 could not be mixed this way.
 */
export function lexicalScore(keywords: readonly Keyword[], terms: ReadonlySet<string>): number {
  if (keywords.length === 0) return 0;
  let matched = 0;
  let total = 0;
  for (const kw of keywords) {
    total += kw.weight;
    if (terms.has(kw.term)) matched += kw.weight;
  }
  return total === 0 ? 0 : matched / total;
}

/**
 * Cosine between an fp32 query vector and an INT8-quantized candidate row.
 *
 * The candidate's per-row scale cancels: cos = (s*Σqc) / (||q|| * s*sqrt(Σc²)).
 * So ranking never needs vectors.scale at all, and this runs as a single pass
 * with no intermediate allocation — which is the point on a phone. The scale file
 * is still shipped: it is needed to reconstruct true vectors for the ingest
 * round-trip test and any future non-cosine use.
 */
export function cosineInt8(query: Float32Array, candidate: Int8Array): number {
  const n = query.length;
  if (candidate.length !== n) {
    throw new Error(`dim mismatch: query ${n} vs candidate ${candidate.length}`);
  }
  let dot = 0;
  let qq = 0;
  let cc = 0;
  for (let i = 0; i < n; i++) {
    const q = query[i] as number;
    const c = candidate[i] as number;
    dot += q * c;
    qq += q * q;
    cc += c * c;
  }
  if (qq === 0 || cc === 0) return 0;
  return dot / (Math.sqrt(qq) * Math.sqrt(cc));
}

/**
 * Bounds-checked view of one INT8 row inside a flat vectors.i8 buffer.
 *
 * Shared by the Node and device PackStores, which previously each open-coded
 * this arithmetic. It returns a VIEW, not a copy, so scoring a candidate set
 * allocates nothing — which matters on a phone. An out-of-range ordinal would
 * otherwise silently alias a neighbouring row and produce a plausible but wrong
 * similarity, so it throws.
 */
/** Every row of a packed INT8 matrix (a card's line vectors). A short last row is dropped. */
export function splitRows(buffer: Uint8Array, dim: number): Int8Array[] {
  const rows: Int8Array[] = [];
  for (let i = 0; (i + 1) * dim <= buffer.byteLength; i++) rows.push(vectorRow(buffer, i, dim));
  return rows;
}

export function vectorRow(buffer: Uint8Array, ordinal: number, dim: number): Int8Array {
  if (!Number.isInteger(ordinal) || ordinal < 0) {
    throw new Error(`ordinal must be a non-negative integer, got ${ordinal}`);
  }
  const start = ordinal * dim;
  if (start + dim > buffer.byteLength) {
    throw new Error(
      `row ${ordinal} (dim ${dim}) ends at ${start + dim}, past buffer length ${buffer.byteLength}`,
    );
  }
  return new Int8Array(buffer.buffer, buffer.byteOffset + start, dim);
}

/** Reconstruct fp32 values from a per-row symmetric INT8 row. */
export function dequantizeInt8(row: Int8Array, scale: number): Float32Array {
  const out = new Float32Array(row.length);
  for (let i = 0; i < row.length; i++) out[i] = (row[i] as number) * scale;
  return out;
}

/**
 * Per-row symmetric INT8 quantization, mirroring tools/ingest.
 * Exported so the round-trip test can assert encoder and decoder agree.
 */
export function quantizeInt8(vec: Float32Array): { vec: Int8Array; scale: number } {
  let maxAbs = 0;
  for (let i = 0; i < vec.length; i++) {
    const a = Math.abs(vec[i] as number);
    if (a > maxAbs) maxAbs = a;
  }
  const scale = maxAbs === 0 ? 1 : maxAbs / 127;
  const out = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    const q = Math.round((vec[i] as number) / scale);
    out[i] = Math.max(-127, Math.min(127, q));
  }
  return { vec: out, scale };
}

/**
 * Map a raw cosine onto [0,1] against the encoder's unrelated-text floor.
 *
 * Sentence encoders compress cosine into a narrow high band: with gte-small,
 * unrelated text scores ~0.71 and closely related text ~0.84. Fusing raw cosines
 * makes every absolute threshold meaningless, because an unrelated chunk starts
 * at 0.43 once weighted. Rescaling puts the floor at 0 and leaves the usable
 * signal spread across the full range, so DEFAULT_ABSTAIN_THRESHOLD means what
 * it says regardless of which encoder is loaded.
 *
 * A floor of 0 is the identity, which is what the test fakes use.
 */
export function rescaleCosine(cosine: number, floor: number): number {
  if (floor <= 0) return Math.max(0, Math.min(1, cosine));
  if (floor >= 1) return 0;
  return Math.max(0, Math.min(1, (cosine - floor) / (1 - floor)));
}

/**
 * PocketRAG Eq. 3 — the hybrid score:
 *
 *   U_i = alpha * cos(E(q), E(c_i)) + (1 - alpha) * S_lex(q, c_i)
 *
 * Cosine is clamped to [0,1] first. Embeddings can be negatively correlated, and
 * a negative term would let a strong lexical match be cancelled by an unrelated
 * vector, which is not the behaviour Eq. 3 intends.
 *
 * Callers pass a cosine that has already been through rescaleCosine.
 */
export function fuse(cosine: number, sLex: number, alpha: number = DEFAULT_ALPHA): number {
  const c = Math.max(0, Math.min(1, cosine));
  const l = Math.max(0, Math.min(1, sLex));
  return alpha * c + (1 - alpha) * l;
}

/**
 * Brute-force nearest neighbours over a pack's whole INT8 matrix.
 *
 * Stage 2 used to score only the chunks Stage 1's keyword search had already
 * found, so a question worded differently from the manual never reached the
 * semantic scorer at all: "my friend twisted their ankle" shares no term with
 * "sprains and strains". A full scan is affordable on the phone — the largest
 * pack on the device is 5,773 rows of 384 bytes — and it is the only way
 * meaning can find a passage that words cannot.
 */
export function denseTopK(
  buffer: Uint8Array,
  dim: number,
  query: Float32Array,
  limit: number,
  /** Rows to consider. Filtering before ranking keeps `limit` a quota of usable rows. */
  allow?: (ordinal: number) => boolean,
): { ordinal: number; cosine: number }[] {
  const rows = Math.floor(buffer.byteLength / dim);
  const scored: { ordinal: number; cosine: number }[] = [];
  for (let i = 0; i < rows; i++) {
    if (allow !== undefined && !allow(i)) continue;
    scored.push({ ordinal: i, cosine: cosineInt8(query, vectorRow(buffer, i, dim)) });
  }
  scored.sort((a, b) => b.cosine - a.cosine);
  return scored.slice(0, limit);
}
