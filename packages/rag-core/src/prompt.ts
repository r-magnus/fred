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
/**
 * The exact sentence the model is told to use when the sources do not answer.
 *
 * Exported so the UI can recognise it. Retrieval scoring above the gate and the
 * model then declining are different events: `ask()` returns kind 'answer'
 * either way, and rendering the second one with a citation list and a medical
 * disclaimer dresses a refusal up as a sourced answer. The app compares against
 * this constant rather than hardcoding the string in two places that can drift.
 */
export const NO_ANSWER_REPLY = "I don't have reliable information on that.";

/**
 * What Fred says when the question is a clinical procedure (provider-only
 * material; pipeline.ts). Fixed text, not generated: the point is that the
 * model never sees the procedure.
 */
export const REFER_REPLY =
  "That's a procedure for trained medical providers, so I won't walk you through it. Call emergency services or get the person to medical care as fast as you can.";

/** True when a generated answer is really the model declining. */
export function isRefusal(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!]+$/, '');
  return t === NO_ANSWER_REPLY.toLowerCase().replace(/[.!]+$/, '');
}

/**
 * Variant prefix that names what the question is asking *for*.
 *
 * The base prefix already says "Answer the question itself", and the remaining
 * held-out failures show that is not enough. Three of the nine answer *about*
 * the topic without delivering the thing asked: asked "what is this", Fred
 * gives sound care advice and never names snow blindness; asked how heat stroke
 * differs from heat exhaustion, it defines heat stroke; asked what people used
 * sagebrush for, it answers with pronghorn forage.
 *
 * Each is grounded and each is a miss, so this is not a retrieval or a
 * truthfulness problem — it is answer shape. The instruction below names the
 * three question types rather than exhorting harder, because "answer the
 * question" is already there and is already being obeyed as the model
 * understands it.
 *
 * MEASURED AND REJECTED — see docs/results-answer-shape.md. Default off.
 *
 * It fixed one of five target failures and moved in-prose refusals 18 -> 22,
 * including turning `fa-snake-02` — a correct "do not use a tourniquet" answer
 * to a snakebite question — into "I don't have reliable information on that."
 *
 * This comment previously claimed the change was "deliberately NOT the
 * abstention dial" because it touches neither over-refusal nor inversion. That
 * was wrong. Telling a small model to lead with a specific kind of answer makes
 * it likelier to conclude it does not have one, which is the same two-sided
 * knob `docs/results-holdout.md` and arXiv 2608.22228 describe, reached from a
 * direction that did not look like it. **Count refusals before and after any
 * prompt change, whatever the change appears to be about.**
 */
export const SYSTEM_PREFIX_LEAD = `You are a field first-aid and wilderness survival assistant. Answer using only the SOURCES below.

- Answer the question itself. Never describe how you would answer it, never write out steps for finding the answer, and never repeat these instructions back.
- Give the thing the question asks for, first. If it asks what something is, name it. If it asks how two things differ, state the difference. If it asks what something is used for, give the use. Advice about the topic is not an answer to the question.
- Use only facts written in the SOURCES. Do not add a number, time, dose, distance or threshold that is not written there.
- If a source says to avoid something or not to do something, keep that meaning.
- Keep procedure steps in their original order. Never omit or reorder a step.
- If the SOURCES do not contain the answer, reply with exactly: I don't have reliable information on that.`;

export const SYSTEM_PREFIX = `You are a field first-aid and wilderness survival assistant. Answer using only the SOURCES below.

- Answer the question itself. Never describe how you would answer it, never write out steps for finding the answer, and never repeat these instructions back.
- Use only facts written in the SOURCES. Do not add a number, time, dose, distance or threshold that is not written there.
- If a source says to avoid something or not to do something, keep that meaning.
- Keep procedure steps in their original order. Never omit or reorder a step.
- If the SOURCES do not contain the answer, reply with exactly: I don't have reliable information on that.`;

