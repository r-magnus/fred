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
