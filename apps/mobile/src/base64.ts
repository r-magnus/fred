/**
 * Base64 to bytes.
 *
 * Kept free of React Native imports so it can be tested under Node; the rest of
 * device-pack.ts cannot run off-device. vectors.i8 arrives base64-encoded from
 * expo-file-system, and a decoding bug here would not throw — it would produce
 * a buffer of the wrong length or wrong contents, and retrieval would return
 * confidently wrong neighbours.
 */
export function decodeBase64(b64: string): Uint8Array {
  const bin = globalThis.atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