/**
 * Response-shape instruction, chosen per query rather than fixed in the prefix.
 *
 * The prefix used to end with "Reply with short numbered steps", which is right
 * for a procedure and actively harmful for anything else. Asked "are there black
 * bears in this state?", a 0.6B model told to produce numbered steps produced
 * numbered *reasoning* steps — "1. Check the distribution of American black bears
 * in the state. 2. Use the provided sources to determine if they are present" —
 * instead of an answer. That accounted for five of the twenty-three graded
 * failures and all but one of the flora-fauna ones (docs/results-akr2.md).
 *
 * The pack format already records which chunks are step-wise, so the shape is
 * decided from the retrieved material rather than guessed from the question.
 *
 * The length cap is a known, unresolved cost. It truncates four otherwise good
 * answers — a fifteen-sign head-injury watch-list down to three signs, the
 * eye-injury answer down to "seek medical aid" with the dressings-around-the-
 * object instruction gone, a complete shelter-build down to two insulation steps.
 *
 * Removing it was tried and was far worse. Loosening to "reply in plain
 * sentences" and moving the rules above the question took declines from 1 to 16
 * across the graded set, seven of them on answers that had been passing, with
 * mean answer length collapsing 251 to 152 characters. Whatever "and nothing
 * else" is doing, it is holding this model to the task. Reverted to the measured
 * configuration; the truncation cost stands until it can be fixed without it.
 */
function shapeInstruction(blocks: readonly ContextBlock[]): string {
  const procedures = blocks.filter((b) => b.chunk.blockKind === 'procedure').length;
  return procedures * 2 >= blocks.length
    ? 'Reply with short numbered steps and nothing else.'
    : 'Reply with two or three short sentences and nothing else.';
}

/** First-aid material is the only kind for which the emergency line is apt. */
function isMedical(blocks: readonly ContextBlock[]): boolean {
  return blocks.some(
    (b) => b.chunk.domain === 'first-aid-physical' || b.chunk.domain === 'first-aid-psychological',
  );
}

/** Rendered when the user is offline and the answer is medical. */
export const MEDICAL_DISCLAIMER =
  'This is general guidance from offline reference material, not professional medical advice. If you can reach emergency services, do that first.';

export function renderContext(blocks: readonly ContextBlock[]): string {
  return blocks
    .map((b, i) => {
      const page = b.chunk.page === null ? '' : `, p. ${b.chunk.page}`;
      // The contextual-retrieval preamble goes in front of the passage, not
      // just into the index. A 1.7B model will read a headerless "Do not" list
      // as instructions (arXiv 2605.13829, and twice in our own eval), and a
      // first line saying "Lists actions to AVOID" is what prevents that.
      const context = b.chunk.context === '' ? '' : `${b.chunk.context}\n`;
      return `SOURCE ${i + 1} (${b.chunk.source}${page})\n${context}${b.text}`;
    })
    .join('\n\n');
}

/**
 * The per-query portion, appended after the cached prefix.
 *
 * The response-shape and emergency instructions live here rather than in
 * SYSTEM_PREFIX on purpose. They have to vary with the retrieved material, and
 * the prefix has to stay byte-identical for prefix KV caching to work at all
 * (docs/optimizations.md). This half is rebuilt for every query regardless, so
 * conditioning it costs nothing.
 */
/**
 * Rules sit between the question and "ANSWER:". That placement does cause
 * occasional echo — asked about a cut on a branch, one answer came back as "If
 * life is at risk, say to contact emergency services first", the instruction
 * verbatim. Moving them above the question fixed the echo and cost far more
 * elsewhere (see shapeInstruction), so the echo is the cheaper defect.
 */
