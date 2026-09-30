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

/** Fred's reply to small talk (intent 'chat'): no advice, nothing invented. */
export const CHAT_REPLY = "Got it. I'm here if anything comes up, whether it's first aid, survival, or the plants and animals around you.";

/**
 * Small talk that still matched a field card. "I think I'm lost" was read as
 * chat on the breadth set, and "I'm here if anything comes up" is the wrong
 * thing to say to someone who might be in trouble, so when a card matched the
 * reply points at it instead.
 */
export const CHAT_REPLY_WITH_OFFER = "Got it. In case you need it, here's what to do:";

/**
 * What Fred says when the question is a clinical procedure (provider-only
 * material; pipeline.ts). Fixed text, not generated: the point is that the
 * model never sees the procedure.
 */
export const REFER_REPLY =
  "That's a procedure for trained medical providers, so I won't walk you through it. Call emergency services or get the person to medical care as fast as you can.";

/**
 * What Fred says when someone is in trouble and nothing in the manuals
 * matched (#98, docs/plan-understand.md). Fixed text, never generated, so it
 * cannot invent advice. Each line comes from a reviewed field card: the radio
 * or phone line from signal-rescue, the injury check and "don't make a big
 * decision straight away" from lost-stay-or-move, "call emergency services"
 * from REFER_REPLY. It ends on a question so the conversation keeps going.
 */
export const SAFETY_NET_REPLY =
  "I couldn't find that exact situation in my manuals. What matters most right now:\n" +
  "1. If you have a phone with signal or a radio, use it first: call emergency services.\n" +
  "2. Check yourself and anyone with you for injuries.\n" +
  "3. Don't make a big decision straight away. Give yourself a little time to get over the shock, then look at your situation.\n" +
  "Tell me what's happening, and whether anyone is hurt.";

/**
 * What Fred says when something is wrong but no danger sign is present and
 * nothing in the manuals matched (#98 round 2, docs/plan-understand-2.md).
 * Fixed text from reviewed field cards: the warning signs from the get-help
 * lines of stings-bites (trouble breathing, a swollen face or throat),
 * bleeding-severe, head-injury (worsening confusion, passing out) and
 * heart-stroke (chest pain); the phone or radio line from signal-rescue. It
 * ends on a question so the conversation keeps going.
 */
export const WATCH_REPLY =
  "I don't have steps for that exact problem in my manuals.\n" +
  "Get help right away if any of these appear: trouble breathing, a swollen face or throat, bleeding that won't stop, " +
  "chest pain, or confusion or passing out. A phone with signal or a radio is the quickest way to get help.\n" +
  "Tell me more about what's happening and I'll look again.";

/** Asked when a card was held back because it must not follow a condition (conditions.ts). */
export const CONDITION_CLARIFY = (label: string): string => `Is this about the ${label}?`;

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
function shapeInstruction(blocks: readonly ContextBlock[], query: string, shape: ShapeVariant): string {
  const procedures = blocks.filter((b) => b.chunk.blockKind === 'procedure').length;
  const steps = procedures * 2 >= blocks.length || (shape !== 'default' && ASKS_HOW.test(query));
  if (steps) return 'Reply with short numbered steps and nothing else.';
  return shape === 'how-few'
    ? 'Reply with a few short sentences and nothing else.'
    : 'Reply with two or three short sentences and nothing else.';
}

/**
 * A question asking how to do something. Under shape 'how' it is answered in
 * steps even when the retrieved passages are not tagged as procedures: the tag
 * comes from each passage's own layout, so the second half of a list split
 * across two passages reads as prose, and "how does a bow drill work?" got two
 * sentences with every step in hand (docs/results-thin-answers.md).
 */
const ASKS_HOW = /\b(?:how (?:do|does|can|should|would|to)\b|what (?:should|do|can) (?:i|we)\b|what to do\b|steps? (?:to|for)\b)/i;

/**
 * How the answer's shape is chosen. 'default' decides from the passages alone;
 * 'how' also answers how-to questions in steps; 'how-few' adds a looser length
 * for everything else ("a few" sentences, not "two or three").
 */
export type ShapeVariant = 'default' | 'how' | 'how-few';

/** First-aid material is the only kind for which the emergency line is apt. */
function isMedical(blocks: readonly ContextBlock[]): boolean {
  return blocks.some(
    (b) => b.chunk.domain === 'first-aid-physical' || b.chunk.domain === 'first-aid-psychological',
  );
}

