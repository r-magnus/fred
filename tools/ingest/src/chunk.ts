/**
 * Chunking (PocketRAG §3.2.1): 300-token windows with 50-token overlap,
 * carrying section, page and domain metadata.
 *
 * Windows are measured in the EMBEDDING model's tokens, not characters or
 * words. gte-small has a 512-token limit, so a chunk sized by any other unit
 * risks silent truncation — the tail of a chunk would be indexed as if it had
 * been embedded when it never was.
 */
import type { BlockKind, DomainTag } from '@fred/pack-format';
import { looksLikeProcedure } from '@fred/rag-core';

export interface SourcePage {
  readonly pageNumber: number;
  readonly text: string;
}

export interface DraftChunk {
  readonly text: string;
  /** Contextual-retrieval preamble, added after chunking. See contextualize.ts. */
  readonly context?: string;
  readonly section: string;
  /** Null for sources with no pages, such as FEIS web reviews. */
  readonly page: number | null;
  readonly domain: DomainTag;
  readonly blockKind: BlockKind;
}

export interface ChunkOptions {
  readonly targetTokens: number;
  readonly overlapTokens: number;
  readonly domain: DomainTag;
  readonly tokenize: (text: string) => number;
}

export const DEFAULT_CHUNKING = { targetTokens: 300, overlapTokens: 50 } as const;

/**
 * Heading heuristic for the WHO manuals: short lines that are either a numbered
 * module or predominantly uppercase. Headings are kept in the chunk text as
 * well as the metadata, because retrieval benefits from the vocabulary.
 */
export function isHeading(line: string): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > 80) return false;
  // Admonition labels are uppercase but are not sections. Treated as headings,
  // 16 survival chunks were cited as coming from section "CAUTION".
  if (/^(?:warning|caution|note|important)[.!:]?$/i.test(t)) return false;
  if (/^(module|chapter|section|annex|appendix)\s+\d+/i.test(t)) return true;
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return false;
  const upper = t.replace(/[^A-Z]/g, '').length;
  return upper / letters.length > 0.7;
}

/** A bullet or dash list item. These manuals emit bullets as \x83, z or dashes. */
export function isListItem(line: string): boolean {
  return /^[\u0083\u2021\u2020\u25aa\u2022\u2013zZ\-]\s+\S/.test(line.trim());
}

/**
 * A line that introduces a list. ATP manuals use both "...:" and "... -".
 *
 * Polarity lives here and nowhere else: "Do not -" governs every item beneath
 * it, and the items themselves are written as bare imperatives.
 */
export function isListHeader(line: string): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > 200) return false;
  if (isListItem(t)) return false;
  return /[:\u2014-]$/.test(t);
}

export function chunkPages(pages: readonly SourcePage[], opts: ChunkOptions): DraftChunk[] {
  const { targetTokens, overlapTokens, domain, tokenize } = opts;
  const out: DraftChunk[] = [];

  let section = '(front matter)';
  let buffer: { line: string; page: number }[] = [];
  let bufferTokens = 0;

  const flush = (): void => {
    if (buffer.length === 0) return;
    const text = buffer.map((b) => b.line).join('\n').trim();
    if (text.length > 0) {
      out.push({
        text,
        section,
        page: buffer[0]?.page ?? 0,
        domain,
        blockKind: looksLikeProcedure(text) ? 'procedure' : 'prose',
      });
    }
    // Carry the tail forward so a sentence split across a window boundary is
    // still retrievable from at least one chunk (§3.2.1's 50-token overlap).
    const carry: { line: string; page: number }[] = [];
    let carried = 0;
    for (let i = buffer.length - 1; i >= 0 && carried < overlapTokens; i--) {
      const entry = buffer[i];
      if (!entry) continue;
      carry.unshift(entry);
      carried += tokenize(entry.line);
    }
    // A window that opens inside a list loses the line that governs it, and for a
    // negated list that inverts every item. ATP 3-50.21 p.48 is the case that
    // found this: "Do not -" stayed in the previous chunk, leaving "Make any
    // deep cuts at the bite site", "Put the hands on the face or rub the eyes"
    // and "Break open the large blisters" standing alone as instructions. The
    // overlap cannot catch it, because it carries the tail and a header sits
    // above the items.
    //
    // Carried for every list, not only negated ones: "Examine the eyes for the
    // following:" is equally the thing that makes its items mean anything.
    // Items wrap onto unmarked continuation lines ("...administer atropine," /
    // "morphine or other central nervous system depressors."), and a window can
    // open on one of those rather than on a bullet. So look for a list item
    // anywhere in the carry ahead of any header it already has, and walk back a
    // bounded distance for the governing line rather than stopping at the first
    // unmarked line.
    const headerInCarry = carry.findIndex((c) => isListHeader(c.line));
    const itemInCarry = carry.findIndex((c) => isListItem(c.line));
    const opensInsideList = itemInCarry !== -1
      && (headerInCarry === -1 || headerInCarry > itemInCarry);

    if (opensInsideList) {
      const start = buffer.indexOf(carry[0] as { line: string; page: number });
      const LOOKBACK = 15;
      for (let i = start - 1; i >= 0 && i >= start - LOOKBACK; i--) {
        const entry = buffer[i];
        if (!entry) continue;
        // A section heading means the list began after it; give up rather than
        // reach across a section boundary for an unrelated header.
        if (isHeading(entry.line)) break;
        if (isListHeader(entry.line)) {
          carry.unshift(entry);
          carried += tokenize(entry.line);
          break;
        }
      }
    }

    buffer = carry;
    bufferTokens = carried;
  };

  for (const page of pages) {
    for (const line of page.text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === '') continue;
      if (isHeading(trimmed)) {
        flush();
        section = trimmed;
      }
      const n = tokenize(trimmed);
      // A single line longer than the window is emitted alone rather than
      // silently dropped or truncated.
      if (bufferTokens + n > targetTokens && buffer.length > 0) flush();
      buffer.push({ line: trimmed, page: page.pageNumber });
      bufferTokens += n;
    }
  }
  flush();
  buffer = [];
  return out;
}

