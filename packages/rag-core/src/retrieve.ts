/**
 * Stages 1 and 2 of the hybrid retrieval mechanism (PocketRAG §3.3).
 */
import type { ChunkRecord } from '@fred/pack-format';
import { embeddingsCompatible } from '@fred/pack-format';
import type { DomainTag, EmbeddingSpec } from '@fred/pack-format';
import type { InferenceBackend, PackStore } from './backends.ts';
import type { Keyword } from './lexicon.ts';
import { chunkTermSet, cosineInt8, fuse, lexicalScore, rescaleCosine, DEFAULT_ALPHA } from './score.ts';

export interface RetrievalOptions {
  /** Stage-1 candidate cap, per pack. Paper reduces "thousands to fewer than 50". */
  readonly candidateLimit: number;
  /** Chunks handed to the generator. */
  readonly topK: number;
  /** Eq. 3 semantic weight. */
  readonly alpha: number;
  /**
   * 'hybrid' runs both stages (the shipping configuration). 'lexical-only'
   * stops after Stage 1 and skips query embedding entirely, which is the
   * paper's plain "RAG" arm as distinct from "RAG + Rerank". Skipping the
   * embedding rather than setting alpha=0 keeps the latency comparison honest.
   */
  readonly mode: 'hybrid' | 'lexical-only';
  /**
   * What the query vector is built from. 'keywords' embeds the extracted
   * keyword list, which throws away everything that is not a keyword — "face
   * down and not responding, can I turn them over" becomes a bag of nouns.
   * 'question' embeds the question as asked, which is what the encoder was
   * trained on. Measured on the tuning set: docs/results-strategy-research.md §1e.
   */
  readonly queryInput: 'question' | 'keywords';
  /**
   * Per-pack count of nearest-by-meaning chunks added to the keyword candidates.
   * 0 disables it, leaving Stage 2 to re-score keyword hits only.
   */
  readonly densePool: number;
}

export const DEFAULT_RETRIEVAL: RetrievalOptions = {
  candidateLimit: 50,
  topK: 4,
  alpha: DEFAULT_ALPHA,
  mode: 'hybrid',
  queryInput: 'keywords',
  densePool: 0,
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

/**
 * Confirm the running encoder reproduces the vectors the pack was built with.
 *
 * Matching EmbeddingSpec metadata is not sufficient: two runtimes can load the
 * same GGUF, report the same modelId and dimension, and still embed differently.
 * Only comparing an actual vector catches that, and it must be checked at load
 * rather than left to show up as subtly worse answers.
 */
export async function verifyEmbedderParity(
  spec: EmbeddingSpec,
  backend: InferenceBackend,
  minCosine = 0.99,
): Promise<{ ok: boolean; cosine: number }> {
  const expected = Float32Array.from(spec.probe.vector);
  const actual = await backend.embed(spec.probe.text);
  if (actual.length !== expected.length) {
    return { ok: false, cosine: 0 };
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < expected.length; i++) {
    const a = expected[i] as number;
    const b = actual[i] as number;
    dot += a * b;
    na += a * a;
    nb += b * b;
  }
  const cosine = na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb));
  return { ok: cosine >= minCosine, cosine };
}

/** Wrap a query the way its encoder expects. See EmbeddingSpec.queryTemplate. */
export function applyQueryTemplate(template: string | undefined, text: string): string {
  return template === undefined ? text : template.replace('{text}', text);
}

export async function retrieve(
  keywords: readonly Keyword[],
  packIds: readonly string[],
  store: PackStore,
  backend: InferenceBackend,
  opts: RetrievalOptions = DEFAULT_RETRIEVAL,
  /**
   * Routed domains. When given, only chunks whose own domain is listed are
   * scored. A pack can serve several domains while holding chunks that belong to
   * only one: core-survival routes for first aid because its medical chapter
   * covers minor wounds and sprains, but "I cut myself on a branch" must not be
   * answered from a snare that "will cut off the bird's feet".
   */
  domains?: readonly DomainTag[],
  /** The question as asked. Used when opts.queryInput is 'question'. */
  query?: string,
): Promise<ScoredChunk[]> {
  if (packIds.length === 0) return [];
  // Only the hybrid path compares vectors, so only it requires a matching encoder.
  if (opts.mode === 'hybrid') assertCompatibleEmbedding(packIds, store, backend);

  // Stage 1 — lexical pre-filter. Cuts the vector work to a bounded candidate set.
  //
  // Queried per pack, so candidateLimit is a per-pack quota. The stores walk
  // their packs in order and truncate the combined list, so one call across all
  // packs let the first pack fill the whole limit on its own; with ATP 4-02.11
  // loaded first, no WHO BEC chunk could reach Stage 2 on a common query.
  //
  // The routed domains go into the query itself, so the quota is spent only on
  // chunks that survive the filter. See PackStore.searchLexical.
  const terms = keywords.map((k) => k.term);
  const lexicalOnly = opts.mode === 'lexical-only';
  const queryVec = lexicalOnly
    ? null
    : await backend.embed(applyQueryTemplate(
      backend.embeddingSpec().queryTemplate,
      opts.queryInput === 'question' && query !== undefined && query.trim() !== ''
        ? query
        : terms.join(' '),
    ));

  const lexicalHits = (
    await Promise.all(
      packIds.map((id) => store.searchLexical([id], terms, opts.candidateLimit, domains)),
    )
  ).flat();
  // Stage 1b — nearest by meaning, so a passage the keywords miss can still
  // compete. Merged with the keyword hits, then everything is scored on one scale.
  const denseHits = queryVec !== null && opts.densePool > 0 && store.searchDense !== undefined
    ? await store.searchDense(packIds, queryVec, opts.densePool, domains)
    : [];
  const seen = new Set<string>();
  const hits = [...lexicalHits, ...denseHits].filter((h) => {
    if (seen.has(h.chunkId)) return false;
    seen.add(h.chunkId);
    return true;
  });
  if (hits.length === 0) return [];
  const wanted = domains === undefined ? null : new Set<DomainTag>(domains);

  const [chunks, vectors] = await Promise.all([
    store.getChunks(hits.map((h) => h.chunkId)),
    store.getVectors(hits),
  ]);
  if (vectors.length !== hits.length) {
    throw new Error(`getVectors returned ${vectors.length} rows for ${hits.length} hits`);
  }

  const byId = new Map(chunks.map((c) => [c.id, c]));

  // Stage 2 — score every candidate on the fused scale.
  // The floor is a property of the running encoder, not of any one pack.
  const floor = backend.embeddingSpec().cosineFloor;

  const scored: ScoredChunk[] = [];
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i] as { chunkId: string };
    const chunk = byId.get(hit.chunkId);
    const v = vectors[i];
    if (!chunk || !v) continue;
    // Backstop: searchLexical takes the same domains and should have excluded
    // these already. Kept because the store parameter is optional, and because a
    // wrong-domain chunk reaching the generator is the failure this prevents.
    if (wanted !== null && !wanted.has(chunk.domain)) continue;
    const sLex = lexicalScore(keywords, chunkTermSet(chunk.text));
    if (queryVec === null) {
      // Stage 1 alone: rank purely by lexical overlap.
      scored.push({ chunk, cosineRaw: 0, cosine: 0, sLex, score: sLex });
      continue;
    }
    const cosineRaw = cosineInt8(queryVec, v.vec);
    const cosine = rescaleCosine(cosineRaw, floor);
    scored.push({ chunk, cosineRaw, cosine, sLex, score: fuse(cosine, sLex, opts.alpha) });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, opts.topK);
}
