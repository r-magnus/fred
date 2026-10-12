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
import { splitSentences, unwrapLines } from './compress.ts';
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
 * A paragraph or list item up to this long is quoted whole (about three
 * sentences). The sentence closest to a question is often the one beside the
 * answer: asked what to do about a smoke column, the closest sentence was
 * "travel safely to another lake" and the same list item began "Most fires
 * travel with the prevailing wind so have a route in mind that is in another
 * direction" (docs/results-assembled-grade.md).
 */
const MAX_QUOTED_PARAGRAPH = 360;

/** Without the bullet, the paragraph number ("3-10.") or a bare "Note." in front, as rows are. */
const unmarked = (s: string): string => s.replace(/^(?:[-*•]|\d+(?:-\d+)?\.|[a-z]\.|Note\.)\s+/, '').replace(/\s+/g, ' ');

/**
 * What is shown for an index row. Rows are cut at every line break, so a row
 * can be the back half of a sentence: the manual's "Avoid directly / eating
 * snow as it lowers the body's core temperature" was quoted without its first
 * two words (#23). Rows still rank; what is shown is the short paragraph the
 * row sits in, or else its whole sentence, or else the row itself.
 */
function shownFor(row: string, paragraphs: readonly string[], wholes: readonly string[]): string {
  const flat = row.replace(/\s+/g, ' ');
  const paragraph = paragraphs.find((p) => p.includes(flat));
  if (paragraph !== undefined && paragraph.length <= MAX_QUOTED_PARAGRAPH) return paragraph;
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
 * given as the short paragraph or whole sentence its row sits in. Passages whose rows don't match
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
    const body = bodyLines(p.text).join('\n');
    const paragraphs = unwrapLines(body).map(unmarked);
    const wholes = splitSentences(body).map(unmarked);
    sentences.forEach((text, i) => out.push({ chunkId: p.chunkId, text: shownFor(text, paragraphs, wholes), similarity: cosineInt8(q, p.rows![i]!) }));
  }
  return out.sort((a, b) => b.similarity - a.similarity);
}
