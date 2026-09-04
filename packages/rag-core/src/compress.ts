/**
 * Stage 3 — Selective Context Compression (PocketRAG §3.4.1).
 *
 * Trims retrieved context by 20-40% before prefill, which is the dominant cost in
 * on-device RAG. The paper scores sentences by query-keyword overlap and domain
 * terms and drops the weakest.
 *
 * We add one constraint the paper does not have, and it is the important part:
 * ORDERED PROCEDURES ARE ATOMIC. First-aid and survival content is largely
 * step-wise. Dropping step 3 of a 5-step bleeding-control or CPR sequence produces
 * fluent, confident, incomplete instructions — the worst possible failure in this
 * domain. Procedure blocks are therefore included whole or not at all, and they
 * are never counted as droppable no matter how low they score.
 */
import type { ChunkRecord } from '@fred/pack-format';
import { domainTermDensity, type Keyword } from './lexicon.ts';
import { chunkTermSet, lexicalScore } from './score.ts';

export interface CompressionOptions {
  /** Stop dropping once this fraction has been removed. Paper: 0.20. */
  readonly minReduction: number;
  /** Never remove more than this fraction. Paper: 0.40. */
  readonly maxReduction: number;
  readonly countTokens: (text: string) => number;
}

export const DEFAULT_COMPRESSION: Omit<CompressionOptions, 'countTokens'> = {
  minReduction: 0.2,
  maxReduction: 0.4,
};

export interface ChunkCompressionStat {
  readonly chunkId: string;
  readonly atomic: boolean;
  readonly sentencesKept: number;
  readonly sentencesTotal: number;
}

export interface CompressionResult {
  readonly chunks: readonly { readonly chunk: ChunkRecord; readonly text: string }[];
  readonly tokensBefore: number;
  readonly tokensAfter: number;
  /** Achieved reduction in [0,1]. May fall short of minReduction when most of the
   *  retrieved context is atomic — that is correct behaviour, not a failure. */
  readonly reduction: number;
  readonly perChunk: readonly ChunkCompressionStat[];
}

/**
 * Cheap token estimate for when no real tokenizer is available. English averages
 * roughly 4 characters per token. Backends with a tokenizer should pass their own
 * countTokens; the eval harness always does, so reported numbers are exact.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const ABBREVIATIONS = new Set([
  'dr', 'mr', 'mrs', 'ms', 'e.g', 'i.e', 'etc', 'vs', 'approx', 'fig', 'no',
  'st', 'ca', 'cf', 'min', 'max', 'sec', 'hr', 'mg', 'ml', 'cm', 'mm', 'kg',
]);

/**
 * Sentence splitter. Regex-based and deliberately simple: the corpora are edited
 * manuals with regular punctuation. Newlines terminate a sentence too, which keeps
 * list items separate. Known limits: no handling of quoted sentences or decimals
 * inside abbreviations.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let buf = '';
  const parts = text.split(/(\n+|(?<=[.!?])\s+)/);
  for (const part of parts) {
    if (part === undefined) continue;
    if (/^\n+$/.test(part)) {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      continue;
    }
    if (/^\s+$/.test(part)) {
      const trimmed = buf.trimEnd();
      const lastWord = trimmed.split(/[\s(]/).pop() ?? '';
      const bare = lastWord.replace(/\.$/, '').toLowerCase();
      if (ABBREVIATIONS.has(bare) || /^[A-Z]$/.test(bare)) {
        buf += part;
        continue;
      }
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      continue;
    }
    buf += part;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

/**
 * Runtime safety net for procedure detection.
 *
 * blockKind is assigned at ingest, but a mislabel here is a safety bug, so the
 * runtime re-checks. Anything that looks ordered is treated as atomic even if the
 * pack says 'prose'. False positives only cost a little compression.
 */
