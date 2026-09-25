/**
 * GGUF embedder, for encoders the shared ONNX path does not cover.
 *
 * EmbeddingGemma-300M is a Gemma tokenizer and a Gemma graph with two dense
 * projections after pooling, none of which the WordPiece/BERT path in
 * onnx-embed.ts implements. llama.cpp runs it natively, and llama.rn 0.12.9 on
 * the phone ships the same architecture (LLM_ARCH_GEMMA_EMBEDDING).
 *
 * The reason onnx-embed.ts exists is that two llama.cpp wrappers once disagreed
 * on the same model (docs/results-m3.md). That risk is back for any pack built
 * here, so the pack's probe vector is what decides: the phone must reproduce it
 * before this encoder ships, and `verifyEmbedderParity` refuses a pack that it
 * cannot.
 *
 * Measured on the core packs: right passage in the top 4 for 66% of cited
 * tuning questions against gte-small's 54% (docs/results-strategy-research.md §1f).
 */
import { getLlama } from 'node-llama-cpp';
import type { EmbeddingSpec } from '@fred/pack-format';
import { l2Normalize } from '@fred/rag-core';
import { calibrateFloor, CALIBRATION_TEXTS, PROBE_TEXT, type OnnxEmbedder } from './onnx-embed.ts';

export interface GgufEncoder {
  readonly modelId: string;
  readonly file: string;
  /** Query-side wrapper, stored in the pack. `{text}` is the question. */
  readonly queryTemplate?: string;
  /** Passage-side wrapper. `{title}` is the section, `{text}` the chunk. */
  readonly documentTemplate?: string;
  readonly contextSize: number;
}

export const EMBEDDING_GEMMA: GgufEncoder = {
  modelId: 'google/embeddinggemma-300m',
  file: 'embeddinggemma-300M-Q8_0.gguf',
  // From the model card's retrieval prompts.
  queryTemplate: 'task: search result | query: {text}',
  documentTemplate: 'title: {title} | text: {text}',
  contextSize: 2048,
};

export function documentText(enc: GgufEncoder, title: string, text: string): string {
  return enc.documentTemplate === undefined
    ? text
    : enc.documentTemplate.replace('{title}', title === '' ? 'none' : title).replace('{text}', text);
}

export async function loadGgufEmbedder(enc: GgufEncoder): Promise<OnnxEmbedder> {
  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath: `${process.env.HOME}/models/${enc.file}` });
  const ctx = await model.createEmbeddingContext({ contextSize: enc.contextSize });

  const embedMany = async (texts: readonly string[]): Promise<Float32Array[]> => {
    const out: Float32Array[] = [];
    for (const t of texts) {
      out.push(l2Normalize(Float32Array.from((await ctx.getEmbeddingFor(t)).vector)));
    }
    return out;
  };

  const calibration = await embedMany(CALIBRATION_TEXTS);
  const dim = calibration[0]?.length ?? 0;
  if (dim === 0) throw new Error('embedder returned zero-length vectors');
  // The probe is embedded raw, exactly as backend.embed() will see it at load;
  // query templating happens above the backend, in retrieve().
  const probe = (await embedMany([PROBE_TEXT]))[0] as Float32Array;

  const spec: EmbeddingSpec = {
    modelId: enc.modelId,
    dim,
    quantization: 'int8-per-row',
    normalized: true,
    cosineFloor: calibrateFloor(calibration),
    probe: { text: PROBE_TEXT, vector: Array.from(probe) },
    ...(enc.queryTemplate === undefined ? {} : { queryTemplate: enc.queryTemplate }),
    ...(enc.documentTemplate === undefined ? {} : { documentTemplate: enc.documentTemplate }),
  };
  return {
    spec,
    embed: embedMany,
    tokenCount: (text: string) => model.tokenize(text).length,
    dispose: async () => {
      await ctx.dispose();
      await model.dispose();
    },
  };
}
