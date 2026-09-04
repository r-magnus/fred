/**
 * Stages 1 and 2 of the hybrid retrieval mechanism (PocketRAG §3.3).
 */
import type { ChunkRecord } from '@fred/pack-format';
import { embeddingsCompatible } from '@fred/pack-format';
import type { InferenceBackend, PackStore } from './backends.ts';
import type { Keyword } from './lexicon.ts';
import { chunkTermSet, cosineInt8, fuse, lexicalScore, rescaleCosine, DEFAULT_ALPHA } from './score.ts';

export interface RetrievalOptions {
  /** Stage-1 candidate cap. Paper reduces "thousands to fewer than 50". */
  readonly candidateLimit: number;
  /** Chunks handed to the generator. */
  readonly topK: number;
  /** Eq. 3 semantic weight. */
  readonly alpha: number;
}

export const DEFAULT_RETRIEVAL: RetrievalOptions = {
  candidateLimit: 50,
  topK: 4,
  alpha: DEFAULT_ALPHA,
};

export interface ScoredChunk {
  readonly chunk: ChunkRecord;
  /** Raw cosine, before floor rescaling. Kept for the debug overlay. */
  readonly cosineRaw: number;
  /** Cosine after rescaling against the encoder's floor; this feeds Eq. 3. */
  readonly cosine: number;
  readonly sLex: number;
  /** Fused U_i from Eq. 3. */
  readonly score: number;
}

/**
 * Refuse to search packs whose vectors are not mutually comparable, or that
 * disagree with the running encoder.
 *
 * Cosine between vectors from different encoders is not merely inaccurate, it is
 * meaningless — and it fails silently, producing plausible-looking rankings. This
 * is the kind of bug that survives to the demo, so it throws.
 */
export function assertCompatibleEmbedding(
  packIds: readonly string[],
  store: PackStore,
  backend: InferenceBackend,
): void {
  const runtime = backend.embeddingSpec();
  for (const id of packIds) {
    const spec = store.embeddingSpecFor(id);
    if (!embeddingsCompatible(spec, runtime)) {
      throw new Error(
        `pack "${id}" was built with ${spec.modelId} (dim ${spec.dim}, ` +
          `normalized=${spec.normalized}) but the runtime encoder is ` +
          `${runtime.modelId} (dim ${runtime.dim}, normalized=${runtime.normalized}). ` +
          `Rebuild the pack or load the matching encoder.`,
      );
    }
  }
}

export async function retrieve(
  keywords: readonly Keyword[],
  packIds: readonly string[],
  store: PackStore,
  backend: InferenceBackend,
  opts: RetrievalOptions = DEFAULT_RETRIEVAL,
): Promise<ScoredChunk[]> {
  if (packIds.length === 0) return [];
  assertCompatibleEmbedding(packIds, store, backend);

  // Stage 1 — lexical pre-filter. Cuts the vector work to a bounded candidate set.
  const terms = keywords.map((k) => k.term);
  const hits = await store.searchLexical(packIds, terms, opts.candidateLimit);
  if (hits.length === 0) return [];

  const [chunks, vectors] = await Promise.all([
    store.getChunks(hits.map((h) => h.chunkId)),
    store.getVectors(hits),
  ]);
  if (vectors.length !== hits.length) {
    throw new Error(`getVectors returned ${vectors.length} rows for ${hits.length} hits`);
  }

  const byId = new Map(chunks.map((c) => [c.id, c]));

  // Stage 2 — semantic re-rank over the survivors only.
  const queryVec = await backend.embed(keywords.map((k) => k.term).join(' '));

  // The floor is a property of the running encoder, not of any one pack.
  const floor = backend.embeddingSpec().cosineFloor;

  const scored: ScoredChunk[] = [];
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i] as { chunkId: string };
    const chunk = byId.get(hit.chunkId);
    const v = vectors[i];
    if (!chunk || !v) continue;
    const cosineRaw = cosineInt8(queryVec, v.vec);
    const cosine = rescaleCosine(cosineRaw, floor);
    const sLex = lexicalScore(keywords, chunkTermSet(chunk.text));
    scored.push({ chunk, cosineRaw, cosine, sLex, score: fuse(cosine, sLex, opts.alpha) });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, opts.topK);
}
