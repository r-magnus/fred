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
import { vectorRow } from '@fred/rag-core';
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

export interface NodeBackendOptions {
  readonly embedModelPath: string;
  readonly embedModelId: string;
  readonly cosineFloor: number;
  readonly probe: EmbeddingSpec['probe'];
  readonly genModelPath?: string;
  /**
   * Embed queries with this instead of loading `embedModelPath` as a GGUF. The
   * ONNX embedder is what ingest and the device use; the GGUF is what this
   * harness always used. Parity is still checked by the caller either way.
   */
  readonly embedder?: {
    embed(texts: readonly string[]): Promise<Float32Array[]>;
    dispose(): Promise<void>;
  };
}

export async function createNodeBackend(opts: NodeBackendOptions): Promise<InferenceBackend & { dispose(): Promise<void> }> {
  const llama = await getLlama();
  const embedModel: LlamaModel | null = opts.embedder
    ? null : await llama.loadModel({ modelPath: opts.embedModelPath });
  const embedCtx = embedModel ? await embedModel.createEmbeddingContext() : null;

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
    dim: embedModel?.embeddingVectorSize ?? 384,
    quantization: 'int8-per-row',
    normalized: true,
    cosineFloor: opts.cosineFloor,
    // Supplied by the caller from the loaded manifest; this backend is the one
    // the pack was built with, so it trivially satisfies its own probe.
    probe: opts.probe,
  };

  return {
    embeddingSpec: () => spec,
    async embed(text: string) {
      if (opts.embedder) return (await opts.embedder.embed([text]))[0] as Float32Array;
      const e = await embedCtx!.getEmbeddingFor(text);
      return Float32Array.from(e.vector);
    },
    async countTokens(texts: readonly string[]): Promise<number[]> {
      const m = genModel ?? embedModel;
      if (!m) throw new Error('countTokens needs a generation model when embedding with ONNX');
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
          temperature: genOpts.temperature ?? 0,
          repeatPenalty: { penalty: 1.15 },
          budgets: { thoughtTokens: 0 },
          onTextChunk: (t) => chunks.push(t),
        });
        for (const c of chunks) yield c;
      } finally {
        sequence.dispose();
      }
    },
    async dispose() {
      await embedCtx?.dispose();
      await embedModel?.dispose();
      await opts.embedder?.dispose();
      if (genCtx) await genCtx.dispose();
      if (genModel) await genModel.dispose();
    },
  };
}
