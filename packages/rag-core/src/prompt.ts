/**
 * Prompt construction.
 *
 * Split into a STABLE prefix and a per-query suffix. The prefix never varies, so
 * the backend can keep its KV cache warm across queries and prefill only the
 * retrieved context — the largest TTFT win available beyond the paper's stack
 * (see docs/optimizations.md).
 */
import type { ChunkRecord } from '@fred/pack-format';

export interface ContextBlock {
  readonly chunk: ChunkRecord;
  readonly text: string;
}

/**
 * Invariant system prefix. Changing this string invalidates every cached prefix,
 * so treat edits as a deliberate act, not a tweak.
 */
export const SYSTEM_PREFIX = `You are Fred, an offline field assistant for first aid, wilderness survival, and local plants and wildlife.

Rules:
- Answer ONLY from the numbered sources provided. Never use outside knowledge.
- If the sources do not answer the question, say so plainly. Do not guess.
- Cite the sources you used as [1], [2], and so on.
- Reproduce procedures in their exact original order. Never omit, reorder, or merge steps.
- Be direct and specific. Short numbered steps beat paragraphs.
- For any life-threatening situation, say to contact emergency services first if that is at all possible.`;

/** Rendered when the user is offline and the answer is medical. */
export const MEDICAL_DISCLAIMER =
  'This is general guidance from offline reference material, not professional medical advice. If you can reach emergency services, do that first.';

export function renderContext(blocks: readonly ContextBlock[]): string {
  return blocks
    .map((b, i) => {
      const page = b.chunk.page === null ? '' : `, p. ${b.chunk.page}`;
      return `[${i + 1}] ${b.chunk.source}${page} — ${b.chunk.section}\n${b.text}`;
    })
    .join('\n\n');
}

/** The per-query portion, appended after the cached prefix. */
export function buildQuerySuffix(query: string, blocks: readonly ContextBlock[]): string {
  return `\n\nSOURCES:\n${renderContext(blocks)}\n\nQUESTION: ${query}\n\nANSWER:`;
}

export function buildPrompt(query: string, blocks: readonly ContextBlock[]): string {
  return SYSTEM_PREFIX + buildQuerySuffix(query, blocks);
}
