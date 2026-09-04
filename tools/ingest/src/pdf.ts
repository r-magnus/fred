/**
 * PDF text extraction with layout awareness.
 *
 * pdfjs yields positioned items, not a text stream. Naive extraction of the WHO
 * BEC manual interleaves its multi-column tables into sentences that read as
 * valid English but say something the source never said — for example the
 * strings "TensionHypotension" and "WITHAny pneumothorax" appear when three
 * table columns are concatenated. In a first-aid corpus that is a correctness
 * problem, not a formatting one, so layout is reconstructed from geometry.
 *
 * PocketRAG §3.2.1 covers this in one sentence ("PDF/HTML is normalized to
 * plain text"). In practice it is the hardest part of the pipeline.
 */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface PdfPage {
  readonly pageNumber: number;
  readonly text: string;
  /** Fraction of tokens that look like run-together words; see qualityScore. */
  readonly suspectRatio: number;
  readonly layout: 'single' | 'columns' | 'table';
}

interface Item {
  readonly str: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
}

const BIN = 2; // points per occupancy bin
const MIN_GUTTER_PT = 14; // narrower gaps are word spacing, not structure
/** A gutter may be bridged by this fraction of lines (spanning headers). */
const GUTTER_LINE_FRACTION = 0.12;

/**
 * X-ranges that are empty on nearly every text line — the page's column gutters.
 *
 * Requiring a gutter to be empty on ALL lines fails on real documents: a single
 * spanning header ("CONDITION | SIGNS AND SYMPTOMS | IN-DEPTH DESCRIPTION")
 * bridges every gutter and hides the column structure for the whole page. So a
 * gutter is defined by the majority of lines, not by unanimity.
 */
function findGutters(items: readonly Item[], width: number): [number, number][] {
  const lineKeys = new Map<number, Item[]>();
  for (const it of items) {
    const key = Math.round(it.y / 3) * 3;
    const bucket = lineKeys.get(key);
    if (bucket) bucket.push(it);
    else lineKeys.set(key, [it]);
  }
  const lines = [...lineKeys.values()];
  if (lines.length < 4) return [];

  const nBins = Math.ceil(width / BIN) + 1;
  const hits = new Uint16Array(nBins);
  for (const line of lines) {
    const seen = new Uint8Array(nBins);
    for (const it of line) {
      const start = Math.max(0, Math.floor(it.x / BIN));
      const end = Math.min(nBins - 1, Math.ceil((it.x + it.w) / BIN));
      for (let b = start; b <= end; b++) seen[b] = 1;
    }
    for (let b = 0; b < nBins; b++) if (seen[b]) hits[b] = (hits[b] ?? 0) + 1;
  }

  const maxOccupancy = lines.length * GUTTER_LINE_FRACTION;
  const gutters: [number, number][] = [];
  let run = -1;
  for (let b = 0; b < nBins; b++) {
    if ((hits[b] ?? 0) <= maxOccupancy) {
      if (run < 0) run = b;
    } else if (run >= 0) {
      const from = run * BIN;
      const to = b * BIN;
      if (to - from >= MIN_GUTTER_PT) gutters.push([from, to]);
      run = -1;
    }
  }
  if (run >= 0 && width - run * BIN >= MIN_GUTTER_PT) gutters.push([run * BIN, width]);
  // Drop the leading and trailing margins; only interior gaps split columns.
  return gutters.filter(([from, to]) => from > width * 0.04 && to < width * 0.96);
}

function linesFrom(items: readonly Item[]): string[] {
  const lines = new Map<number, Item[]>();
  for (const it of items) {
    const key = Math.round(it.y / 3) * 3; // tolerance for baseline jitter
    const bucket = lines.get(key);
    if (bucket) bucket.push(it);
    else lines.set(key, [it]);
  }
  return [...lines.entries()]
    .sort((a, b) => b[0] - a[0]) // PDF y grows upward
    .map(([, group]) =>
      group
        .sort((a, b) => a.x - b.x)
        // Insert a space when items are visually separated, so adjacent table
        // cells never fuse into a single word.
        .reduce((acc, it, i, arr) => {
          const prev = arr[i - 1];
          const gap = prev ? it.x - (prev.x + prev.w) : 0;
          const sep = prev && gap > 1.5 ? ' ' : '';
          return acc + sep + it.str;
        }, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((l) => l !== '');
}

/** Run-together words like "TensionHypotension" signal a bad column merge. */
export function qualityScore(text: string): number {
  const tokens = text.split(/\s+/).filter((t) => t.length > 3);
  if (tokens.length === 0) return 0;
  const suspect = tokens.filter((t) => /[a-z]{2}[A-Z][a-z]{2}/.test(t)).length;
  return suspect / tokens.length;
}

function itemsToText(items: readonly Item[], width: number): { text: string; layout: PdfPage['layout'] } {
  if (items.length === 0) return { text: '', layout: 'single' };

  const gutters = findGutters(items, width);
  if (gutters.length === 0) return { text: linesFrom(items).join('\n'), layout: 'single' };

  const bounds: number[] = [0, ...gutters.map(([, to]) => to), width];
  const bands: [number, number][] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    bands.push([bounds[i] ?? 0, bounds[i + 1] ?? width]);
  }

  // The decision that matters is not "table vs. columns" but whether a cell
  // holds WRAPPED PROSE. A band wide enough for a paragraph wraps over many
  // lines, so a visual "row" spans unrelated sentences and reading across it
  // fuses them. Wide bands must therefore be read top-to-bottom, band by band.
  // Narrow bands hold short values that belong together on a row, so those are
  // read across. The WHO BEC condition tables are three WIDE bands: reading
  // across produced "Tension Hypotension WITH Any pneumothorax can become...",
  // three cells welded into a sentence no source document contains.
  const PROSE_BAND_FRACTION = 0.15;
  const proseBands = bands.filter(([a, b]) => b - a > width * PROSE_BAND_FRACTION);

  if (proseBands.length >= 2) {
    const text = proseBands
      .map(([a, b]) => linesFrom(items.filter((i) => i.x >= a && i.x < b)).join('\n'))
      .filter((t) => t.trim() !== '')
      .join('\n\n');
    return { text, layout: 'columns' };
  }

  return { text: linesFrom(items).join('\n'), layout: 'table' };
}

export async function extractPdf(path: string): Promise<PdfPage[]> {
  const doc = await getDocument({ url: path, useSystemFonts: true }).promise;
  const pages: PdfPage[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    const items: Item[] = [];
    for (const raw of content.items) {
      const it = raw as { str?: string; transform?: number[]; width?: number };
      if (typeof it.str !== 'string' || it.str.trim() === '') continue;
      const t = it.transform ?? [1, 0, 0, 1, 0, 0];
      items.push({ str: it.str, x: t[4] ?? 0, y: t[5] ?? 0, w: it.width ?? 0 });
    }
    const { text, layout } = itemsToText(items, viewport.width);
    pages.push({ pageNumber: n, text, suspectRatio: qualityScore(text), layout });
    page.cleanup();
  }
  await doc.destroy();
  return pages;
}