export function looksLikeProcedure(text: string): boolean {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const numbered = lines.filter((l) => /^(\d+[.)]|step\s+\d+|[a-z][.)])\s/i.test(l)).length;
  if (numbered >= 2) return true;
  if (/\bstep\s+\d+\b/i.test(text) && /\bstep\s+[2-9]\b/i.test(text)) return true;
  const bulleted = lines.filter((l) => /^[-*•]\s/.test(l)).length;
  if (bulleted >= 3) return true;
  return /\b(first|then|next|after that|finally)\b.*\b(then|next|finally)\b/is.test(text);
}

interface ScoredSentence {
  readonly chunkIndex: number;
  readonly sentenceIndex: number;
  readonly text: string;
  readonly tokens: number;
  readonly score: number;
  readonly droppable: boolean;
}

/** Relative contribution of query-term overlap vs. general domain vocabulary. */
const W_OVERLAP = 0.7;
const W_DENSITY = 0.3;

export function compressContext(
  chunks: readonly ChunkRecord[],
  keywords: readonly Keyword[],
  opts: CompressionOptions,
): CompressionResult {
  const { countTokens, minReduction, maxReduction } = opts;

  const perChunkSentences: string[][] = [];
  const atomicFlags: boolean[] = [];
  const scored: ScoredSentence[] = [];
  let tokensBefore = 0;

  chunks.forEach((chunk, chunkIndex) => {
    const atomic = chunk.blockKind === 'procedure' || looksLikeProcedure(chunk.text);
    atomicFlags.push(atomic);
    const sentences = splitSentences(chunk.text);
    perChunkSentences.push(sentences);

    sentences.forEach((text, sentenceIndex) => {
      const tokens = countTokens(text);
      tokensBefore += tokens;
      const overlap = lexicalScore(keywords, chunkTermSet(text));
      const density = domainTermDensity(text);
      // The opening sentence usually carries the topic; keep it pinned so a
      // surviving fragment never loses its subject.
      const droppable = !atomic && sentenceIndex > 0 && sentences.length > 1;
      scored.push({
        chunkIndex,
        sentenceIndex,
        text,
        tokens,
        score: W_OVERLAP * overlap + W_DENSITY * density,
        droppable,
      });
    });
  });

  const dropped = new Set<string>();
  if (tokensBefore > 0) {
    const minTarget = tokensBefore * (1 - maxReduction); // floor: never go below
    const stopAt = tokensBefore * (1 - minReduction); // enough once we reach here
    const candidates = scored
      .filter((s) => s.droppable)
      .sort((a, b) => a.score - b.score);

    let current = tokensBefore;
    for (const s of candidates) {
      if (current <= stopAt) break;
      if (current - s.tokens < minTarget) continue; // would overshoot the cap
      dropped.add(`${s.chunkIndex}:${s.sentenceIndex}`);
      current -= s.tokens;
    }
  }

  const outChunks: { chunk: ChunkRecord; text: string }[] = [];
  const perChunk: ChunkCompressionStat[] = [];
  let tokensAfter = 0;

  chunks.forEach((chunk, chunkIndex) => {
    const sentences = perChunkSentences[chunkIndex] ?? [];
    const kept = sentences.filter((_, i) => !dropped.has(`${chunkIndex}:${i}`));
    // A chunk is never emptied: an empty citation is worse than a long one.
    const finalSentences = kept.length > 0 ? kept : sentences.slice(0, 1);
    const text = finalSentences.join(' ');
    tokensAfter += countTokens(text);
    outChunks.push({ chunk, text });
    perChunk.push({
      chunkId: chunk.id,
      atomic: atomicFlags[chunkIndex] ?? false,
      sentencesKept: finalSentences.length,
      sentencesTotal: sentences.length,
    });
  });

  return {
    chunks: outChunks,
    tokensBefore,
    tokensAfter,
    reduction: tokensBefore === 0 ? 0 : 1 - tokensAfter / tokensBefore,
    perChunk,
  };
}
