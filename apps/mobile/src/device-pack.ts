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
import type { InferenceBackend, LexicalHit, PackStore, GenerateOptions } from '@fred/rag-core';
import { vectorRow } from '@fred/rag-core';
import { decodeBase64 } from './base64.ts';
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

export async function createDeviceBackend(
  opts: DeviceBackendOptions,
): Promise<InferenceBackend & { release(): Promise<void> }> {
  // KV cache quantization requires flash attention (PocketRAG §3.4.3); llama.cpp
  // silently ignores cache_type without it.
  const gen: LlamaContext = await initLlama({
    model: opts.modelPath,
    n_ctx: 2048,
    n_batch: 512,
    flash_attn: true,
    cache_type_k: 'q8_0',
    cache_type_v: 'q8_0',
  });

  const embed: LlamaContext = await initLlama({
    model: opts.embedModelPath,
    embedding: true,
    n_ctx: 512,
  });

  return {
    embeddingSpec: () => opts.spec,
    async embed(text: string) {
      const r = await embed.embedding(text);
      return Float32Array.from(r.embedding);
    },
    async countTokens(texts: readonly string[]): Promise<number[]> {
      // Exact, via llama.rn's tokenizer. One bridge crossing per string is why
      // the interface batches: compression asks for every sentence at once.
      const out: number[] = [];
      for (const t of texts) {
        const r = await gen.tokenize(t);
        out.push(r.tokens.length);
      }
      return out;
    },
    async *generate(prompt: string, genOpts: GenerateOptions) {
      const chunks: string[] = [];
      await gen.completion(
        { prompt, n_predict: genOpts.maxTokens, stop: [...(genOpts.stop ?? [])] },
        (tok) => { chunks.push(tok.token); },
      );
      for (const c of chunks) yield c;
    },
    async release() {
      await gen.release();
      await embed.release();
    },
  };
}
