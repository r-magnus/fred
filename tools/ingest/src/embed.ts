/**
 * Embedding and encoder calibration.
 *
 * Uses node-llama-cpp — the SAME llama.cpp that tools/eval and (via llama.rn)
 * the app use. Embedding the corpus with one implementation and queries with
 * another (say sentence-transformers here, llama.cpp on device) introduces a
 * numerical mismatch between index and query vectors that degrades cosine
 * similarity in a way no test would catch. One engine, both sides.
 */
import { getLlama, type Llama, type LlamaModel } from 'node-llama-cpp';
import type { EmbeddingSpec } from '@fred/pack-format';

export interface Embedder {
  readonly spec: EmbeddingSpec;
  embed(texts: readonly string[]): Promise<Float32Array[]>;
  tokenCount(text: string): number;
  dispose(): Promise<void>;
}

/**
 * Text pairs with no topical relationship, used to measure where this encoder's
 * cosine actually bottoms out. See EmbeddingSpec.cosineFloor — sentence encoders
 * do not spread cosine over [0,1], and an uncalibrated threshold silently
 * disables the abstention gate.
 */
const CALIBRATION_TEXTS: readonly string[] = [
  'how do I control severe arterial bleeding from a limb',
  'the migration patterns of arctic terns across ocean basins',
  'compiling a static library for an embedded microcontroller',
  'baking sourdough requires a mature starter and long fermentation',
  'quarterly amortization schedules for commercial real estate',
  'identifying edible mushrooms by spore print and gill attachment',
  'the harmonic series diverges more slowly than any positive power',
  'replacing the timing belt on a four cylinder engine',
];

function cosine(a: Float32Array, b: Float32Array): number {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number, y = b[i] as number;
    d += x * y; na += x * x; nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : d / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * The floor is the 90th percentile of unrelated-pair cosine, not the mean:
 * the gate should be calibrated against this encoder's plausible worst case,
 * so that genuinely unrelated content reliably scores at or below zero.
 */
export function calibrateFloor(vectors: readonly Float32Array[]): number {
  const sims: number[] = [];
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      sims.push(cosine(vectors[i] as Float32Array, vectors[j] as Float32Array));
    }
  }
  if (sims.length === 0) return 0;
  sims.sort((a, b) => a - b);
  const idx = Math.min(sims.length - 1, Math.floor(sims.length * 0.9));
  return Math.max(0, sims[idx] as number);
}

export async function loadEmbedder(modelPath: string, modelId: string): Promise<Embedder> {
  const llama: Llama = await getLlama();
  const model: LlamaModel = await llama.loadModel({ modelPath });
  const ctx = await model.createEmbeddingContext();

  const embedMany = async (texts: readonly string[]): Promise<Float32Array[]> => {
    const out: Float32Array[] = [];
    for (const t of texts) {
      const e = await ctx.getEmbeddingFor(t);
      out.push(Float32Array.from(e.vector));
    }
    return out;
  };

  const calibration = await embedMany(CALIBRATION_TEXTS);
  const cosineFloor = calibrateFloor(calibration);
  const dim = calibration[0]?.length ?? 0;
  if (dim === 0) throw new Error('embedder returned zero-length vectors');

  // A canonical probe so any runtime can verify it reproduces these embeddings.
  const PROBE_TEXT = 'control severe external bleeding';
  const probeRaw = (await embedMany([PROBE_TEXT]))[0] as Float32Array;
  let pn = 0;
  for (const x of probeRaw) pn += x * x;
  pn = Math.sqrt(pn) || 1;

  const spec: EmbeddingSpec = {
    modelId,
    dim,
    quantization: 'int8-per-row',
    normalized: true,
    cosineFloor,
    probe: { text: PROBE_TEXT, vector: Array.from(probeRaw, (x) => x / pn) },
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
