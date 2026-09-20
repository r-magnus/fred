/**
 * Contextual retrieval: give every chunk a sentence saying what it is.
 *
 * The preamble is prepended before embedding and indexed alongside the text, so
 * a passage carries its own provenance into the vector space and into FTS5.
 * Anthropic report 35% fewer top-20 retrieval failures from this alone and 67%
 * with contextual BM25; docs/results-improvement-research.md has the sourcing.
 *
 * Two reasons it is worth more to Fred than the headline number suggests.
 *
 * First, it is the only quality technique on the list that costs the phone
 * nothing. Preambles are written here, once, on a desktop. Everything else —
 * rerankers, NLI verifiers, query expansion — is paid per question on a CPU
 * that already takes 14 s to answer.
 *
 * Second, it is a structural fix for the defect class that keeps hurting. ATP
 * 3-50.21's "Do not -" snakebite list was chunked away from its header and read
 * as instructions (docs/results-alpha.md); the held-out set then caught Fred
 * answering "Yes, but only if it is a deep wound" to packing an abdomen, where
 * the source says explicitly not to (docs/results-holdout.md). Negation Neglect
 * (arXiv 2605.13829) says a 1.7B model will keep doing this and that prompting
 * will not stop it. A chunk whose first line reads "Lists actions to AVOID"
 * cannot be read as an instruction to perform them.
 *
 * So the label is two parts: a deterministic structural half that never depends
 * on a small model getting it right, and a generated half for vocabulary.
 */
import { getLlama, LlamaChatSession, type LlamaContext, type LlamaModel } from 'node-llama-cpp';
import type { DraftChunk } from './chunk.ts';

/**
 * Prohibition markers, checked against the chunk's own text.
 *
 * Deliberately not a model call. The whole point is that this half holds even
 * when the generator is wrong, and a regex over "Do not" is not the part of
 * this pipeline that needs intelligence.
 */
const PROHIBITION = /(^|\n)\s*(do not\b|don't\b|never\b|avoid\b|do NOT\b)/i;
/** A heading that turns everything under it into a list of things to avoid. */
const PROHIBITION_HEADING = /\b(do not|don't|never|avoid|contraindicat|precaution|warning|caution)\b/i;

/** The half that does not depend on a model being right. */
export function structuralLabel(chunk: DraftChunk): string {
  const heading = PROHIBITION_HEADING.test(chunk.section);
  const body = PROHIBITION.test(chunk.text);
  if (heading || body) return 'Lists actions to AVOID, not steps to follow.';
  if (chunk.blockKind === 'procedure') return 'Ordered steps to follow.';
  return '';
}

/** Model-written half: one sentence on what the passage covers. */
const SYSTEM =
  'You label passages for a search index. Given a passage, reply with ONE short ' +
  'sentence naming what it covers and the terms someone would search for to find ' +
  'it. Do not give advice, do not summarise the instructions, do not add ' +
  'anything else.';

function userPrompt(chunk: DraftChunk, documentTitle: string): string {
  return [
    `Document: ${documentTitle}`,
    `Section: ${chunk.section}`,
    '',
    chunk.text.slice(0, 1200),
    '',
    'One sentence naming what this passage covers:',
  ].join('\n');
}

/** Collapse to a single clean sentence; the model sometimes editorialises. */
function tidy(raw: string): string {
  const first = raw.trim().split('\n').find((l) => l.trim() !== '') ?? '';
  const stripped = first.replace(/^["'\s-]*(this passage|the passage|it)\s+/i, '')
    .replace(/^["'\s-]+/, '')
    .trim();
  if (stripped === '') return '';
  const capped = stripped.charAt(0).toUpperCase() + stripped.slice(1);
  return capped.length > 220 ? `${capped.slice(0, 217)}...` : capped;
}

export interface ContextualizeOptions {
  readonly modelPath: string;
  /** Shown to the model and prepended to every label, e.g. "ATP 3-50.21 Survival". */
  readonly documentTitle: string;
  readonly onProgress?: (done: number, total: number) => void;
}

/**
 * One preamble per chunk, in order.
 *
 * Sequential rather than batched: this runs once per corpus on a desktop, and
 * 1,640 core chunks finish in well under an hour. Parallelism here would buy
 * minutes and cost a reproducibility argument.
 */
export async function contextualize(
  chunks: readonly DraftChunk[],
  opts: ContextualizeOptions,
): Promise<string[]> {
  const llama = await getLlama();
  const model: LlamaModel = await llama.loadModel({ modelPath: opts.modelPath });
  const ctx: LlamaContext = await model.createContext({ contextSize: 4096 });
  const out: string[] = [];

  try {
    for (const [i, chunk] of chunks.entries()) {
      const sequence = ctx.getSequence();
      let summary = '';
      try {
        const session = new LlamaChatSession({ contextSequence: sequence, systemPrompt: SYSTEM });
        // Greedy and thought-free, matching every other generation path in the
        // project, so a re-run of ingest reproduces the same packs.
        summary = tidy(await session.prompt(userPrompt(chunk, opts.documentTitle), {
          maxTokens: 80,
          temperature: 0,
          repeatPenalty: { penalty: 1.1 },
          budgets: { thoughtTokens: 0 },
        }));
      } catch {
        // A single failed label is not worth losing an hour of ingest over. The
        // structural half still lands, which is the safety-critical half.
        summary = '';
      } finally {
        sequence.dispose();
      }

      out.push(buildContext(chunk, opts.documentTitle, summary));
      opts.onProgress?.(i + 1, chunks.length);
    }
  } finally {
    await ctx.dispose();
    await model.dispose();
  }
  return out;
}

/** Assemble the stored preamble. Exported so tests can check it without a model. */
export function buildContext(chunk: DraftChunk, documentTitle: string, summary: string): string {
  const where = chunk.section === '' ? documentTitle : `${documentTitle}, ${chunk.section}`;
  return [where + '.', structuralLabel(chunk), summary].filter((s) => s !== '').join(' ');
}
