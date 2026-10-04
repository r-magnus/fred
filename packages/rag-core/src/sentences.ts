/**
 * The sentence index (docs/plan-grounded-answers.md, #126).
 *
 * A pack can carry one vector per sentence of every passage, so Fred can quote
 * the sentences that answer a question instead of declining, or instead of a
 * model-written answer whose numbers have no source. The split below is used
 * at ingest and at run time alike: rows line up with sentences only because
 * both sides split the same way.
 *
 * Rows use the first SENTENCE_DIM of the encoder's dimensions, re-normalised.
 * EmbeddingGemma is Matryoshka-trained, so the leading dimensions carry most of
 * the meaning; 256 of 768 keeps the index to about a third of the size.
 */
import { cosineInt8 } from './score.ts';

export const SENTENCE_DIM = 256;

/** Too short to quote on its own: a label, a stray fragment. */
const MIN_SENTENCE = 25;

/**
 * The quotable sentences of a passage, in order. A passage's first line is
 * its heading ("Title — Section") when it has no closing punctuation; it is
 * left out, since quoting a heading answers nothing. List items are sentences
 * of their own, without their bullet.
 */
export function quotableSentences(text: string): string[] {
  const lines = text.split('\n');
  const first = lines[0]?.trim() ?? '';
  const body = lines.length > 1 && first.length < 160 && !/[.!?:]$/.test(first) ? lines.slice(1) : lines;
  const out: string[] = [];
  for (const line of body) {
    const l = line.trim().replace(/^[-*•]\s+/, '');
    if (l === '') continue;
    for (const s of l.split(/(?<=[.!?])\s+(?=[A-Z0-9"(“])/)) {
      const t = s.trim();
      if (t.length >= MIN_SENTENCE) out.push(t);
    }
  }
  return out;
}

/** The first SENTENCE_DIM dimensions, re-normalised to unit length. */
export function truncateVector(v: Float32Array, dim = SENTENCE_DIM): Float32Array {
  const out = v.slice(0, dim);
  let n = 0;
  for (let i = 0; i < out.length; i++) n += out[i]! * out[i]!;
  const k = n === 0 ? 1 : 1 / Math.sqrt(n);
  for (let i = 0; i < out.length; i++) out[i] = out[i]! * k;
  return out;
}

export interface QuotedSentence {
  readonly chunkId: string;
  readonly text: string;
  readonly similarity: number;
}

/**
 * The sentences of these passages closest to the query, best first. Passages
 * whose rows don't match their split (a pack built from other text) are
 * skipped, never guessed at.
 */
export function rankSentences(
  queryVec: Float32Array,
  passages: readonly { readonly chunkId: string; readonly text: string; readonly rows: readonly Int8Array[] | undefined }[],
): QuotedSentence[] {
  const q = truncateVector(queryVec);
  const out: QuotedSentence[] = [];
  for (const p of passages) {
    const sentences = quotableSentences(p.text);
    if (p.rows === undefined || p.rows.length !== sentences.length) continue;
    sentences.forEach((text, i) => out.push({ chunkId: p.chunkId, text, similarity: cosineInt8(q, p.rows![i]!) }));
  }
  return out.sort((a, b) => b.similarity - a.similarity);
}
