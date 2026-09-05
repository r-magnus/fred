/**
 * Device implementations of the rag-core boundaries.
 *
 * Mirrors tools/eval/src/node-pack.ts exactly in behaviour, using op-sqlite and
 * llama.rn instead of node:sqlite and node-llama-cpp. Because the pipeline above
 * these interfaces is shared, the eval harness measures the code that runs here.
 *
 * FTS5 is not compiled into op-sqlite by default; it is enabled by the
 * "op-sqlite": { "fts5": true } block in package.json. Stage-1 retrieval is
 * entirely FTS5, so without that flag every query returns nothing.
 */
import { open, type DB } from '@op-engineering/op-sqlite';
import type { Directory } from 'expo-file-system';
import { File } from 'expo-file-system';
import type { ChunkRecord, EmbeddingSpec, PackManifest } from '@fred/pack-format';
import type { InferenceBackend, LexicalHit, PackStore, GenerateOptions, PromptParts } from '@fred/rag-core';
import { vectorRow, decodeBase64 } from '@fred/rag-core';
import { initLlama, type LlamaContext } from 'llama.rn';

interface LoadedPack {
  readonly manifest: PackManifest;
  readonly db: DB;
  readonly vectors: Uint8Array;
  readonly dim: number;
}

export class DevicePackStore implements PackStore {
  private readonly packs = new Map<string, LoadedPack>();

