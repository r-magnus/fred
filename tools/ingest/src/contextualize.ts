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
 * A line that tells the reader not to do something.
 *
 * Anchored to line starts. An early version matched anywhere in the chunk, and
 * labelled whole passages of legitimate burn treatment as things to avoid
 * because one line said "Never place a tourniquet around the neck" — the
 * inversion defect in reverse, and worse than not labelling at all, since it
 * would have told the generator not to cool a burn.
 */
const PROHIBITION_LINE = /^\s*[-*\u2022]?\s*(do not\b|don't\b|never\b|avoid\b)/i;
/** A heading that makes everything beneath it a list of things to avoid. */
const PROHIBITION_HEADING = /\b(do not|don't|never|avoid|contraindicat)\b/i;

/** Lines with enough substance to count; blank and stub lines skew the ratio. */
function contentLines(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter((l) => l.length > 3);
}

/**
 * The half that does not depend on a model being right.
 *
 * Three outcomes rather than two, because most real passages are mixed. Saying
 * "this is all prohibitions" about a passage that is mostly instructions is its
 * own safety bug, so a mixed passage gets told to preserve each line's polarity
 * instead.
 */
export function structuralLabel(chunk: DraftChunk): string {
  // The heading is authoritative: this is the orphaned "Do not -" case from
  // results-alpha.md, where chunking split the list from its header and the
  // body alone gives no clue that it is a prohibition list.
  if (PROHIBITION_HEADING.test(chunk.section)) {
    return 'Lists actions to AVOID, not steps to follow.';
  }

  const lines = contentLines(chunk.text);
  const prohibitions = lines.filter((l) => PROHIBITION_LINE.test(l)).length;

  if (prohibitions === 0) {
    return chunk.blockKind === 'procedure' ? 'Ordered steps to follow.' : '';
  }
  // Predominantly prohibitions: safe to characterise the whole passage.
  if (prohibitions * 2 >= lines.length) {
    return 'Lists actions to AVOID, not steps to follow.';
  }
  // Mixed. Naming it is the accurate thing to do, and it is exactly the case a
  // small model gets wrong (arXiv 2605.13829 — negation is dropped, so a
  // "do not" line reads as an instruction).
  return 'Contains BOTH steps to follow and actions to avoid — keep each line\'s wording.';
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
