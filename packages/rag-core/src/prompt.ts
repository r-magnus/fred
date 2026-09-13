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
export const SYSTEM_PREFIX = `You are a field first-aid and wilderness survival assistant. Answer using only the SOURCES below.

- If the sources do not contain the answer, say "I don't have reliable information on that."
- Keep procedure steps in their original order. Never omit or reorder a step.
- Reply with short numbered steps. No preamble, no commentary about your answer.
- If life is at risk, say to contact emergency services first when possible.`;

/** Rendered when the user is offline and the answer is medical. */
export const MEDICAL_DISCLAIMER =
  'This is general guidance from offline reference material, not professional medical advice. If you can reach emergency services, do that first.';

export function renderContext(blocks: readonly ContextBlock[]): string {
  return blocks
    .map((b, i) => {
      const page = b.chunk.page === null ? '' : `, p. ${b.chunk.page}`;
      return `SOURCE ${i + 1} (${b.chunk.source}${page})\n${b.text}`;
    })
    .join('\n\n');
}

/** The per-query portion, appended after the cached prefix. */
export function buildQuerySuffix(query: string, blocks: readonly ContextBlock[]): string {
  return `\n\nSOURCES:\n${renderContext(blocks)}\n\nQUESTION: ${query}\n\nANSWER:`;
}

/**
 * The prompt split into its stable and per-query halves.
 *
 * Kept separate because backends need to render it differently. A chat model
 * needs these as distinct system and user turns so its template applies and it
 * emits a proper end-of-turn token; concatenating them into one raw string
 * leaves the model with no stopping signal, and it will generate until it hits
 * the context limit. Keeping the system half intact is also what makes prefix
 * KV caching possible.
 */
export interface PromptParts {
  readonly system: string;
  readonly user: string;
}

export function buildPromptParts(query: string, blocks: readonly ContextBlock[]): PromptParts {
  return { system: SYSTEM_PREFIX, user: buildQuerySuffix(query, blocks).trimStart() };
}

/** Flattened form, for backends with no chat template. */
export function buildPrompt(query: string, blocks: readonly ContextBlock[]): string {
  const { system, user } = buildPromptParts(query, blocks);
  return `${system}\n\n${user}`;
}
