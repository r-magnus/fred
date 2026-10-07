/**
 * Does this message need an answer from Fred? (experiment, docs/results-scope-scorer.md)
 *
 * The search score cannot say: "my husband just sliced his palm on a tin can"
 * scores 0.06 against the cuts card, below most small talk, and "which tent
 * should I buy" scores above it. A small trained scorer reads the message's
 * search vector, which is already made, so it costs no model call: one
 * weight per dimension, trained on messages written for it (in scope, out of
 * scope, small talk) that share no wording with any test set.
 *
 * It never answers anything by itself. It only gives a second chance to a
 * message the rules were about to call small talk or decline.
 */
export interface ScopeModel {
  readonly w: readonly number[];
  readonly b: number;
  /** The vector is scaled to this length before scoring, as in training. */
  readonly scale: number;
  /** At or above this, the message is taken to need an answer. */
  readonly threshold: number;
}

export function scopeScore(model: ScopeModel, vec: Float32Array): number {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i]! * vec[i]!;
  const k = norm === 0 ? 0 : model.scale / Math.sqrt(norm);
  let z = model.b;
  for (let i = 0; i < vec.length; i++) z += model.w[i]! * vec[i]! * k;
  return z;
}

/** A statement in scope is searched again as a request for what to do. */
export function asRequest(message: string): string {
  return `${message.replace(/[.!\s]+$/, '')}. what should i do?`;
}
