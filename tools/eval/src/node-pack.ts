/**
 * Node implementations of the rag-core boundaries, backed by real packs.
 *
 * The mobile app supplies the same two interfaces over llama.rn and op-sqlite.
 * Because the pipeline code above them is shared, results measured here describe
 * the system that ships.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  ChunkRecord, DomainTag, BlockKind, EmbeddingSpec, PackManifest,
} from '@fred/pack-format';
import type { InferenceBackend, LexicalHit, PackStore, GenerateOptions } from '@fred/rag-core';
import { denseTopK, vectorRow } from '@fred/rag-core';
import { getLlama, LlamaChatSession, type LlamaContext, type LlamaModel } from 'node-llama-cpp';

interface LoadedPack {
  readonly manifest: PackManifest;
  readonly db: DatabaseSync;
  readonly vectors: Buffer;
  readonly dim: number;
}

export class NodePackStore implements PackStore {
  private readonly packs = new Map<string, LoadedPack>();

  load(dir: string): PackManifest {
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as PackManifest;
    const db = new DatabaseSync(join(dir, 'chunks.sqlite'), { readOnly: true });
    const vectors = readFileSync(join(dir, 'vectors.i8'));
    const expected = manifest.chunkCount * manifest.embedding.dim;
    if (vectors.byteLength !== expected) {
      throw new Error(`${manifest.id}: vectors.i8 is ${vectors.byteLength} bytes, expected ${expected}`);
    }
    this.packs.set(manifest.id, { manifest, db, vectors, dim: manifest.embedding.dim });
    return manifest;
  }

  manifests(): PackManifest[] {
    return [...this.packs.values()].map((p) => p.manifest);
  }

  embeddingSpecFor(packId: string): EmbeddingSpec {
    const p = this.packs.get(packId);
    if (!p) throw new Error(`pack not loaded: ${packId}`);
    return p.manifest.embedding;
  }

  async searchLexical(
    packIds: readonly string[],
    terms: readonly string[],
    limit: number,
    domains?: readonly DomainTag[],
  ): Promise<readonly LexicalHit[]> {
    if (terms.length === 0) return [];
    // OR the terms: Stage 1 is a recall filter, precision comes from Stage 2.
    // Quoted to keep FTS5 from interpreting a term as an operator.
    const query = terms.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ');
    // Domain narrowing rides inside the statement so LIMIT applies after it.
    const domainClause = domains === undefined || domains.length === 0
      ? ''
      : ` AND c.domain IN (${domains.map(() => '?').join(',')})`;
    const hits: LexicalHit[] = [];
    for (const packId of packIds) {
      const pack = this.packs.get(packId);
      if (!pack) continue;
      const rows = pack.db
        .prepare(`SELECT c.ordinal AS ordinal, c.id AS id
                  FROM chunks_fts f JOIN chunks c ON c.ordinal = f.rowid
                  WHERE chunks_fts MATCH ?${domainClause} ORDER BY rank LIMIT ?`)
        .all(query, ...(domains ?? []), limit) as { ordinal: number; id: string }[];
      for (const r of rows) hits.push({ chunkId: r.id, packId, ordinal: r.ordinal });
    }
    return hits.slice(0, limit);
  }

  /** Ordinals per pack and domain set, for filtering the dense scan. */
  private readonly domainOrdinals = new Map<string, Set<number>>();

  private ordinalsFor(packId: string, pack: LoadedPack, domains: readonly DomainTag[]): Set<number> {
    const key = `${packId}|${[...domains].sort().join(',')}`;
    let set = this.domainOrdinals.get(key);
    if (set === undefined) {
      const rows = pack.db
        .prepare(`SELECT ordinal FROM chunks WHERE domain IN (${domains.map(() => '?').join(',')})`)
        .all(...domains) as { ordinal: number }[];
      set = new Set(rows.map((r) => r.ordinal));
      this.domainOrdinals.set(key, set);
    }
    return set;
  }

  async searchDense(
    packIds: readonly string[],
    query: Float32Array,
    limit: number,
    domains?: readonly DomainTag[],
  ): Promise<readonly LexicalHit[]> {
    const hits: LexicalHit[] = [];
    for (const packId of packIds) {
      const pack = this.packs.get(packId);
      if (!pack) continue;
      const allowed = domains === undefined || domains.length === 0 ? undefined : this.ordinalsFor(packId, pack, domains);
      const top = denseTopK(pack.vectors, pack.dim, query, limit, allowed && ((o) => allowed.has(o)));
      if (top.length === 0) continue;
      const rows = pack.db
        .prepare(`SELECT ordinal, id FROM chunks WHERE ordinal IN (${top.map(() => '?').join(',')})`)
        .all(...top.map((t) => t.ordinal)) as { ordinal: number; id: string }[];
      const idOf = new Map(rows.map((r) => [r.ordinal, r.id]));
      for (const t of top) {
        const id = idOf.get(t.ordinal);
        if (id !== undefined) hits.push({ chunkId: id, packId, ordinal: t.ordinal });
      }
    }
    return hits;
  }

  async getChunks(chunkIds: readonly string[]): Promise<readonly ChunkRecord[]> {
    const out: ChunkRecord[] = [];
    for (const [packId, pack] of this.packs) {
      const ids = chunkIds.filter((i) => i.startsWith(`${packId}:`));
      if (ids.length === 0) continue;
      const rows = pack.db
        .prepare(`SELECT * FROM chunks WHERE id IN (${ids.map(() => '?').join(',')})`)
        .all(...ids) as Record<string, unknown>[];
      for (const r of rows) {
        out.push({
          id: r.id as string,
          packId: r.pack_id as string,
          ordinal: r.ordinal as number,
          text: r.text as string,
          // Empty for packs built before contextual retrieval shipped.
          context: (r.context as string | null) ?? '',
          section: r.section as string,
          source: r.source as string,
          page: (r.page as number | null) ?? null,
          domain: r.domain as DomainTag,
          licenseId: r.license_id as string,
          blockKind: r.block_kind as BlockKind,
          audience: r.audience === 'provider' ? 'provider' : 'everyone',
        });
      }
    }
    return out;
  }

  async getVectors(hits: readonly LexicalHit[]) {
    return hits.map((h) => {
      const pack = this.packs.get(h.packId);
      if (!pack) throw new Error(`pack not loaded: ${h.packId}`);
      return { vec: vectorRow(pack.vectors, h.ordinal, pack.dim), scale: 1 };
    });
  }

  close(): void {
    for (const p of this.packs.values()) p.db.close();
  }
}