/** Rendered when the user is offline and the answer is medical. */
export const MEDICAL_DISCLAIMER =
  'This is general guidance from offline reference material, not professional medical advice. If you can reach emergency services, do that first.';

/**
 * The plant and wildlife database (FEIS) describes plants as food for animals
 * in whole sections, and a 1.7B model reads "palatable to livestock" as
 * "edible": "is quaking aspen something a person can eat?" got "Yes, quaking
 * aspen is palatable to all browsing livestock", and a held-out marsh question
 * called wildlife forage edible. A note in front of those passages says what
 * they are about. Added to the prompt only, never the index: in the index its
 * words would pull these passages up for "can I eat" questions.
 */
const FORAGE_NOTE: readonly [RegExp, string][] = [
  [/ > (?:Importance to Wildlife and Livestock|Palatability and Nutritional Value)$/,
    '(About animals eating this plant. It does not say whether people can eat it.)'],
  [/ > Diet$/, '(About what this animal eats. It does not say whether people can eat those plants.)'],
];

const forageNote = (section: string): string => {
  const hit = FORAGE_NOTE.find(([re]) => re.test(section));
  return hit === undefined ? '' : `${hit[1]}\n`;
};

export function renderContext(blocks: readonly ContextBlock[]): string {
  return blocks
    .map((b, i) => {
      const page = b.chunk.page === null ? '' : `, p. ${b.chunk.page}`;
      // The contextual-retrieval preamble goes in front of the passage, not
      // just into the index. A 1.7B model will read a headerless "Do not" list
      // as instructions (arXiv 2605.13829, and twice in our own eval), and a
      // first line saying "Lists actions to AVOID" is what prevents that.
      const context = b.chunk.context === '' ? '' : `${b.chunk.context}\n`;
      return `SOURCE ${i + 1} (${b.chunk.source}${page})\n${context}${forageNote(b.chunk.section)}${b.text}`;
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
export function buildQuerySuffix(
  query: string,
  blocks: readonly ContextBlock[],
  place?: string,
  earlier?: string,
  shape: ShapeVariant = 'default',
): string {
  const rules = [shapeInstruction(blocks, query, shape)];
  // Fired unconditionally before, so it turned up on "what plants and animals are
  // near me?" and on a question about what mountain lions eat.
  if (isMedical(blocks)) {
    rules.push('If life is at risk, say to contact emergency services first.');
  }
  // "Are there black bears in this state?" cannot be answered from a passage
  // about California unless the model knows "this state" is California: the
  // model refused exactly that with the right passage in hand (ff-bear-01).
  const where = place === undefined ? '' : `\n(The hiker is in ${place}.)`;
  // A follow-up ("should I pop it?") means nothing alone. Only the previous
  // question is shown: never the previous answer, which a small model builds
  // on instead of the sources, and never the previous sources, which are
  // distractors (docs/results-memory-research.md).
  const before = earlier === undefined ? '' : `EARLIER QUESTION: ${earlier}\n`;
  return `\n\nSOURCES:\n${renderContext(blocks)}\n\n${before}QUESTION: ${query}${where}\n\n${rules.join('\n')}\n\nANSWER:`;
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
  place?: string,
  earlier?: string,
  shape: ShapeVariant = 'default',
): PromptParts {
  return {
    system: variant === 'lead' ? SYSTEM_PREFIX_LEAD : SYSTEM_PREFIX,
    user: buildQuerySuffix(query, blocks, place, earlier, shape).trimStart(),
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

/**
 * Restate a question in field-manual wording, for a second search when the
 * first finds nothing (docs/plan-phase3.md step 4). The output is only ever
 * searched with, never shown or given to the answering prompt: "my gear is
 * squeaking" misses the manual's "animal fat can be used to grease
 * equipment", and this is the bridge.
 */
export function buildRewriteParts(query: string): PromptParts {
  return {
    system: 'You translate a hiker\'s question into the terms a US Army survival or first-aid field manual would use.',
    user: `QUESTION: ${query}\n\nWrite one or two sentences, in a field manual's own words, that a manual passage about this topic would contain. Name the topic the way the manual would. Write only the sentences.\n\nPASSAGE:`,
  };
}
