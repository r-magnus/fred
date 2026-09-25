/**
 * Normalization and boilerplate removal (PocketRAG §3.2.1).
 *
 * Headers, footers and page numbers repeat on nearly every page. Left in, they
 * become high-frequency noise that dilutes both the lexical index and the
 * embeddings, and they waste prefill tokens — the one resource the mid-range
 * measurement in docs/results-m0.md says we cannot spare.
 */
import type { PdfPage } from './pdf.ts';

/** A line appearing on at least this fraction of pages is treated as furniture. */
const BOILERPLATE_PAGE_FRACTION = 0.25;
/** Short all-caps strings repeating this often are navigation tabs, not content. */
const TAB_PAGE_FRACTION = 0.15;
const TAB_MAX_CHARS = 30;

function isTabLabel(line: string): boolean {
  if (line.length === 0 || line.length > TAB_MAX_CHARS) return false;
  const letters = line.replace(/[^A-Za-z]/g, '');
  if (letters.length < 2) return false;
  return line.replace(/[^A-Z]/g, '').length / letters.length > 0.9;
}

/**
 * Repeating page furniture: running headers and footers, and the vertical
 * navigation tabs printed down the margin of every page.
 *
 * The tabs matter more than they look. WHO BEC prints ABCDE / TRAUMA / SHOCK /
 * AMS / SKILLS / GLOSSARY down the edge of most pages, and pdfjs returns them
 * inline with the body text. Left in, they land in chunk text ("GLOSSARY Module
 * 1: ... CONDITION Pulselessness Shock Severe bleeding") and, worse, the heading
 * heuristic mistakes them for section titles, so a bleeding procedure gets cited
 * as coming from "GLOSSARY". Citations are user-visible in a first-aid app, so
 * a wrong section name is a real defect.
 *
 * Edge lines are matched exactly; tab labels are matched anywhere on the page,
 * since they are short all-caps strings that no body sentence duplicates dozens
 * of times.
 */
export function findBoilerplate(pages: readonly PdfPage[]): Set<string> {
  const edgeCounts = new Map<string, number>();
  const tabCounts = new Map<string, number>();
  for (const page of pages) {
    const lines = page.text.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of new Set([...lines.slice(0, 2), ...lines.slice(-2)])) {
      edgeCounts.set(line, (edgeCounts.get(line) ?? 0) + 1);
    }
    for (const line of new Set(lines.filter(isTabLabel))) {
      tabCounts.set(line, (tabCounts.get(line) ?? 0) + 1);
    }
  }
  const out = new Set<string>();
  const edgeThreshold = Math.max(3, pages.length * BOILERPLATE_PAGE_FRACTION);
  for (const [line, n] of edgeCounts) if (n >= edgeThreshold) out.add(line);
  const tabThreshold = Math.max(5, pages.length * TAB_PAGE_FRACTION);
  for (const [line, n] of tabCounts) if (n >= tabThreshold) out.add(line);
  return out;
}

const LIGATURES: readonly (readonly [RegExp, string])[] = [
  [/ﬁ/g, 'fi'], [/ﬂ/g, 'fl'], [/ﬀ/g, 'ff'],
  [/ﬃ/g, 'ffi'], [/ﬄ/g, 'ffl'],
  [/[‘’]/g, "'"], [/[“”]/g, '"'],
  [/–/g, '-'], [/—/g, ' - '], [/•/g, '- '],
  [/ /g, ' '],
];

export function normalizeText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of LIGATURES) out = out.replace(pattern, replacement);
  return out
    // Rejoin words split across a line break by hyphenation.
    .replace(/(\w)-\n(\w)/g, '$1$2')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * True for lines that carry no retrievable information: page numbers, rules,
 * and table-of-contents entries.
 *
 * Dot leaders matter more than they appear. A contents page lists every topic
 * word in the manual, so it scores very high on the lexical stage — in testing,
 * "TABLE OF CONTENTS: SKILLS" outranked real wound-packing procedures for the
 * query "how do I control severe external bleeding". A TOC entry can never
 * answer a question, so it should never be retrievable.
 */
function isNoiseLine(line: string): boolean {
  const t = line.trim();
  if (t === '') return true;
  // Any pure-digit line is furniture. Note the length is unbounded: reading a
  // page column-wise collects the footer once per band, so page 100 arrives as
  // "100100100". A digits-only line is never retrievable content.
  if (/^\d+$/.test(t)) return true;
  if (/^page\s+\d+/i.test(t)) return true;
  if (/^[\s.\-_—|]+$/.test(t)) return true;
  // Dot leaders: ". . . ." or "....", as used in contents and index pages.
  if (/(\.\s?){4,}/.test(t)) return true;
  // Mostly punctuation and digits with little prose.
  const letters = t.replace(/[^A-Za-z]/g, '').length;
  return letters / t.length < 0.4 && t.length > 12;
}

/**
 * Per-corpus furniture that the frequency heuristic in findBoilerplate misses.
 *
 * ATP 3-50.21 is why this exists. Its footer carries the page label
 * ("4-10 ATP 3-50.21 September 2018"), so no two footers are identical and exact
 * line counting never reaches threshold. Its running header alternates between
 * "Chapter 4" and the chapter title, and a short title like "Food" is on too few
 * pages to count as boilerplate but would otherwise land at the top of every
 * chunk. Rules are explicit per corpus rather than a looser generic heuristic,
 * because loosening the heuristic would silently change packs already built.
 */
export interface CleanRules {
  /** Dropped wherever they appear. Anchor these: they run against every line. */
  readonly dropLines?: readonly RegExp[];
  /** Dropped only among a page's first and last two lines, i.e. running headers. */
  readonly dropEdgeLines?: readonly RegExp[];
  /** Applied after line filtering, before normalization. */
  readonly rewrites?: readonly (readonly [RegExp, string])[];
}

/**
 * Mnemonic list items print their letter twice: ATP 3-50.21's RICE list reads
 * "- R-Rest injured area.", "- C-Compression-wrap or splint". The letter prefix
 * is layout, and left in it reads as a stutter in citations and in the text the
 * model paraphrases. Only a single capital repeated as the next word's first
 * letter is removed, so ordinary hyphenated words are untouched.
 */
export function stripMnemonicPrefixes(text: string): string {
  return text.replace(/^(\s*[-\u2022]\s*)([A-Z])-(?=\2[a-z])/gm, '$1');
}

export function cleanPage(page: PdfPage, boilerplate: ReadonlySet<string>, rules: CleanRules = {}): string {
  const lines = page.text.split('\n');
  const contentIdx = lines.flatMap((l, i) => (l.trim() === '' ? [] : [i]));
  const edge = new Set([...contentIdx.slice(0, 2), ...contentIdx.slice(-2)]);
  let text = lines
    .filter((line, i) => {
      const t = line.trim();
      if (boilerplate.has(t) || isNoiseLine(line)) return false;
      if (rules.dropLines?.some((re) => re.test(t))) return false;
      if (edge.has(i) && rules.dropEdgeLines?.some((re) => re.test(t))) return false;
      return true;
    })
    .join('\n');
  for (const [pattern, replacement] of rules.rewrites ?? []) text = text.replace(pattern, replacement);
  return normalizeText(stripMnemonicPrefixes(text));
}