/** "13-29. Locate the site" — the Army manuals number every paragraph. */
const PARAGRAPH_NUMBER = /^\d{1,2}-\d{1,3}\.\s/;
/** Figure and table captions: layout, not content, and they read as fragments. */
const CAPTION = /^(?:figure|table)\s+[a-z]?\d+(?:-\d+)?\.?\s/i;
/** A paragraph's last line usually stops short of the right margin. */
const SHORT_LINE = 70;

interface Unit {
  readonly lines: string[];
  readonly page: number;
  readonly section: string;
}

/**
 * Chunk at the document's own boundaries instead of every N tokens.
 *
 * The window chunker cut every 300 tokens wherever that fell, so 56% of ATP
 * 4-02.11 chunks and 68% of ATP 3-50.21 chunks began mid-sentence
 * (docs/results-strategy-research.md §1d). A passage that opens "the casualty
 * for the location, type, and size of the wound" is harder to retrieve, harder
 * for a small model to read, and was the raw material compression then cut
 * further.
 *
 * Units are paragraphs: they start at a heading, at a numbered paragraph, or
 * after a short line ending a sentence. A list stays in the unit of the line that
 * introduces it, so "Do not -" is never separated from its items — the defect
 * the window chunker needed a lookback to patch. Units are packed whole into
 * chunks of up to `targetTokens`, and a chunk never spans a section heading. A
 * single unit longer than the window is split at sentence ends, and each piece
 * after the first repeats the unit's list header if it has one.
 *
 * No overlap: with cuts at paragraph ends there is no sentence straddling a
 * boundary for overlap to rescue.
 */
export function chunkByStructure(pages: readonly SourcePage[], opts: ChunkOptions): DraftChunk[] {
  const { targetTokens, domain, tokenize } = opts;
  const units: Unit[] = [];
  let section = '(front matter)';
  let current: Unit | null = null;
  let prev = '';

  const close = (): void => {
    if (current !== null && current.lines.length > 0) units.push(current);
    current = null;
  };

  for (const page of pages) {
    for (const raw of page.text.split('\n')) {
      const line = raw.trim();
      if (line === '' || CAPTION.test(line)) continue;
      const heading = isHeading(line);
      const paragraphEnded = /[.!?]["')\]]?$/.test(prev) && prev.length < SHORT_LINE && !isListItem(line);
      if (heading) {
        close();
        section = line;
      } else if (current === null || PARAGRAPH_NUMBER.test(line) || (paragraphEnded && !isListItem(prev))) {
        close();
      }
      if (current === null) current = { lines: [], page: page.pageNumber, section };
      current.lines.push(line);
      prev = line;
    }
  }
  close();

  const out: DraftChunk[] = [];
  let buf: string[] = [];
  let bufTokens = 0;
  let bufPage = 0;
  let bufSection = '';
  const flush = (): void => {
    const text = buf.join('\n').trim();
    if (text !== '') {
      out.push({ text, section: bufSection, page: bufPage, domain, blockKind: looksLikeProcedure(text) ? 'procedure' : 'prose' });
    }
    buf = [];
    bufTokens = 0;
  };

  for (const unit of units) {
    const pieces = splitOversized(unit.lines, targetTokens, tokenize);
    for (const piece of pieces) {
      const n = tokenize(piece.join('\n'));
      if (buf.length > 0 && (bufTokens + n > targetTokens || unit.section !== bufSection)) flush();
      if (buf.length === 0) {
        bufPage = unit.page;
        bufSection = unit.section;
      }
      buf.push(...piece);
      bufTokens += n;
    }
  }
  flush();
  return out;
}

/**
 * Split a unit that is too long for one chunk at sentence-ending lines. Pieces
 * after the first repeat the list header, so a long negated list keeps its
 * polarity in every chunk it lands in.
 */
function splitOversized(lines: readonly string[], target: number, tokenize: (t: string) => number): string[][] {
  if (tokenize(lines.join('\n')) <= target) return [[...lines]];
  const header = lines.find((l) => isListHeader(l));
  const pieces: string[][] = [];
  let cur: string[] = [];
  let curTokens = 0;
  for (const line of lines) {
    const n = tokenize(line);
    const last = cur[cur.length - 1] ?? '';
    const atBoundary = cur.length > 0 && (isListItem(line) || /[.!?:]["')\]]?$/.test(last));
    if (curTokens + n > target && atBoundary) {
      pieces.push(cur);
      // Continuing a list: repeat what governs it.
      cur = header !== undefined && isListItem(line) ? [header] : [];
      curTokens = cur.reduce((a, l) => a + tokenize(l), 0);
    }
    cur.push(line);
    curTokens += n;
  }
  if (cur.length > 0) pieces.push(cur);
  return pieces;
}