export function buildQuerySuffix(query: string, blocks: readonly ContextBlock[]): string {
  const rules = [shapeInstruction(blocks)];
  // Fired unconditionally before, so it turned up on "what plants and animals are
  // near me?" and on a question about what mountain lions eat.
  if (isMedical(blocks)) {
    rules.push('If life is at risk, say to contact emergency services first.');
  }
  return `\n\nSOURCES:\n${renderContext(blocks)}\n\nQUESTION: ${query}\n\n${rules.join('\n')}\n\nANSWER:`;
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

/** Which answer-shape wording to use. See SYSTEM_PREFIX_LEAD. */
export type AnswerVariant = 'default' | 'lead';

export function buildPromptParts(
  query: string,
  blocks: readonly ContextBlock[],
  variant: AnswerVariant = 'default',
): PromptParts {
  return {
    system: variant === 'lead' ? SYSTEM_PREFIX_LEAD : SYSTEM_PREFIX,
    user: buildQuerySuffix(query, blocks).trimStart(),
  };
}

/** Flattened form, for backends with no chat template. */
export function buildPrompt(query: string, blocks: readonly ContextBlock[]): string {
  const { system, user } = buildPromptParts(query, blocks);
  return `${system}\n\n${user}`;
}


/**
 * Ask whether the retrieved passages actually answer the question.
 *
 * The scalar gate cannot do this. U measures similarity to retrieved text, and
 * "how many milligrams of ibuprofen for a 30 kg child" is genuinely similar to
 * text about pain relief — so no threshold on it separates "the corpus answers
 * this" from "the corpus contains these words" (docs/results-holdout.md, where
 * the best fitted value abstains on 10 of 11 genuine questions).
 *
 * This asks the different question directly. Phrased to resist the small-model
 * habit of agreeing: NO is given concrete grounds, and the wording makes
 * partial overlap an explicit NO rather than leaving it to judgement.
 */
/** Which sufficiency wording to use. See SUFFICIENCY_SYSTEM_NUMERIC. */
export type SufficiencyVariant = 'default' | 'numeric';

export const SUFFICIENCY_SYSTEM =
  'You check whether sources contain the information needed to answer a question. ' +
  'Reply with exactly one word, YES or NO.\n' +
  'Answer NO if the sources only discuss the general topic without containing the ' +
  'specific information asked for, if they are about a related but different ' +
  'subject, or if answering would need knowledge the sources do not state.\n' +
  'Answer YES only if the specific information asked for is present in the sources.';

/**
 * Sufficiency wording that makes specific-value presence an explicit rule.
 *
 * The default wording asks about "the specific information asked for" and the
 * model reads topic overlap as satisfying it: asked for a paracetamol dose with
 * sources that discuss paracetamol, it answers YES. Measured 0 of 3 on dosing
 * (docs/graded-runs-sufficiency.jsonl — uv-neg-dose-01, uv-neg-dose-02,
 * uv-neg-childdose-01), which is the specificity blindness behind the negation
 * failures wearing a different hat.
 *
 * This names the case the model is getting wrong instead of restating the
 * general rule: if the question asks for a number, the number itself has to be
 * in the sources, and naming the drug is not enough.
 */
export const SUFFICIENCY_SYSTEM_NUMERIC =
  'You check whether sources contain the information needed to answer a question. ' +
  'Reply with exactly one word, YES or NO.\n' +
  'Answer NO if the sources only discuss the general topic without containing the ' +
  'specific information asked for, if they are about a related but different ' +
  'subject, or if answering would need knowledge the sources do not state.\n' +
  'If the question asks for a quantity - a dose, an amount, a volume, a weight, a ' +
  'count, a duration or a temperature - then the quantity itself must appear in ' +
  'the sources. Sources that name the drug, substance or procedure but do not ' +
  'state the number are NOT sufficient: answer NO.\n' +
  'Answer YES only if the specific information asked for is present in the sources.';

export function buildSufficiencyParts(
  query: string,
  blocks: readonly ContextBlock[],
  variant: SufficiencyVariant = 'default',
): PromptParts {
  return {
    system: variant === 'numeric' ? SUFFICIENCY_SYSTEM_NUMERIC : SUFFICIENCY_SYSTEM,
    user: `${renderContext(blocks)}\n\nQUESTION: ${query}\n\n` +
      'Do the sources above contain the specific information needed to answer that ' +
      'question? Reply YES or NO.',
  };
}

/**
 * Read the verdict out of a short generation.
 *
 * Defaults to sufficient when the reply is unreadable. A parser failure is a
 * bug in this file, and the honest failure mode for one is to leave behaviour
 * as it was rather than to start refusing questions Fred can answer.
 */
export function readSufficiency(text: string): boolean {
  const t = text.trim().toUpperCase();
  if (t.startsWith('NO')) return false;
  if (t.startsWith('YES')) return true;
  if (/\bNO\b/.test(t) && !/\bYES\b/.test(t)) return false;
  return true;
}
