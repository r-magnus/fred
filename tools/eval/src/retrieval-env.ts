/**
 * Retrieval settings from the environment, so a comparison between two search
 * configurations is a change of variables rather than an edit to rag-core.
 *
 *   RETRIEVAL_QUERY=question|keywords   what the query vector is built from
 *   DENSE_POOL=<n>                      nearest-by-meaning chunks per pack (0 = off)
 *   TOPK=<n>                            chunks handed to the generator
 *   ALPHA=<0..1>                        weight of meaning vs keyword score in the blend
 *
 * Every run prints the settings it used, because a results file that does not
 * say how it was produced is not evidence.
 */
import { readFileSync } from 'node:fs';
import { DEFAULT_COMPRESSION, DEFAULT_RETRIEVAL, type AskOptions, type CardAnswerMode, type RetrievalOptions, type SaidAsModel, type ScopeModel } from '@fred/rag-core';

function scopeModelFromFile(path: string, threshold?: string): ScopeModel {
  const m = JSON.parse(readFileSync(path, 'utf8')) as ScopeModel;
  return threshold === undefined ? m : { ...m, threshold: Number(threshold) };
}

function int(name: string, fallback: number, min: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new Error(`${name} must be an integer >= ${min}, got ${raw}`);
  return n;
}

function alphaFromEnv(): number {
  const raw = process.env.ALPHA;
  if (raw === undefined) return DEFAULT_RETRIEVAL.alpha;
  const a = Number(raw);
  if (!(a >= 0 && a <= 1)) throw new Error(`ALPHA must be between 0 and 1, got ${raw}`);
  return a;
}

export function retrievalFromEnv(): RetrievalOptions {
  const q = process.env.RETRIEVAL_QUERY ?? DEFAULT_RETRIEVAL.queryInput;
  if (q !== 'question' && q !== 'keywords') throw new Error(`RETRIEVAL_QUERY must be question or keywords, got ${q}`);
  return {
    ...DEFAULT_RETRIEVAL,
    queryInput: q,
    densePool: int('DENSE_POOL', DEFAULT_RETRIEVAL.densePool, 0),
    topK: int('TOPK', DEFAULT_RETRIEVAL.topK, 1),
    alpha: alphaFromEnv(),
  };
}

export function describeRetrieval(r: RetrievalOptions): string {
  return `query=${r.queryInput} densePool=${r.densePool} topK=${r.topK} alpha=${r.alpha}`;
}

/**
 * COMPRESS=1 turns trimming back on at the paper's 20-40% bounds. Unset (or 0)
 * keeps the shipping default, which hands passages to the model whole.
 */
export function compressionFromEnv(): { minReduction: number; maxReduction: number; keepWhole?: number } | undefined {
  const raw = process.env.COMPRESS;
  if (raw === undefined || raw === '0') return undefined;
  if (raw === '1') return { ...DEFAULT_COMPRESSION };
  // COMPRESS=keep1: trim, but keep the best passage whole (#108).
  if (raw === 'keep1') return { ...DEFAULT_COMPRESSION, keepWhole: 1 };
  throw new Error(`COMPRESS must be 0, 1 or keep1, got ${raw}`);
}

/**
 * Every pipeline switch an eval run can flip, from the environment, shared by
 * run-graded.ts and run-conversations.ts so both measure the same pipeline.
 * The per-question fields (state, previous, signal) are the caller's.
 */
