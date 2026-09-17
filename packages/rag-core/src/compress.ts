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
  /**
   * Exact token counts for every sentence, in one call.
   *
   * Batched because llama.rn tokenizes across a native bridge; a per-sentence
   * call would cost one round trip each, and a synchronous signature cannot be
   * satisfied there at all.
   */
  readonly countTokens: (texts: readonly string[]) => Promise<number[]>;
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
 * Character-based fallback, for tests and for backends with no tokenizer at all.
 *
 * NOT for production paths: an approximation here makes compression ratios and
 * the adaptive token budget diverge between device and harness, which defeats
 * the point of sharing the pipeline. Both real backends tokenize exactly.
 */
export function estimateTokens(texts: readonly string[]): Promise<number[]> {
  return Promise.resolve(texts.map((t) => Math.ceil(t.length / 4)));
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

/**
 * Per-rank decay applied to a sentence's keep-score.
 *
 * Compression used to score every sentence across every chunk on one scale, with
 * no notion that Stage 2 had already ranked the chunks. A sentence from the
 * best-matching chunk competed on equal terms with one from the fourth, so the
 * winning chunk could be trimmed while a distractor was preserved whole.
 *
 * That matters because the graded eval found the answering material present in
 * the retrieved context for 21 of 23 failures (docs/results-akr2.md) — retrieval
 * was right and the generator read the wrong part. Handing it a context where the
 * top chunk has been thinned makes that worse.
 *
 * It is also actively wrong when the question carries a negation. For "how can I
 * find north WITHOUT a compass", overlap scoring keeps every sentence containing
 * "compass" and drops the star-navigation sentences that do not — so compression
 * selects against the answer. Rank decay does not fix negation, but it stops the
 * distractor outranking the passage retrieval actually chose.
 *
 * 0.75 per rank: at topK=4 the fourth chunk's sentences score 0.42x the first's,
 * enough to be dropped first without ever emptying it (a chunk is never emptied).
 *
 * RANK_FLOOR exists because decay alone cannot separate a tie at zero. A sentence
 * with no query overlap and no domain terms scores 0, and 0 x 0.75^n is still 0 at
 * every rank — so the top chunk's filler and the fourth chunk's filler tied, and
 * the tie broke on array order, which dropped the top chunk's sentence first. The
 * floor is added before the decay so every sentence carries some rank signal.
 */
const RANK_DECAY = 0.75;
const RANK_FLOOR = 0.05;

export async function compressContext(
  chunks: readonly ChunkRecord[],
  keywords: readonly Keyword[],
  opts: CompressionOptions,
): Promise<CompressionResult> {
  const { countTokens, minReduction, maxReduction } = opts;

  const perChunkSentences: string[][] = [];
  const atomicFlags: boolean[] = [];

  chunks.forEach((chunk) => {
    perChunkSentences.push(splitSentences(chunk.text));
    atomicFlags.push(chunk.blockKind === 'procedure' || looksLikeProcedure(chunk.text));
  });

  // One tokenizer call for every sentence across every chunk.
  const flat = perChunkSentences.flat();
  const counts = await countTokens(flat);
  if (counts.length !== flat.length) {
    throw new Error(`countTokens returned ${counts.length} counts for ${flat.length} strings`);
  }
  const tokensOf = new Map<string, number>();
  flat.forEach((s, i) => tokensOf.set(`${i}`, counts[i] ?? 0));

  const scored: ScoredSentence[] = [];
  let tokensBefore = 0;
  let flatIndex = 0;

  chunks.forEach((chunk, chunkIndex) => {
    const atomic = atomicFlags[chunkIndex] ?? false;
    const sentences = perChunkSentences[chunkIndex] ?? [];

    sentences.forEach((text, sentenceIndex) => {
      const tokens = tokensOf.get(`${flatIndex}`) ?? 0;
      flatIndex++;
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
        score: (W_OVERLAP * overlap + W_DENSITY * density + RANK_FLOOR) * Math.pow(RANK_DECAY, chunkIndex),
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
  const keptTexts: string[] = [];

  chunks.forEach((chunk, chunkIndex) => {
    const sentences = perChunkSentences[chunkIndex] ?? [];
    const kept = sentences.filter((_, i) => !dropped.has(`${chunkIndex}:${i}`));
    // A chunk is never emptied: an empty citation is worse than a long one.
    const finalSentences = kept.length > 0 ? kept : sentences.slice(0, 1);
    const text = finalSentences.join(' ');
    keptTexts.push(text);
    outChunks.push({ chunk, text });
    perChunk.push({
      chunkId: chunk.id,
      atomic: atomicFlags[chunkIndex] ?? false,
      sentencesKept: finalSentences.length,
      sentencesTotal: sentences.length,
    });
  });

  // Second and final tokenizer call, for the assembled result.
  const afterCounts = await countTokens(keptTexts);
  const tokensAfter = afterCounts.reduce((a, b) => a + b, 0);

  return {
    chunks: outChunks,
    tokensBefore,
    tokensAfter,
    reduction: tokensBefore === 0 ? 0 : 1 - tokensAfter / tokensBefore,
    perChunk,
  };
}
