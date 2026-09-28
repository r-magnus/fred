/**
 * Neighbouring passages, given as one (docs/results-noise-research.md, option 1).
 *
 * Passages are 300-token windows that overlap by about 50 tokens, so when two
 * of the four Fred reads are neighbours (two answers in three), the overlap is
 * read twice and a procedure can arrive in two pieces: the bow-drill steps did.
 * Joining them removes the repeat and keeps the text in reading order. Nothing
 * is dropped, and no passage is added.
 */
import type { ChunkRecord } from '@fred/pack-format';

/** The shortest overlap trusted as a real one, in characters. */
const MIN_OVERLAP = 20;

/**
 * `a` then `b`, with the stretch they share written once. A continuation
 * window can start with a repeated list lead-in ("…fire-starter (see figure
 * 5-10):") before the overlap, so the match is also tried without b's first line.
 */
export function mergeText(a: string, b: string): string {
  const firstBreak = b.indexOf('\n');
  const tails = firstBreak === -1 ? [b] : [b, b.slice(firstBreak + 1)];
  for (const tail of tails) {
    for (let k = Math.min(a.length, tail.length); k >= MIN_OVERLAP; k--) {
      if (a.endsWith(tail.slice(0, k))) return a + tail.slice(k);
    }
  }
  return `${a}\n${b}`;
}

/**
 * The passages with neighbours (same pack, ordinals next to each other)
 * joined. A joined passage takes the place of its best-ranked member; the
 * others keep their order.
 */
export function joinNeighbours(records: readonly ChunkRecord[]): ChunkRecord[] {
  const groups: ChunkRecord[][] = [];
  for (const r of records) {
    const g = groups.find((xs) => xs[0]!.packId === r.packId &&
      xs.some((x) => Math.abs(x.ordinal - r.ordinal) === 1));
    if (g === undefined) groups.push([r]); else g.push(r);
  }
  return groups.map((g) => {
    if (g.length === 1) return g[0]!;
    const ordered = [...g].sort((x, y) => x.ordinal - y.ordinal);
    const text = ordered.slice(1).reduce((t, x) => mergeText(t, x.text), ordered[0]!.text);
    // The best-ranked member lends its section and kind: it is why the group is here.
    return { ...g[0]!, text };
  });
}
