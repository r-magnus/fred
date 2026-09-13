/**
 * Mean pooling and L2 normalization, shared by ingest and the device.
 *
 * The third piece that must be identical on both sides. Sharing the model file
 * and the tokenizer still leaves room for divergence if one runtime pools over
 * padding and the other does not, or if one normalizes and the other does not —
 * and pooling differences change vector *direction*, which cosine cannot forgive.
 */

/**
 * Mean-pool a [tokens x dim] hidden state, ignoring padded positions.
 *
 * `hidden` is row-major: token t occupies [t*dim, (t+1)*dim). `mask` is 1 for
 * real tokens and 0 for padding. gte-small is trained with mean pooling
 * (`bert.pooling_type = 1` in the GGUF metadata).
 */
export function meanPool(
  hidden: Float32Array | readonly number[],
  mask: readonly number[],
  dim: number,
): Float32Array {
  const out = new Float32Array(dim);
  let counted = 0;
  for (let t = 0; t < mask.length; t++) {
    if (mask[t] !== 1) continue;
    counted++;
    const base = t * dim;
    for (let d = 0; d < dim; d++) {
      out[d] = (out[d] as number) + (hidden[base + d] as number);
    }
  }
  if (counted === 0) return out;
  for (let d = 0; d < dim; d++) out[d] = (out[d] as number) / counted;
  return out;
}

/** L2-normalize in place and return, so cosine reduces to a dot product. */
export function l2Normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += (v[i] as number) ** 2;
  const norm = Math.sqrt(sum);
  if (norm === 0) return v;
  for (let i = 0; i < v.length; i++) v[i] = (v[i] as number) / norm;
  return v;
}