  async load(dir: Directory, name: string): Promise<PackManifest> {
    // SDK 57 uses the File/Directory API. The legacy string helpers
    // (readAsStringAsync, documentDirectory, EncodingType) still exist but throw
    // at runtime unless imported from "expo-file-system/legacy".
    const manifest = JSON.parse(new File(dir, 'manifest.json').textSync()) as PackManifest;

    // op-sqlite wants a plain directory path, not a file:// URI.
    const db = open({ name, location: dir.uri.replace(/^file:\/\//, '') });

    const vectors = decodeBase64(new File(dir, 'vectors.i8').base64Sync());
    const expected = manifest.chunkCount * manifest.embedding.dim;
    if (vectors.byteLength !== expected) {
      throw new Error(`${manifest.id}: vectors.i8 is ${vectors.byteLength}B, expected ${expected}`);
    }

    this.packs.set(manifest.id, { manifest, db, vectors, dim: manifest.embedding.dim });
    return manifest;
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
  ): Promise<readonly LexicalHit[]> {
    if (terms.length === 0) return [];
    const query = terms.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ');
    const hits: LexicalHit[] = [];
    for (const packId of packIds) {
      const pack = this.packs.get(packId);
      if (!pack) continue;
      const res = await pack.db.execute(
        `SELECT c.ordinal AS ordinal, c.id AS id
         FROM chunks_fts f JOIN chunks c ON c.ordinal = f.rowid
         WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?`,
        [query, limit],
      );
      for (const row of res.rows ?? []) {
        hits.push({
          chunkId: String(row.id),
          packId,
          ordinal: Number(row.ordinal),
        });
      }
    }
    return hits.slice(0, limit);
  }

  async getChunks(chunkIds: readonly string[]): Promise<readonly ChunkRecord[]> {
    const out: ChunkRecord[] = [];
    for (const [packId, pack] of this.packs) {
      const ids = chunkIds.filter((i) => i.startsWith(`${packId}:`));
      if (ids.length === 0) continue;
      const res = await pack.db.execute(
        `SELECT * FROM chunks WHERE id IN (${ids.map(() => '?').join(',')})`,
        ids as string[],
      );
      for (const r of res.rows ?? []) {
        out.push({
          id: String(r.id),
          packId: String(r.pack_id),
          ordinal: Number(r.ordinal),
          text: String(r.text),
          section: String(r.section),
          source: String(r.source),
          page: r.page == null ? null : Number(r.page),
          domain: r.domain as ChunkRecord['domain'],
          licenseId: String(r.license_id),
          blockKind: r.block_kind as ChunkRecord['blockKind'],
        });
      }
    }
    return out;
  }

  async getVectors(hits: readonly LexicalHit[]) {
    return hits.map((h) => {
      const pack = this.packs.get(h.packId);
      if (!pack) throw new Error(`pack not loaded: ${h.packId}`);
      // A view, not a copy: scoring a candidate set allocates nothing.
      return { vec: vectorRow(pack.vectors, h.ordinal, pack.dim), scale: 1 };
    });
  }
}

export interface DeviceBackendOptions {
  readonly modelPath: string;
  readonly embedModelPath: string;
  readonly spec: EmbeddingSpec;
}

/**
 * Bridges llama.rn's token callback to an async iterator.
 *
 * The first implementation here collected every token into an array and yielded
 * only after completion() resolved, which made "time to first token" equal to
 * total generation time (78.7 s measured, versus 78.7 s total) and would have
 * shown the user a frozen screen until the whole answer was ready. Streaming is
 * the entire point of reporting TTFT.
 */
class TokenStream {
  private readonly queue: string[] = [];
  private done = false;
  private failure: unknown = null;
  private wake: (() => void) | null = null;

  push(token: string): void {
    this.queue.push(token);
    this.wake?.();
  }
  finish(err?: unknown): void {
    this.done = true;
    if (err !== undefined) this.failure = err;
    this.wake?.();
  }
  async *iterate(): AsyncIterable<string> {
    for (;;) {
      while (this.queue.length > 0) yield this.queue.shift() as string;
      if (this.failure !== null) throw this.failure;
      if (this.done) return;
      await new Promise<void>((resolve) => { this.wake = resolve; });
      this.wake = null;
    }
  }
}

export async function createDeviceBackend(
  opts: DeviceBackendOptions,
): Promise<InferenceBackend & { release(): Promise<void> }> {
  // llama.rn defaults to 4 threads. The Snapdragon 8s Gen 4 has 8 cores, and M0
  // measured its prefill at 8 threads, so leaving the default in place both
  // halves throughput and makes on-device numbers incomparable to the baseline.
  const N_THREADS = 8;
  // 2048 was too small: a 1095-token RAG prompt left only 953 tokens, and
  // generation ran until "context full" rather than finishing an answer.
  const N_CTX = 4096;

  const gen: LlamaContext = await initLlama({
    model: opts.modelPath,
    n_ctx: N_CTX,
    n_batch: 512,
    n_threads: N_THREADS,
    // ISOLATION STEP: KV cache quantization (PocketRAG §3.4.3) disabled.
    // With cache_type_k/v = q8_0 and flash_attn, this build produced incoherent
    // output ("URAIN. PRORPURINATION. ULONG."), not merely degraded answers.
  });

  const embed: LlamaContext = await initLlama({
    model: opts.embedModelPath,
    embedding: true,
    n_ctx: 512,
    n_threads: N_THREADS,
  });

  return {
    embeddingSpec: () => opts.spec,
    async embed(text: string) {
      const r = await embed.embedding(text);
      return Float32Array.from(r.embedding);
    },
    async countTokens(texts: readonly string[]): Promise<number[]> {
      // Exact, via llama.rn's tokenizer. Batched by the interface so this costs
      // one bridge crossing per string rather than one per compression pass.
      const out: number[] = [];
      for (const t of texts) out.push((await gen.tokenize(t)).tokens.length);
      return out;
    },
    generate(prompt: PromptParts, genOpts: GenerateOptions): AsyncIterable<string> {
      const stream = new TokenStream();
      void gen
        .completion(
          {
            // Chat turns, not a raw string. Without the template the model gets
            // no end-of-turn signal and generates until the context fills.
            messages: [
              { role: 'system', content: prompt.system },
              { role: 'user', content: prompt.user },
            ],
            jinja: true,
            // llama.rn defaults enable_thinking to TRUE. On Qwen3 that spends the
            // whole budget inside <think> before any visible text — measured at
            // 3.1x latency on desktop and an empty answer under a token cap
            // (docs/optimizations.md).
            enable_thinking: false,
            reasoning_format: 'none',
            n_predict: genOpts.maxTokens,
            // penalty_repeat defaults to 1.0, which is DISABLED. Without it the
            // model degenerated into repeating "and the man." indefinitely.
            penalty_repeat: 1.15,
            temperature: 0.3,
            top_p: 0.9,
            stop: [...(genOpts.stop ?? [])],
          },
          (tok) => stream.push(tok.token),
        )
        .then(() => stream.finish())
        .catch((e: unknown) => stream.finish(e));
      return stream.iterate();
    },
    async release() {
      await gen.release();
      await embed.release();
    },
  };
}
