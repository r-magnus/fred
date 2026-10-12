/**
 * What does this message say happened? (#152, docs/results-said-as.md)
 *
 * A plain statement matches a field card's text poorly: "my friend just
 * collapsed and is jerking all over" led the search with the shock card at
 * 0.174 and the seizure card at 0.125, "my daughter went down on the gravel
 * and her shin is all torn up" with the sprain card at 0.118. Under the gate
 * the card that leads is close to chance, and the rules that open a card for
 * an emergency opened the wrong one.
 *
 * So each card has example messages (corpora/cards/said-as.tsv), with more
 * for things no card is for: a pet, a medicine or a procedure, a small
 * ailment, gear, weather and wildlife, small talk. A small trained matcher
 * reads the message's search vector, which is already made, and gives each
 * label a share: one row of weights per label. No model call.
 *
 * It never decides whether Fred answers. It says which card a message is
 * about, when the pipeline has already decided to open one, and it names a
 * pet or a medicine the word lists do not know.
 */
import { decodeBase64 } from './base64.ts';

export interface SaidAsModel {
  /** A field card's title, or "none:<kind>" for a message no card is for. */
  readonly labels: readonly string[];
  readonly dim: number;
  /** One row of int8 weights per label, base64; row i is multiplied by scales[i]. */
  readonly w: string;
  readonly scales: readonly number[];
  readonly b: readonly number[];
  /** The vector is scaled to this length before scoring, as in training. */
  readonly scale: number;
  /** At or above this share, the top label is taken as what the message says. */
  readonly sure: number;
  /** At or above this share, a card can replace one the message does not support. */
  readonly leans: number;
  /**
   * At or above this share for the no-card labels together, the message is
   * one no card is for, whichever kind it is. The matcher is often unsure
   * which kind ("none:other" 0.56) and right that it is one: on examples it
   * never saw, 99 in 100 at this share (docs/results-unsure-label.md).
   */
  readonly noCard?: number;
}

export interface Said {
  readonly label: string;
  /** The label's share, 0 to 1; the shares of all labels add up to 1. */
  readonly p: number;
}

const rows = new WeakMap<SaidAsModel, Int8Array>();

/** Every label with its share, largest first. */
export function saidAs(model: SaidAsModel, vec: Float32Array): Said[] {
  let w = rows.get(model);
  if (w === undefined) {
    const bytes = decodeBase64(model.w);
    w = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    rows.set(model, w);
  }
  let norm = 0;
  for (let j = 0; j < model.dim; j++) norm += vec[j]! * vec[j]!;
  const k = norm === 0 ? 0 : model.scale / Math.sqrt(norm);
  const z = model.labels.map((_, i) => {
    let s = 0;
    const at = i * model.dim;
    for (let j = 0; j < model.dim; j++) s += w![at + j]! * vec[j]!;
    return s * model.scales[i]! * k + model.b[i]!;
  });
  const max = Math.max(...z);
  const e = z.map((x) => Math.exp(x - max));
  const sum = e.reduce((a, x) => a + x, 0);
  return model.labels.map((label, i) => ({ label, p: e[i]! / sum })).sort((a, b) => b.p - a.p);
}

/** The kind of a "none:<kind>" label, or undefined for a card. */
export function noCardKind(label: string): string | undefined {
  return label.startsWith('none:') ? label.slice(5) : undefined;
}

/**
 * The no-card labels' share together. A follow-up fragment is left out: it
 * says the message has nothing of its own, not that no card is for it.
 */
export function noCardShare(said: readonly Said[]): number {
  return said.reduce((a, x) => (x.label.startsWith('none:') && x.label !== 'none:fragment' ? a + x.p : a), 0);
}