export function askOptionsFromEnv(): Omit<AskOptions, 'state'> {
  const retrieval = retrievalFromEnv();
  const compression = compressionFromEnv();
  const env = process.env;
  return {
    retrieval,
    ...(compression === undefined ? {} : { compression }),
    // ABSTAIN_THRESHOLD overrides the decline gate; 0 lets every question
    // through, which is what calibrate.ts needs to see the score distribution.
    ...(env.ABSTAIN_THRESHOLD !== undefined ? { abstainThreshold: Number(env.ABSTAIN_THRESHOLD), fallbackThreshold: Number(env.ABSTAIN_THRESHOLD) } : {}),
    // ROUTING_FALLBACK=1 measures what searching everything on a no-match
    // recovers. Off by default so a plain run reflects what ships.
    ...(env.ROUTING_FALLBACK === '1' ? { allowRoutingFallback: true } : {}),
    ...(env.FALLBACK_THRESHOLD !== undefined ? { fallbackThreshold: Number(env.FALLBACK_THRESHOLD) } : {}),
    // SUFFICIENCY=1 asks the model whether the retrieved passages answer the
    // question before generating. Off by default until it has earned its cost.
    ...(env.SUFFICIENCY === '1' ? { checkSufficiency: true } : {}),
    // SUFFICIENCY_PROMPT=numeric swaps in the wording that makes "a question
    // asking for a quantity needs the quantity present" an explicit rule. The
    // default wording is 0 of 3 on dosing questions.
    ...(env.SUFFICIENCY_PROMPT === 'numeric' ? { sufficiencyVariant: 'numeric' as const } : {}),
    // ANSWER_SHAPE=lead adds "give the thing the question asks for, first".
    ...(env.ANSWER_SHAPE === 'lead' || env.ANSWER_SHAPE === 'narrow' || env.ANSWER_SHAPE === 'partial' ? { answerVariant: env.ANSWER_SHAPE } : {}),
    // JOIN=1 gives neighbouring passages as one (docs/results-noise-research.md).
    ...(env.JOIN === '1' ? { joinNeighbours: true } : {}),
    // SHAPE=how|how-few: how-to questions answered in steps; how-few also loosens the sentence cap.
    ...(env.SHAPE === 'how' || env.SHAPE === 'how-few' ? { shapeVariant: env.SHAPE } : {}),
    // SECOND_SEARCH=1 restates a question that scored under the gate in manual wording and searches again.
    ...(env.SECOND_SEARCH === '1' ? { secondSearch: true } : {}),
    // WIDEN=0 keeps a weak routed search instead of retrying it across every unscoped pack (on by default).
    ...(env.WIDEN === '0' ? { widenWeakSearch: false } : {}),
    // UNDERSTAND=0 turns off the understanding step and the safety net (#98; on by default).
    ...(env.UNDERSTAND === '0' ? { understand: false } : {}),
    // LEAD=0 shows the card itself for a specific question (#109; on by default).
    ...(env.LEAD === '0' ? { lead: false } : {}),
    // GUARDS=0 turns off round 2 of #98 (conditions, question rule, danger signs, agreement).
    ...(env.GUARDS === '0' ? { guards: false } : {}),
    // NEAR_QUOTE=0 declines a search under the gate whatever its closest sentence (#23; on by default).
    ...(env.NEAR_QUOTE === '0' ? { quoteUnderGate: false } : {}),
    // CLOSEST_CARD=0 leaves a model decline as it is (#23; on by default).
    ...(env.CLOSEST_CARD === '0' ? { closestCard: false } : {}),
    // UNDERSTAND_TOP=3 sets the own-words rank rule, for calibration on tuning sets only.
    ...(env.UNDERSTAND_TOP !== undefined ? { understandOwnTop: Number(env.UNDERSTAND_TOP) } : {}),
    // UNDERSTAND_FLOOR=0.15 sets the own-words floor, for calibration on tuning sets only.
    ...(env.UNDERSTAND_FLOOR !== undefined ? { understandOwnFloor: Number(env.UNDERSTAND_FLOOR) } : {}),
    // LOCATION=0 stops naming the hiker's state in the prompt (on by default).
    ...(env.LOCATION === '0' ? { locationInPrompt: false } : {}),
    // CARD_ANSWER=off|card-only|pick overrides the default verbatim card answers.
    ...(env.CARD_ANSWER !== undefined ? { cardAnswer: env.CARD_ANSWER as CardAnswerMode } : {}),
    // PROMPT_MEMORY=0 keeps the earlier question out of the prompt, so the
    // search half of conversation memory can be measured alone.
    ...(env.PROMPT_MEMORY === '0' ? { previousInPrompt: false } : {}),
    // INTENT=1 decides what the hiker wants as well as the topic (intent.ts).
    ...(env.INTENT === '1' ? { intent: true } : {}),
    // OPENER=1: a friendly opening line before model-written answers (#130).
    ...(env.OPENER === '1' ? { opener: true } : {}),
    // VOICE=1: Fred's side of the conversation around fixed replies (#172, voice.ts).
    ...(env.VOICE === '1' ? { voice: true } : {}),
    // SCOPE=<model.json>: the scope scorer's second chance (scope.ts). SCOPE_T overrides its threshold.
    ...(env.SCOPE !== undefined && env.SCOPE !== '' ? { scope: scopeModelFromFile(env.SCOPE, env.SCOPE_T) } : {}),
    // SAID=<model.json>: the card matcher (said-as.ts, #152).
    ...(env.SAID !== undefined && env.SAID !== '' ? { saidAs: JSON.parse(readFileSync(env.SAID, 'utf8')) as SaidAsModel } : {}),
  };
}