/**
 * The local GGUF for a pack's encoder. Derived from the manifest so every tool
 * embeds queries with the encoder the pack was built with; a hardcoded path
 * would keep searching an EmbeddingGemma pack with gte-small, and the parity
 * check is the only thing that would notice.
 */
export function embedModelPathFor(modelId: string): string {
  const files: Record<string, string> = {
    'Supabase/gte-small': 'gte-small_fp16.gguf',
    'google/embeddinggemma-300m': 'embeddinggemma-300M-Q8_0.gguf',
  };
  const file = files[modelId];
  if (file === undefined) throw new Error(`no local GGUF known for encoder ${modelId}`);
  return `${process.env.HOME}/models/${file}`;
}

export interface NodeBackendOptions {
  /** Defaults to embedModelPathFor(embedModelId). */
  readonly embedModelPath?: string;
  readonly embedModelId: string;
  readonly cosineFloor: number;
  readonly probe: EmbeddingSpec['probe'];
  readonly queryTemplate?: string | undefined;
  readonly genModelPath?: string;
}

/**
 * GEN_SAMPLING=qwen replaces greedy decoding with the parameters Qwen publishes
 * for this model family. Off by default, so a plain run still measures what
 * device-pack.ts does.
 *
 * Greedy is not a neutral default here. Qwen's own guidance is
 * "DO NOT use greedy decoding, as it can lead to performance degradation and
 * endless repetitions", and Qwen3.5-2B's card adds that this model is
 * "more prone to entering thinking loops compared to other Qwen3.5 models,
 * which may prevent it from terminating generation properly". Both describe
 * docs/results-qwen35-2b.md exactly: five answers ran to the token cap, two of
 * them repeating a single sentence.
 *
 * The card's non-thinking text recommendation is temperature 1.0, top_p 1.0,
 * top_k 20, min_p 0, presence_penalty 2.0, repetition_penalty 1.0.
 *
 * Two things this has to get right to be that recommendation rather than a
 * lookalike:
 *
 * - `presencePenalty` here penalises tokens inside a window that defaults to
 *   the last 64 tokens. vLLM's presence_penalty, which is what Qwen's number
 *   refers to, applies across the whole completion. The window is therefore
 *   widened to the answer budget. A 64-token window could not even see the
 *   repetition that motivated this: the sentence fa-ankle-01 repeated eleven
 *   times is longer than the window.
 * - Sampling makes a run a sample rather than a measurement, so the seed is
 *   fixed. Without one, re-running the same configuration produces different
 *   prose and nothing can be compared to anything.
 */
