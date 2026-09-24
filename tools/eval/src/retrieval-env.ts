/**
 * Retrieval settings from the environment, so a comparison between two search
 * configurations is a change of variables rather than an edit to rag-core.
 *
 *   RETRIEVAL_QUERY=question|keywords   what the query vector is built from
 *   DENSE_POOL=<n>                      nearest-by-meaning chunks per pack (0 = off)
 *   TOPK=<n>                            chunks handed to the generator
 *   ALPHA=<0..1>                        weight of meaning vs keyword score in the blend
 *
 * Every run prints the settings it used, because a results file that does not
 * say how it was produced is not evidence.
 */
import { DEFAULT_RETRIEVAL, type RetrievalOptions } from '@fred/rag-core';

function int(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new Error(`${name} must be an integer >= ${min}, got ${raw}`);
  return n;
}

function alphaFromEnv(): number {
  const raw = process.env.ALPHA;
  if (raw === undefined) return DEFAULT_RETRIEVAL.alpha;
  const a = Number(raw);
  if (!(a >= 0 && a <= 1)) throw new Error(`ALPHA must be between 0 and 1, got ${raw}`);
  return a;
}

export function retrievalFromEnv(): RetrievalOptions {
  const q = process.env.RETRIEVAL_QUERY ?? DEFAULT_RETRIEVAL.queryInput;
  if (q !== 'question' && q !== 'keywords') throw new Error(`RETRIEVAL_QUERY must be question or keywords, got ${q}`);
  return {
    ...DEFAULT_RETRIEVAL,
    queryInput: q,
    densePool: int('DENSE_POOL', DEFAULT_RETRIEVAL.densePool, 0),
    topK: int('TOPK', DEFAULT_RETRIEVAL.topK, 1),
    alpha: alphaFromEnv(),
  };
}

export function describeRetrieval(r: RetrievalOptions): string {
  return `query=${r.queryInput} densePool=${r.densePool} topK=${r.topK} alpha=${r.alpha}`;
}

/** COMPRESS=0 hands passages to the model whole. Unset keeps the shipping bounds. */
export function compressionFromEnv(): { minReduction: number; maxReduction: number } | undefined {
  const raw = process.env.COMPRESS;
  if (raw === undefined || raw === '1') return undefined;
  if (raw === '0') return { minReduction: 0, maxReduction: 0 };
  throw new Error(`COMPRESS must be 0 or 1, got ${raw}`);
}
