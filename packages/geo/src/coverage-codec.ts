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
