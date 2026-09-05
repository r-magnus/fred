/**
 * Base64 to bytes.
 *
 * Lives in rag-core rather than the app because it is pure and needs to be
 * typechecked and tested alongside the vector code it feeds. vectors.i8 arrives
 * base64-encoded from expo-file-system, and a decoding bug here would not throw
 * — it would produce a buffer of the wrong length or wrong contents, and
 * retrieval would return confidently wrong neighbours.
 */
export function decodeBase64(b64: string): Uint8Array {
  const bin = globalThis.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
