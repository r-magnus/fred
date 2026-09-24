/**
 * ONNX embedder: shared tokenizer, shared pooling, reference ONNX weights.
 *
 * Replaces the llama.cpp embedding path. The problem it solves is not that
 * llama.cpp was slow but that two of its wrappers disagreed: node-llama-cpp
 * matched the reference while llama.rn did not, and cosine was being computed
 * across two vector spaces with every piece of metadata agreeing
 * (docs/results-m3.md).
 *
 * Running the same ONNX graph, fed by the same TypeScript tokenizer and reduced
 * by the same TypeScript pooling, makes parity structural: the only thing that
 * differs between ingest and device is the ONNX execution provider, and ONNX is
 * numerically reproducible across them.
 */
import { readFileSync } from 'node:fs';
import * as ort from 'onnxruntime-node';
import {
  buildVocab, encode, l2Normalize, meanPool, type TokenizerConfig,
} from '@fred/rag-core';
import type { EmbeddingSpec } from '@fred/pack-format';

export interface OnnxEmbedder {
  readonly spec: EmbeddingSpec;
  embed(texts: readonly string[]): Promise<Float32Array[]>;
  tokenCount(text: string): number;
  dispose(): Promise<void>;
}

/** Unrelated pairs, for measuring where this encoder's cosine bottoms out. */
export const CALIBRATION_TEXTS: readonly string[] = [
  'how do I control severe arterial bleeding from a limb',
  'the migration patterns of arctic terns across ocean basins',
  'compiling a static library for an embedded microcontroller',
  'baking sourdough requires a mature starter and long fermentation',
  'quarterly amortization schedules for commercial real estate',
  'identifying edible mushrooms by spore print and gill attachment',
  'the harmonic series diverges more slowly than any positive power',
  'replacing the timing belt on a four cylinder engine',
];

export const PROBE_TEXT = 'control severe external bleeding';

function cosine(a: Float32Array, b: Float32Array): number {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number, y = b[i] as number;
    d += x * y; na += x * x; nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : d / (Math.sqrt(na) * Math.sqrt(nb));
}

export function calibrateFloor(vectors: readonly Float32Array[]): number {
  const sims: number[] = [];
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      sims.push(cosine(vectors[i] as Float32Array, vectors[j] as Float32Array));
    }
  }
  if (sims.length === 0) return 0;
  sims.sort((a, b) => a - b);
  return Math.max(0, sims[Math.min(sims.length - 1, Math.floor(sims.length * 0.9))] as number);
}

async function runOne(
  session: ort.InferenceSession,
  ids: number[],
): Promise<{ hidden: Float32Array; dim: number; mask: number[] }> {
  const n = ids.length;
  const mask = new Array<number>(n).fill(1);
  const big = (xs: number[]): BigInt64Array => BigInt64Array.from(xs.map((x) => BigInt(x)));
  const feeds: Record<string, ort.Tensor> = {
    input_ids: new ort.Tensor('int64', big(ids), [1, n]),
    attention_mask: new ort.Tensor('int64', big(mask), [1, n]),
  };
  // BERT exports usually take token_type_ids; supply zeros when the graph wants it.
  if (session.inputNames.includes('token_type_ids')) {
    feeds['token_type_ids'] = new ort.Tensor('int64', big(new Array<number>(n).fill(0)), [1, n]);
  }
  const out = await session.run(feeds);
  const name = session.outputNames[0] as string;
  const tensor = out[name] as ort.Tensor;
  const dims = tensor.dims;
  return {
    hidden: tensor.data as Float32Array,
    dim: dims[dims.length - 1] as number,
    mask,
  };
}

export async function loadOnnxEmbedder(
  modelPath: string,
  vocabPath: string,
  modelId: string,
): Promise<OnnxEmbedder> {
  const session = await ort.InferenceSession.create(modelPath);
  const cfg: TokenizerConfig = buildVocab(readFileSync(vocabPath, 'utf8'));

  const embedMany = async (texts: readonly string[]): Promise<Float32Array[]> => {
    const out: Float32Array[] = [];
    for (const text of texts) {
      const ids = encode(text, cfg);
      const { hidden, dim, mask } = await runOne(session, ids);
      out.push(l2Normalize(meanPool(hidden, mask, dim)));
    }
    return out;
  };

  const calibration = await embedMany(CALIBRATION_TEXTS);
  const dim = calibration[0]?.length ?? 0;
  if (dim === 0) throw new Error('embedder returned zero-length vectors');
  const probe = (await embedMany([PROBE_TEXT]))[0] as Float32Array;

  return {
    spec: {
      modelId,
      dim,
      quantization: 'int8-per-row',
      normalized: true,
      cosineFloor: calibrateFloor(calibration),
      probe: { text: PROBE_TEXT, vector: Array.from(probe) },
    },
    embed: embedMany,
    tokenCount: (text: string) => encode(text, cfg).length,
    dispose: async () => { await session.release(); },
  };
}