const QWEN_SAMPLING = process.env.GEN_SAMPLING === 'qwen';
const GEN_SEED = Number(process.env.GEN_SEED ?? 1729);
if (!Number.isInteger(GEN_SEED)) throw new Error(`GEN_SEED must be an integer, got ${process.env.GEN_SEED}`);

function samplingFor(genOpts: GenerateOptions) {
  if (!QWEN_SAMPLING) {
    return {
      temperature: genOpts.temperature ?? 0,
      repeatPenalty: { penalty: 1.15 },
    } as const;
  }
  return {
    temperature: 1.0,
    topP: 1.0,
    topK: 20,
    minP: 0,
    seed: GEN_SEED,
    repeatPenalty: {
      penalty: 1.0,
      presencePenalty: 2.0,
      lastTokens: genOpts.maxTokens,
    },
  } as const;
}

export async function createNodeBackend(opts: NodeBackendOptions): Promise<InferenceBackend & { dispose(): Promise<void> }> {
  const llama = await getLlama();
  const embedModel: LlamaModel = await llama.loadModel({ modelPath: opts.embedModelPath ?? embedModelPathFor(opts.embedModelId) });
  const embedCtx = await embedModel.createEmbeddingContext();

  let genModel: LlamaModel | null = null;
  let genCtx: LlamaContext | null = null;
  if (opts.genModelPath) {
    genModel = await llama.loadModel({ modelPath: opts.genModelPath });
    // sequences: Qwen3.5-2B exhausted the default pool on the fourth question
    // ("No sequences left") even though every sequence is disposed per call, so
    // the pool is sized explicitly. Generation is greedy at temperature 0, so
    // this changes capacity only, never output.
    genCtx = await genModel.createContext({ contextSize: 4096, sequences: 4 });
  }

  const spec: EmbeddingSpec = {
    modelId: opts.embedModelId,
    dim: embedModel.embeddingVectorSize ?? 384,
    quantization: 'int8-per-row',
    normalized: true,
    cosineFloor: opts.cosineFloor,
    // Supplied by the caller from the loaded manifest; this backend is the one
    // the pack was built with, so it trivially satisfies its own probe.
    probe: opts.probe,
    ...(opts.queryTemplate === undefined ? {} : { queryTemplate: opts.queryTemplate }),
  };

  return {
    embeddingSpec: () => spec,
    async embed(text: string) {
      const e = await embedCtx.getEmbeddingFor(text);
      return Float32Array.from(e.vector);
    },
    async countTokens(texts: readonly string[]): Promise<number[]> {
      const m = genModel ?? embedModel;
      return texts.map((t) => m.tokenize(t).length);
    },
    async *generate(prompt: { system: string; user: string }, genOpts: GenerateOptions) {
      if (!genCtx) throw new Error('no generation model loaded');
      // Acquire and release per call: a context owns a fixed pool of sequences,
      // and leaking them fails with "No sequences left" on the second question.
      const sequence = genCtx.getSequence();
      try {
        const session = new LlamaChatSession({
          contextSequence: sequence,
          systemPrompt: prompt.system,
        });
        const chunks: string[] = [];
        // These three must mirror device-pack.ts. The shared-pipeline claim —
        // "the eval harness measures the code that ships" — held for retrieval
        // once embedder parity was fixed (docs/results-m3.md), but generation
        // was never aligned: the device sets enable_thinking false, greedy
        // decoding and penalty_repeat 1.15, and this side set none of them.
        //
        // Left as it was, the harness graded prose the phone never produces and
        // timed Qwen3's thinking tokens, which the device does not spend.
        await session.prompt(prompt.user, {
          maxTokens: genOpts.maxTokens,
          ...samplingFor(genOpts),
          budgets: { thoughtTokens: 0 },
          onTextChunk: (t) => chunks.push(t),
        });
        for (const c of chunks) yield c;
      } finally {
        sequence.dispose();
      }
    },
    async dispose() {
      await embedCtx.dispose();
      await embedModel.dispose();
      if (genCtx) await genCtx.dispose();
      if (genModel) await genModel.dispose();
    },
  };
}
