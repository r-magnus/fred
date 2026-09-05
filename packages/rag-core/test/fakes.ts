/**
 * In-memory InferenceBackend and PackStore.
 *
 * Lets the full pipeline be exercised deterministically with no model, no SQLite,
 * and no device — which is what makes the retrieval logic testable in CI.
 */
import type { ChunkRecord, EmbeddingSpec } from '@fred/pack-format';
import type {
  GenerateOptions,
  InferenceBackend,
  LexicalHit,
  PackStore,
} from '../src/backends.ts';
import type { PromptParts } from '../src/prompt.ts';
import { quantizeInt8 } from '../src/score.ts';
import { chunkTermSet } from '../src/score.ts';

export const FAKE_DIM = 8;

export const FAKE_SPEC: EmbeddingSpec = {
  modelId: 'fake/test-encoder',
  dim: FAKE_DIM,
  quantization: 'int8-per-row',
  normalized: true,
  // The hash embedding genuinely produces near-zero cosine for unrelated text,
  // unlike a real sentence encoder, so no floor correction is needed.
  cosineFloor: 0,
  probe: { text: 'probe', vector: [...fakeEmbedNormalized('probe', FAKE_DIM)] },
};

/** Module-scope helper so FAKE_SPEC can carry a self-consistent probe. */
function fakeEmbedNormalized(text: string, dim: number): Float32Array {
  return fakeEmbed(text, dim);
}

/**
 * Deterministic bag-of-words hash embedding. Not semantic, but stable and
 * genuinely correlated with token overlap, so ranking assertions are meaningful.
 */
export function fakeEmbed(text: string, dim = FAKE_DIM): Float32Array {
  const v = new Float32Array(dim);
  for (const tok of text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) {
      h ^= tok.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    v[Math.abs(h) % dim] = (v[Math.abs(h) % dim] as number) + 1;
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += (v[i] as number) ** 2;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) v[i] = (v[i] as number) / norm;
  return v;
}

export class FakeBackend implements InferenceBackend {
  public lastPrompt: string | null = null;
  public lastOptions: GenerateOptions | null = null;
  private readonly spec: EmbeddingSpec;
  constructor(spec: EmbeddingSpec = FAKE_SPEC) {
    this.spec = spec;
  }

  async embed(text: string): Promise<Float32Array> {
    return fakeEmbed(text, this.spec.dim);
  }
  embeddingSpec(): EmbeddingSpec {
    return this.spec;
  }
  async countTokens(texts: readonly string[]): Promise<number[]> {
    return texts.map((t) => t.split(/\s+/).filter(Boolean).length);
  }
  async *generate(prompt: PromptParts, opts: GenerateOptions): AsyncIterable<string> {
    this.lastPrompt = `${prompt.system}\n\n${prompt.user}`;
    this.lastOptions = opts;
    yield 'FAKE ';
    yield 'ANSWER';
  }
}

export class FakePackStore implements PackStore {
  private readonly chunks = new Map<string, ChunkRecord>();
  private readonly vectors = new Map<string, { vec: Int8Array; scale: number }>();
  private readonly specs = new Map<string, EmbeddingSpec>();

  addPack(packId: string, records: readonly Omit<ChunkRecord, 'id' | 'packId' | 'ordinal'>[], spec: EmbeddingSpec = FAKE_SPEC): void {
    this.specs.set(packId, spec);
    records.forEach((r, ordinal) => {
      const id = `${packId}:${ordinal}`;
      const rec: ChunkRecord = { ...r, id, packId, ordinal };
      this.chunks.set(id, rec);
      this.vectors.set(id, quantizeInt8(fakeEmbed(r.text, spec.dim)));
    });
  }

  embeddingSpecFor(packId: string): EmbeddingSpec {
    const s = this.specs.get(packId);
    if (!s) throw new Error(`unknown pack ${packId}`);
    return s;
  }

  /** Stands in for FTS5 MATCH: any chunk sharing at least one term, best first. */
  async searchLexical(
    packIds: readonly string[],
    terms: readonly string[],
    limit: number,
  ): Promise<readonly LexicalHit[]> {
    const want = new Set(terms);
    const out: { hit: LexicalHit; overlap: number }[] = [];
    for (const c of this.chunks.values()) {
      if (!packIds.includes(c.packId)) continue;
      const cset = chunkTermSet(c.text);
      let overlap = 0;
      for (const t of want) if (cset.has(t)) overlap++;
      if (overlap > 0) {
        out.push({ hit: { chunkId: c.id, packId: c.packId, ordinal: c.ordinal }, overlap });
      }
    }
    out.sort((a, b) => b.overlap - a.overlap);
    return out.slice(0, limit).map((o) => o.hit);
  }

  async getChunks(ids: readonly string[]): Promise<readonly ChunkRecord[]> {
    return ids.map((i) => this.chunks.get(i)).filter((c): c is ChunkRecord => c !== undefined);
  }

  async getVectors(hits: readonly LexicalHit[]) {
    return hits.map((h) => {
      const v = this.vectors.get(h.chunkId);
      if (!v) throw new Error(`no vector for ${h.chunkId}`);
      return v;
    });
  }
}
