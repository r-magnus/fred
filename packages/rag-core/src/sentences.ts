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
import { splitSentences } from './compress.ts';
import { cosineInt8 } from './score.ts';

export const SENTENCE_DIM = 256;

/** Too short to quote on its own: a label, a stray fragment. */
const MIN_SENTENCE = 25;

function bodyLines(text: string): string[] {
  const lines = text.split('\n');
  const first = lines[0]?.trim() ?? '';
  return lines.length > 1 && first.length < 160 && !/[.!?:]$/.test(first) ? lines.slice(1) : lines;
}

/**
 * The quotable sentences of a passage, in order. A passage's first line is
 * its heading ("Title — Section") when it has no closing punctuation; it is
 * left out, since quoting a heading answers nothing. List items are sentences
 * of their own, without their bullet.
 */
export function quotableSentences(text: string): string[] {
  const out: string[] = [];
  for (const line of bodyLines(text)) {
    const l = line.trim().replace(/^[-*•]\s+/, '');
    if (l === '') continue;
    for (const s of l.split(/(?<=[.!?])\s+(?=[A-Z0-9"(“])/)) {
      const t = s.trim();
      if (t.length >= MIN_SENTENCE) out.push(t);
    }
  }
  return out;
}

/** Longer than this is a wrapped table or list, not a sentence: the row's own text is quoted. */
const MAX_WHOLE_SENTENCE = 400;

/**
 * The sentences of a passage as the reader would see them, wrapped lines
 * joined. Index rows are cut at every line break, so a row can be the back
 * half of a sentence: the manual's "Avoid directly / eating snow as it lowers
 * the body's core temperature" was quoted without its first two words (#23).
 * Rows still rank; what is shown is the sentence the row sits in.
 */
function wholeSentences(text: string): string[] {
  // Without the bullet or the paragraph number ("3-10.") in front, as rows are.
  return splitSentences(bodyLines(text).join('\n')).map((s) => s.replace(/^(?:[-*•]|\d+(?:-\d+)?\.|[a-z]\.)\s+/, '').replace(/\s+/g, ' '));
}

function wholeSentenceOf(row: string, wholes: readonly string[]): string {
  const flat = row.replace(/\s+/g, ' ');
  const whole = wholes.find((w) => w.includes(flat));
  return whole === undefined || whole.length > MAX_WHOLE_SENTENCE ? row : whole;
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
 * The sentences of these passages closest to the query, best first, each
 * given as the whole sentence its row sits in. Passages whose rows don't match
 * their split (a pack built from other text) are skipped, never guessed at.
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
    const wholes = wholeSentences(p.text);
    sentences.forEach((text, i) => out.push({ chunkId: p.chunkId, text: wholeSentenceOf(text, wholes), similarity: cosineInt8(q, p.rows![i]!) }));
  }
  return out.sort((a, b) => b.similarity - a.similarity);
}
