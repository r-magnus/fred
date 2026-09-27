/**
 * Wire format for a coverage pack.
 *
 * Measured on AT&T's California LTE footprint, 63,418 res-7 cells:
 *
 * | encoding | bytes |
 * |---|---:|
 * | JSON array of hex ids | 1,204,963 |
 * | gzipped JSON | 157,936 |
 * | delta varint | 254,339 |
 * | **delta varint, gzipped** | **8,833** |
 *
 * Sorting then storing gaps rather than values is what makes the difference:
 * coverage is contiguous, so consecutive cell ids differ by very little and the
 * gaps repeat, which gzip then crushes. `docs/beta-service-coverage.md`
 * budgeted "well under 100 KB" per state; this is an order of magnitude inside
 * that, so carrying every state at once costs well under a megabyte.
 *
 * H3 indices are 64-bit, so BigInt is used deliberately — a res-7 id exceeds
 * Number.MAX_SAFE_INTEGER and would silently round.
 */

/** Encode sorted res-7 cell ids as gzip-ready delta varints. */
export function encodeCells(cells: readonly string[]): Uint8Array {
  const ints = cells.map((c) => BigInt(`0x${c}`)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const out: number[] = [];
  let prev = 0n;
  for (const v of ints) {
    let d = v - prev;
    prev = v;
    // Varint: seven bits per byte, high bit marks "more to come".
    for (;;) {
      const b = Number(d & 0x7fn);
      d >>= 7n;
      out.push(d > 0n ? b | 0x80 : b);
      if (d === 0n) break;
    }
  }
  return Uint8Array.from(out);
}

/** Decode what `encodeCells` wrote, back to res-7 cell ids. */
export function decodeCells(bytes: Uint8Array): string[] {
  const cells: string[] = [];
  let acc = 0n;
  let shift = 0n;
  let prev = 0n;
  for (const byte of bytes) {
    acc |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) !== 0) { shift += 7n; continue; }
    prev += acc;
    cells.push(prev.toString(16));
    acc = 0n;
    shift = 0n;
  }
  return cells;
}

/**
 * One carrier's reported footprint in a pack. `id` is the FCC provider id
 * (`carriers.ts` maps a SIM to it); `name` is for display.
 */
export interface CarrierCoverage {
  readonly id: string;
  readonly name: string;
  readonly cells: ReadonlySet<string>;
}

/**
 * A state's coverage pack: every carrier's footprint kept apart, so the map can
 * say where *your* carrier has nothing and where *no* carrier has anything
 * (issue #58). The FCC's mobile voice layer: where a call can be made.
 */
export interface CoveragePack {
  /** The FCC filing the data comes from, e.g. "2025-12-31". */
  readonly asOf: string;
  readonly carriers: readonly CarrierCoverage[];
}

const MAGIC = [0x46, 0x43, 0x56, 0x32]; // "FCV2"

/**
 * Pack wire format, before gzip:
 *
 *   "FCV2" | u32 LE header length | header JSON (UTF-8) | cell blobs
 *
 * The header lists `{ id, name, bytes }` per carrier in blob order; each blob is
 * `encodeCells`. Carriers overlap heavily, but each footprint is contiguous, so
 * per-carrier delta runs still gzip to a few KB each.
 */
export function encodePack(pack: CoveragePack): Uint8Array {
  const blobs = pack.carriers.map((c) => encodeCells([...c.cells]));
  const header = new TextEncoder().encode(JSON.stringify({
    asOf: pack.asOf,
    carriers: pack.carriers.map((c, i) => ({ id: c.id, name: c.name, bytes: blobs[i]!.length })),
  }));
  const out = new Uint8Array(8 + header.length + blobs.reduce((s, b) => s + b.length, 0));
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, header.length, true);
  out.set(header, 8);
  let p = 8 + header.length;
  for (const b of blobs) { out.set(b, p); p += b.length; }
  return out;
}

/** Decode what `encodePack` wrote. Throws on anything else, including a v1 pack. */
export function decodePack(bytes: Uint8Array): CoveragePack {
  if (bytes.length < 8 || MAGIC.some((m, i) => bytes[i] !== m)) {
    throw new Error('not a coverage pack (FCV2)');
  }
  const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + len))) as {
    asOf: string; carriers: { id: string; name: string; bytes: number }[];
  };
  let p = 8 + len;
  const carriers = header.carriers.map((c) => {
    const cells = new Set(decodeCells(bytes.subarray(p, p + c.bytes)));
    p += c.bytes;
    return { id: c.id, name: c.name, cells };
  });
  if (p !== bytes.length) throw new Error(`coverage pack: ${bytes.length - p} trailing bytes`);
  return { asOf: header.asOf, carriers };
}
