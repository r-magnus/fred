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
import type { ChunkRecord, DomainTag, EmbeddingSpec, PackManifest, CardClarify, CardSource, LicenseEntry } from '@fred/pack-format';
import type { InferenceBackend, LexicalHit, PackStore, GenerateOptions, PromptParts } from '@fred/rag-core';
import {
  vectorRow, denseTopK, decodeBase64, buildVocab, encode, meanPool, l2Normalize,
  type TokenizerConfig,
} from '@fred/rag-core';
import * as ort from 'onnxruntime-react-native';
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

  clarifyFor(chunkId: string): CardClarify | undefined {
    // Chunk ids are "<packId>:<ordinal>", and pack ids contain no colon.
    return this.packs.get(chunkId.slice(0, chunkId.lastIndexOf(':')))?.manifest.clarify?.[chunkId];
  }

  cardSourcesFor(chunkId: string): readonly CardSource[] | undefined {
    return this.packs.get(chunkId.slice(0, chunkId.lastIndexOf(':')))?.manifest.cardSources?.[chunkId];
  }

  licenseFor(licenseId: string): LicenseEntry | undefined {
    for (const { manifest } of this.packs.values()) {
      const hit = manifest.licenses.find((l) => l.id === licenseId);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }

  async searchLexical(
    packIds: readonly string[],
    terms: readonly string[],
    limit: number,
    domains?: readonly DomainTag[],
  ): Promise<readonly LexicalHit[]> {
    if (terms.length === 0) return [];
    const query = terms.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ');
    // Domain narrowing rides inside the statement so LIMIT applies after it.
    const domainClause = domains === undefined || domains.length === 0
      ? ''
      : ` AND c.domain IN (${domains.map(() => '?').join(',')})`;
    const hits: LexicalHit[] = [];
    for (const packId of packIds) {
      const pack = this.packs.get(packId);
      if (!pack) continue;
      const res = await pack.db.execute(
        `SELECT c.ordinal AS ordinal, c.id AS id
         FROM chunks_fts f JOIN chunks c ON c.ordinal = f.rowid
         WHERE chunks_fts MATCH ?${domainClause} ORDER BY rank LIMIT ?`,
        [query, ...(domains ?? []), limit],
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

  /** Ordinals per pack and domain set, for filtering the dense scan. */
  private readonly domainOrdinals = new Map<string, Set<number>>();

  private async ordinalsFor(packId: string, pack: LoadedPack, domains: readonly DomainTag[]): Promise<Set<number>> {
    const key = `${packId}|${[...domains].sort().join(',')}`;
    let set = this.domainOrdinals.get(key);
    if (set === undefined) {
      const res = await pack.db.execute(
        `SELECT ordinal FROM chunks WHERE domain IN (${domains.map(() => '?').join(',')})`,
        [...domains],
      );
      set = new Set((res.rows ?? []).map((r) => Number(r.ordinal)));
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
      const allowed = domains === undefined || domains.length === 0
        ? undefined
        : await this.ordinalsFor(packId, pack, domains);
      const top = denseTopK(pack.vectors, pack.dim, query, limit, allowed && ((o) => allowed.has(o)));
      if (top.length === 0) continue;
      const res = await pack.db.execute(
        `SELECT ordinal, id FROM chunks WHERE ordinal IN (${top.map(() => '?').join(',')})`,
        top.map((t) => t.ordinal),
      );
      const idOf = new Map((res.rows ?? []).map((r) => [Number(r.ordinal), String(r.id)]));
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
          // Empty for packs built before contextual retrieval shipped.
          context: r.context == null ? '' : String(r.context),
          section: String(r.section),
          source: String(r.source),
          page: r.page == null ? null : Number(r.page),
          domain: r.domain as ChunkRecord['domain'],
          licenseId: String(r.license_id),
          blockKind: r.block_kind as ChunkRecord['blockKind'],
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
      // A view, not a copy: scoring a candidate set allocates nothing.
      return { vec: vectorRow(pack.vectors, h.ordinal, pack.dim), scale: 1 };
    });
  }
}

export interface DeviceBackendOptions {
  readonly modelPath: string;
  /**
   * How to embed queries, chosen from the packs' own EmbeddingSpec so the app
   * can never search a pack with the wrong encoder.
   *
   * 'onnx' is gte-small through the shared TypeScript tokenizer and pooling.
   * 'gguf' is a llama.cpp encoder (EmbeddingGemma-300M) through llama.rn. That
   * path once disagreed with node-llama-cpp on the same model
   * (docs/results-m3.md), which is exactly what verifyEmbedderParity catches at
   * load, so a mismatch here fails loudly instead of searching badly.
   */
  readonly embedder:
    | { readonly kind: 'onnx'; readonly modelPath: string; readonly vocabPath: string }
    | { readonly kind: 'gguf'; readonly modelPath: string };
  readonly spec: EmbeddingSpec;
}

/** The encoder file each supported pack encoder needs on the device. */
export function embedderFilesFor(modelId: string):
  | { readonly kind: 'onnx'; readonly model: string; readonly vocab: string }
  | { readonly kind: 'gguf'; readonly model: string } {
  if (modelId === 'Supabase/gte-small') return { kind: 'onnx', model: 'gte-small.onnx', vocab: 'gte-small-vocab.txt' };
  if (modelId === 'google/embeddinggemma-300m') return { kind: 'gguf', model: 'embeddinggemma-300M-Q8_0.gguf' };
  throw new Error(`No on-device encoder for packs built with ${modelId}. Rebuild the packs or update the app.`);
}

/**
 * Embed with ONNX, tokenizing and pooling through rag-core.
 *
 * Previously this used llama.rn's embedding endpoint, which produced vectors
 * 0.83 cosine from the index's for identical text — barely above this encoder's
 * 0.75 floor for unrelated text — so Stage 2 was contributing noise. Sharing the
 * ONNX graph is not enough on its own: the tokenizer and the pooling have to be
 * the same code too, which is why both live in rag-core.
 */
async function embedWithOnnx(
  session: ort.InferenceSession,
  cfg: TokenizerConfig,
  text: string,
): Promise<Float32Array> {
  const ids = encode(text, cfg);
  const n = ids.length;
  const mask = new Array<number>(n).fill(1);
  const big = (xs: number[]): BigInt64Array => BigInt64Array.from(xs.map((x) => BigInt(x)));
  const feeds: Record<string, ort.Tensor> = {
    input_ids: new ort.Tensor('int64', big(ids), [1, n]),
    attention_mask: new ort.Tensor('int64', big(mask), [1, n]),
  };
  if (session.inputNames.includes('token_type_ids')) {
    feeds['token_type_ids'] = new ort.Tensor('int64', big(new Array<number>(n).fill(0)), [1, n]);
  }
  const out = await session.run(feeds);
  const tensor = out[session.outputNames[0] as string] as ort.Tensor;
  const dims = tensor.dims;
  const dim = dims[dims.length - 1] as number;
  return l2Normalize(meanPool(tensor.data as Float32Array, mask, dim));
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

  /** Called if the reader stops before the end (a `break` out of for-await). */
  onAbandon: (() => void) | null = null;

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
    try {
      for (;;) {
        while (this.queue.length > 0) yield this.queue.shift() as string;
        if (this.failure !== null) throw this.failure;
        if (this.done) return;
        await new Promise<void>((resolve) => { this.wake = resolve; });
        this.wake = null;
      }
    } finally {
      if (!this.done) this.onAbandon?.();
    }
  }
}

export type DeviceBackend = InferenceBackend & {
  release(): Promise<void>;
  /** What llama.rn actually initialized. Logged because GPU offload is silent. */
  readonly genInfo: Readonly<Record<string, unknown>>;
};

export async function createDeviceBackend(
  opts: DeviceBackendOptions,
): Promise<DeviceBackend> {
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
    // CPU only. llama.cpp defaults n_gpu_layers to auto, and this llama.rn build
    // ships OpenCL and Hexagon backends, so the context silently offloaded to
    // GPUOpenCL + HTP0 and produced fluent nonsense ("Please check your textbook")
    // from a prompt byte-identical to one CPU llama.cpp answers correctly on the
    // same phone. CPU-only was also faster end to end: 4.8 s vs 12.1 s for the
    // bleeding query (docs/results-m3.md).
    n_gpu_layers: 0,
    // flash_attn is left at llama.cpp's default (auto). Forcing it off was
    // coherent but slower (8.3 s). KV cache quantization (PocketRAG §3.4.3) is
    // not set: its "word salad" result in M3 was measured on the GPU-offloaded
    // context and needs retesting on CPU before it means anything.
  });

  let embed: (text: string) => Promise<Float32Array>;
  let releaseEmbedder: () => Promise<void>;
  if (opts.embedder.kind === 'onnx') {
    const embedSession = await ort.InferenceSession.create(opts.embedder.modelPath);
    // expo-file-system's File wants a URI. Given the bare path that ONNX Runtime
    // and op-sqlite need, textSync is "rejected" rather than failing to find the
    // file. Never reached until the ONNX module actually registered.
    const vocabPath = opts.embedder.vocabPath;
    const vocabUri = vocabPath.startsWith('file://') ? vocabPath : `file://${vocabPath}`;
    const tokenizer = buildVocab(new File(vocabUri).textSync());
    embed = (text) => embedWithOnnx(embedSession, tokenizer, text);
    releaseEmbedder = () => embedSession.release();
  } else {
    // A llama.rn context in embedding mode, created fresh for every text and
    // released straight after. Pooling comes from the GGUF's own metadata
    // (EmbeddingGemma: mean, then its dense projections), which is what
    // node-llama-cpp used at ingest. CPU only, like the generator.
    //
    // Fresh per call because a reused context is wrong after its first
    // embedding, measured on the phone (llama.rn 0.12.9): the pack's probe text
    // scored cos 0.9996 on a new context and 0.3880 on every later call to the
    // same one, and after embedding another text it scored 0.8989. clearCache(),
    // swa_full and disabling the state cache all left it at 0.3880. A fresh
    // context is always right, and creating one costs well under a second
    // against a ~15 s answer. This is very likely the "llama.rn embeddings
    // disagree" of docs/results-m3.md; verifyEmbedderParity is what caught it.
    const modelPath = opts.embedder.modelPath;
    embed = async (text) => {
      const ctx: LlamaContext = await initLlama({
        model: modelPath,
        embedding: true,
        n_ctx: 2048,
        n_batch: 512,
        n_threads: N_THREADS,
        n_gpu_layers: 0,
      });
      try {
        return l2Normalize(Float32Array.from((await ctx.embedding(text)).embedding));
      } finally {
        await ctx.release();
      }
    };
    releaseEmbedder = async () => {};
  }

  // One call into the generation context at a time. llama.rn throws
  // "Exception in HostFunction: <unknown>" when a completion starts while the
  // last one is still decoding, and a reader that stops early leaves it
  // decoding: the intent check breaks out as soon as it reads its word, so the
  // answer that followed failed whenever it started within those few tokens.
  // node-llama-cpp queues on its own, which is why the desktop never saw it.
  let idle: Promise<unknown> = Promise.resolve();
  const exclusive = <T,>(run: () => Promise<T>): Promise<T> => {
    const p = idle.then(run, run);
    idle = p.catch(() => undefined);
    return p;
  };

  const info = gen as unknown as Record<string, unknown>;
  // "gpu: true" here means a GPU device exists, not that layers are on it; the
  // devices list is what would reveal an offload if n_gpu_layers regressed.
  const backend: DeviceBackend = {
    genInfo: { gpu: info.gpu, devices: info.devices, reasonNoGPU: info.reasonNoGPU, androidLib: info.androidLib },
    embeddingSpec: () => opts.spec,
    embed,
    async countTokens(texts: readonly string[]): Promise<number[]> {
      // Exact, via llama.rn's tokenizer. Batched by the interface so this costs
      // one bridge crossing per string rather than one per compression pass.
      return exclusive(async () => {
        const out: number[] = [];
        for (const t of texts) out.push((await gen.tokenize(t)).tokens.length);
        return out;
      });
    },
    generate(prompt: PromptParts, genOpts: GenerateOptions): AsyncIterable<string> {
      const stream = new TokenStream();

      // US-07. An answer runs ~15 s on device, so a user who asked the wrong
      // thing, or who is watching their battery, needs a way out. llama.rn's
      // stopCompletion() ends the native decode loop; without it, aborting would
      // only stop the JS consumer while the phone kept generating and burning
      // power, which is the opposite of what the story asks for. A reader that
      // stops early is the same case. Only this call's own decode is stopped:
      // while it waits its turn, stopping would end someone else's.
      let running = false;
      let cancelled = false;
      const onAbort = (): void => {
        cancelled = true;
        if (running) void gen.stopCompletion();
      };
      stream.onAbandon = onAbort;
      if (genOpts.signal !== undefined) {
        if (genOpts.signal.aborted) onAbort();
        else genOpts.signal.addEventListener('abort', onAbort, { once: true });
      }
      const detach = (): void => genOpts.signal?.removeEventListener('abort', onAbort);

      void exclusive(async () => {
        if (cancelled) return;
        running = true;
        try {
          await gen.completion(
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
                // reasoning_format is deliberately NOT set. With 'none' the response
                // parser truncated the start of the answer ("INATION: 1,2" for what
                // should read "EXAMINATION"), so the leading tokens were being eaten.
                n_predict: genOpts.maxTokens,
                // penalty_repeat defaults to 1.0, which is DISABLED. Without it the
                // model degenerated into repeating "and the man." indefinitely.
                penalty_repeat: 1.15,
                // Greedy. node-llama-cpp defaults to greedy on desktop and produced
                // clean answers that terminated in ~300 characters; sampling at 0.3
                // on device rambled to the 1024-token cap without emitting EOS.
                // Determinism is also worth more than variety for first-aid guidance.
                temperature: 0,
                stop: [...(genOpts.stop ?? [])],
              },
              (tok) => stream.push(tok.token),
          );
        } finally {
          running = false;
        }
      })
        // A stopped completion resolves normally with what it produced, so the
        // partial answer is kept rather than thrown away.
        .then(() => { detach(); stream.finish(); })
        .catch((e: unknown) => { detach(); stream.finish(e); });
      return stream.iterate();
    },
    async release() {
      await gen.release();
      await releaseEmbedder();
    },
  };
  return backend;
}
