/**
 * Node implementations of the rag-core boundaries, backed by real packs.
 *
 * The mobile app supplies the same two interfaces over llama.rn and op-sqlite.
 * Because the pipeline code above them is shared, results measured here describe
 * the system that ships.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  ChunkRecord, DomainTag, BlockKind, EmbeddingSpec, PackManifest, CardClarify, CardSource, LicenseEntry,
} from '@fred/pack-format';
import type { InferenceBackend, LexicalHit, PackStore, GenerateOptions } from '@fred/rag-core';
import { decodeBase64, denseTopK, splitRows, vectorRow } from '@fred/rag-core';
import { getLlama, LlamaChatSession, type LlamaContext, type LlamaModel } from 'node-llama-cpp';

interface LoadedPack {
  readonly manifest: PackManifest;
  readonly db: DatabaseSync;
  readonly vectors: Buffer;
  readonly dim: number;
  /** The sentence index (#126), when the pack has one. */
  readonly sentences?: { readonly vectors: Uint8Array; readonly starts: Uint32Array; readonly dim: number };
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
    const sv = manifest.sentences;
    const sentences = sv === undefined ? undefined : (() => {
      const idx = readFileSync(join(dir, 'sentences.idx'));
      return { vectors: new Uint8Array(readFileSync(join(dir, 'sentences.i8'))), starts: new Uint32Array(idx.buffer.slice(idx.byteOffset, idx.byteOffset + idx.byteLength)), dim: sv.dim };
    })();
    this.packs.set(manifest.id, { manifest, db, vectors, dim: manifest.embedding.dim, ...(sentences === undefined ? {} : { sentences }) });
    return manifest;
  }

  sentenceVectorsFor(chunkId: string): readonly Int8Array[] | undefined {
    const p = this.packs.get(chunkId.slice(0, chunkId.lastIndexOf(':')));
    const s = p?.sentences;
    if (p === undefined || s === undefined) return undefined;
    const ord = Number(chunkId.slice(chunkId.lastIndexOf(':') + 1));
    if (!Number.isInteger(ord) || ord + 1 >= s.starts.length) return undefined;
    const rows: Int8Array[] = [];
    for (let r = s.starts[ord]!; r < s.starts[ord + 1]!; r++) rows.push(vectorRow(s.vectors, r, s.dim));
    return rows;
  }


  manifests(): PackManifest[] {
    return [...this.packs.values()].map((p) => p.manifest);
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

  cardLineVectorsFor(chunkId: string): readonly Int8Array[] | undefined {
    const p = this.packs.get(chunkId.slice(0, chunkId.lastIndexOf(':')));
    const b64 = p?.manifest.cardLines?.[chunkId];
    return b64 === undefined || p === undefined ? undefined : splitRows(decodeBase64(b64), p.dim);
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

/** Reasoning tokens Qwen3 may spend before answering; 0 (the default) turns thinking off. */
const THINKING_BUDGET = Number(process.env.THINKING ?? 0);

/**
 * Bigger-answer-model research (2026-11-21). ANSWER_MODEL=<gguf> sends only the
 * final answer calls (the prompt that ends "ANSWER:") to a second model; every
 * routing, intent, opener and check call stays on the shipped model, so the
 * decisions are identical and only the written answer can change.
 * ANSWER_THINKING=<n> lets that model reason for up to n tokens first, at the
 * Qwen3 thinking settings. ANSWER_LOG=<file> appends each answer call's
 * question, reasoning, answer and time as one JSON line.
 */
const ANSWER_MODEL = process.env.ANSWER_MODEL;
const ANSWER_THINKING = Number(process.env.ANSWER_THINKING ?? 0);
const ANSWER_LOG = process.env.ANSWER_LOG;
const ANSWER_GPU = process.env.ANSWER_GPU === '1';
const isAnswerCall = (user: string): boolean => /\nANSWER:$/.test(user);

function samplingFor(genOpts: GenerateOptions, thinking = THINKING_BUDGET) {
  // Qwen3's model card for thinking mode: temperature 0.6, top-p 0.95, top-k
  // 20, min-p 0, and no greedy decoding, which loops while reasoning. The
  // device's repeat penalty is left off: it also penalises every word of the
  // reasoning, and with it the first thinking run came back empty.
  if (thinking > 0 && genOpts.temperature === undefined) {
    return { temperature: 0.6, topP: 0.95, topK: 20, minP: 0, seed: GEN_SEED } as const;
  }
  if (!QWEN_SAMPLING) {
    // Deep thinking's extra drafts (#21) sample at the model card's
    // non-greedy settings with a seed of their own, so each is repeatable.
    if ((genOpts.temperature ?? 0) > 0) {
      return { temperature: genOpts.temperature!, topP: 0.95, topK: 20, minP: 0, seed: genOpts.seed ?? GEN_SEED, repeatPenalty: { penalty: 1.15 } } as const;
    }
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
  // ANSWER_GPU=1 (research only): the answer model goes on the CUDA GPU and
  // everything else is pinned to the CPU, so the shipped model's decisions
  // stay those of the CPU runs.
  const llama = await getLlama(ANSWER_GPU ? { gpu: 'cuda' } : undefined);
  const cpuOnly = ANSWER_GPU ? { gpuLayers: 0 } : {};
  const embedModel: LlamaModel = await llama.loadModel({ modelPath: opts.embedModelPath ?? embedModelPathFor(opts.embedModelId), ...cpuOnly });
  const embedCtx = await embedModel.createEmbeddingContext();

  let genModel: LlamaModel | null = null;
  let genCtx: LlamaContext | null = null;
  if (opts.genModelPath) {
    genModel = await llama.loadModel({ modelPath: opts.genModelPath, ...cpuOnly });
    // sequences: Qwen3.5-2B exhausted the default pool on the fourth question
    // ("No sequences left") even though every sequence is disposed per call, so
    // the pool is sized explicitly. Generation is greedy at temperature 0, so
    // this changes capacity only, never output.
    genCtx = await genModel.createContext({ contextSize: 4096, sequences: 4 });
  }
  let ansModel: LlamaModel | null = null;
  let ansCtx: LlamaContext | null = null;
  if (ANSWER_MODEL !== undefined && genModel !== null) {
    ansModel = await llama.loadModel({ modelPath: ANSWER_MODEL, ...(ANSWER_GPU ? { gpuLayers: 'max' as const } : {}) });
    // Reasoning plus a long prompt does not fit 4096.
    ansCtx = await ansModel.createContext({ contextSize: 8192, sequences: 1 });
    console.log(`[answer-model] ${ANSWER_MODEL.split('/').pop()} thinking=${ANSWER_THINKING}`);
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

  let genTurn: Promise<void> = Promise.resolve();

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
      // One model call at a time, in the order asked, as on the phone
      // (device-pack.ts, exclusive). Two calls decoded together in one
      // context changed the intent check's word ("my wife's feeling dizzy":
      // NOW became CHAT) when the opener of #130 ran beside the pipeline.
      let release!: () => void;
      const mine = new Promise<void>((r) => { release = r; });
      const before = genTurn;
      genTurn = before.then(() => mine);
      await before;
      // A call stopped while it waited takes no sequence.
      if (genOpts.signal?.aborted === true) { release(); return; }
      // Acquire and release per call: a context owns a fixed pool of sequences,
      // and leaking them fails with "No sequences left" on the second question.
      const forAnswer = ansCtx !== null && isAnswerCall(prompt.user);
      const thinking = forAnswer ? ANSWER_THINKING : THINKING_BUDGET;
      const model = forAnswer ? ansModel! : genModel!;
      const started = Date.now();
      const sequence = (forAnswer ? ansCtx! : genCtx).getSequence();
      try {
        const session = new LlamaChatSession({
          contextSequence: sequence,
          systemPrompt: prompt.system,
        });

        // These three must mirror device-pack.ts. The shared-pipeline claim —
        // "the eval harness measures the code that ships" — held for retrieval
        // once embedder parity was fixed (docs/results-m3.md), but generation
        // was never aligned: the device sets enable_thinking false, greedy
        // decoding and penalty_repeat 1.15, and this side set none of them.
        //
        // Left as it was, the harness graded prose the phone never produces and
        // timed Qwen3's thinking tokens, which the device does not spend.
        // THINKING=<n> is the #36 experiment: Qwen3 may reason for up to n
        // tokens before answering, on top of the answer's own budget, so the
        // reasoning cannot starve the visible answer (which is what emptied the
        // answers the first time thinking was tried). Off by default, as on
        // the device.
        // Fred's prompt ("two or three short sentences and nothing else ...
        // ANSWER:") leads Qwen3 to skip reasoning entirely: 0 tokens on every
        // smoke question. /think is Qwen3's documented per-message switch.
        const user = thinking > 0 && !forAnswer ? `${prompt.user}\n/think` : prompt.user;
        const meta = await session.promptWithMeta(user, {
          maxTokens: genOpts.maxTokens + thinking,
          ...(genOpts.signal === undefined ? {} : { signal: genOpts.signal, stopOnAbortSignal: true }),
          ...samplingFor(genOpts, thinking),
          budgets: { thoughtTokens: thinking },
        });
        // Qwen3 sometimes writes its closing </think> as plain text rather than
        // the special token, so the library files the whole answer under the
        // reasoning segment and returns nothing as the reply. The answer is
        // whatever follows that tag.
        let answer = '', thought = '';
        for (const part of meta.response) {
          if (typeof part === 'string') { answer += part; continue; }
          if (part.type !== 'segment') continue;
          const close = part.text.indexOf('</think>');
          if (close === -1) { thought += part.text; continue; }
          thought += part.text.slice(0, close);
          answer += part.text.slice(close + '</think>'.length);
        }
        // A template that opens <think> itself (Qwen3-*-Thinking-2507) leaves
        // the reasoning in the plain text, closed by a bare </think>.
        const bare = answer.lastIndexOf('</think>');
        if (bare !== -1) { thought += answer.slice(0, bare); answer = answer.slice(bare + '</think>'.length); }
        // Out of reasoning budget with no answer: nothing is shown.
        if (thinking > 0) console.log(`[think] ${model.tokenize(thought).length} reasoning tokens`);
        if (forAnswer && ANSWER_LOG !== undefined) {
          const q = /QUESTION: (.*)/.exec(prompt.user)?.[1] ?? '';
          appendFileSync(ANSWER_LOG, JSON.stringify({ q, thought: thought.trim(), answer: answer.trim(), ms: Date.now() - started }) + '\n');
        }
        yield answer.trim();
      } finally {
        sequence.dispose();
        release();
      }
    },
    async dispose() {
      await embedCtx.dispose();
      await embedModel.dispose();
      if (genCtx) await genCtx.dispose();
      if (genModel) await genModel.dispose();
      if (ansCtx) await ansCtx.dispose();
      if (ansModel) await ansModel.dispose();
    },
  };
}
