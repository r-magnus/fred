/**
 * End-to-end query pipeline, tying together routing, hybrid retrieval, selective
 * context compression, the abstention gate, and generation.
 *
 * Pure orchestration — every platform-specific concern arrives through the
 * interfaces in backends.ts, so this exact code path runs both on device and in
 * tools/eval.
 */
import type { InferenceBackend, MemoryMonitor, PackStore } from './backends.ts';
import type { CardSource, ChunkRecord, DomainTag } from '@fred/pack-format';
import { compressContext } from './compress.ts';
import { extractKeywords, type Keyword } from './lexicon.ts';
import { isRefusal, DEAD_ENDS, CLOSEST_CARD_LEAD, NO_ANSWER_REPLY, SAFETY_NET_REPLY, CONDITION_INSTEAD, buildPromptParts, buildRewriteParts, buildSufficiencyParts, readSufficiency, CHAT_REPLY, CHAT_REPLY_WITH_OFFER, CONDITION_CLARIFY, type ContextBlock, type PromptParts, type SufficiencyVariant, type AnswerVariant, type ShapeVariant } from './prompt.ts';
import { applyQueryTemplate, retrieve, DEFAULT_RETRIEVAL, type RetrievalOptions, type ScoredChunk } from './retrieve.ts';
import { classifyIntent, type Intent } from './intent.ts';
import { currentThread, leansBack, understandMessage, UNDERSTAND_HISTORY, type Understood } from './understand.ts';
import { blockingCondition, CONDITIONS, FIRE_STARTING, NO_FIRE, PAST_FIRE, violatedCondition, WILDFIRE_NEAR, type Condition } from './conditions.ts';
import { buildRecord, conditionsFor, latestFor, onlyHandedOver, saysResolved, sinceResolved } from './record.ts';
import { asksDose, asksSomething, asksToEatUnknown, dangerSign, dangerStands, eatingUnknownInThread, namesSpeaker, personIsHurt, petIsPatient, pointsBackAtPet, stuckOnTerrain } from './triage.ts';
import { noCardKind, noCardShare, saidAs, type Said, type SaidAsModel } from './said-as.ts';
import type { ReplyCost } from './energy.ts';
import { joinNeighbours } from './join.ts';
import { cosineInt8, dequantizeInt8 } from './score.ts';
import { exposureConditions, withExposures } from './exposures.ts';
import { rankSentences } from './sentences.ts';
import { NOT_FREDS_JOB, numberChecked, QUOTE_BAND, QUOTE_FLOOR, quoteIntro } from './grounding.ts';
import { route, type RoutablePack, type RouteResult } from './router.ts';
import { buildPickParts, cardLines, matchCardLines, parseCard, pickChoice, readPick, renderCard, renderCardSteps } from './card-answer.ts';
import { STATE_NAMES } from './states.ts';
import { makeOpener } from './opener.ts';
import { chatReply, declineReply, leadLine, type DeclineReply } from './voice.ts';
import { asRequest, scopeScore, type ScopeModel } from './scope.ts';

/**
 * Abstention threshold on the fused score U_i.
 *
 * Below this, Fred says it does not know instead of generating. An SLM handed
 * weak context will still produce fluent, confident prose, and in this domain a
 * confident wrong answer is worse than no answer. Tune against the eval set's
 * abstention precision/recall, not by feel.
 */
/**
 * Fused-score floor below which the pipeline declines.
 *
 * 0.35 was set by hand and never validated. It could not be lowered while the
 * router searched first aid for every unrecognised query, because the gate was
 * the only thing standing between a scuba question and an answer.
 *
 * With the scope gate in router.ts doing that job, this threshold is no longer
 * load-bearing for out-of-scope queries and only has to separate weak retrieval
 * from usable retrieval. Measured over the graded set, every out-of-scope query
 * that survives routing scores 0.277 or above 0.39, while three answerable ones
 * sit at 0.293, 0.332 and 0.341 — a sprained ankle, a tarp shelter at dusk, and
 * food storage at camp. Moving to 0.29 recovers all three and admits none.
 *
 * Fitted to 68 examples with a 0.016 margin, so treat it as provisional: the
 * durable version of this is a sufficient-context signal rather than one scalar
 * on a similarity score (docs/results-akr2.md).
 */
export const DEFAULT_ABSTAIN_THRESHOLD = 0.29;

/**
 * The bar when routing matched no vocabulary and searched everything anyway.
 *
 * Deliberately equal to the normal gate rather than higher. A raised bar here
 * would need a number, and the only data that could set one is the held-out
 * set — where the separating value is 0.50 (docs/results-holdout.md). Fitting
 * to that set would destroy the one honest measurement this project has, so
 * this ships at the already-fitted threshold and the option exists for when
 * there are unknown-vocabulary tuning questions to fit against.
 */
export const DEFAULT_FALLBACK_THRESHOLD = DEFAULT_ABSTAIN_THRESHOLD;

/**
 * Passages go to the model whole. Trimming saved ~170 prompt tokens (about a
 * second on the phone) but still cut the answer's source passage on 5 of 49
 * cited tuning questions, because it picks sentences by word overlap with the
 * question (docs/results-phase1.md §2). Pass `compression` to turn it back on.
 */
export const NO_COMPRESSION = { minReduction: 0, maxReduction: 0 } as const;

/** PocketRAG §3.5 — generation budget under memory pressure. */
export function maxTokensForPressure(pressure: number): number {
  if (pressure >= 0.85) return 256; // critical
  if (pressure >= 0.7) return 768; // moderate
  return 1024; // safe
}

export interface PipelineDeps {
  readonly backend: InferenceBackend;
  readonly store: PackStore;
  readonly packs: readonly RoutablePack[];
  readonly memory?: MemoryMonitor;
}

export interface AskOptions {
  readonly state: string | null;
  /** Search every domain when no vocabulary matches. See RouteContext. */
  readonly allowRoutingFallback?: boolean;
  /** Overrides DEFAULT_FALLBACK_THRESHOLD on the fallback path. */
  readonly fallbackThreshold?: number;
  /**
   * Ask the model whether the retrieved passages answer the question, and
   * abstain if not. Costs a second prefill of the same context.
   */
  readonly checkSufficiency?: boolean;
  /**
   * Which sufficiency wording to use. 'numeric' adds an explicit rule that a
   * question asking for a quantity needs that quantity present in the sources.
   */
  readonly sufficiencyVariant?: SufficiencyVariant;
  /**
   * Answer-shape wording. 'lead' adds an instruction to deliver the thing the
   * question asks for first — a name, a difference, a use — because three
   * held-out failures answer about the topic instead.
   */
  readonly answerVariant?: AnswerVariant;
  /**
   * Give neighbouring passages as one, their overlap written once (join.ts).
   * Off by default until measured (docs/results-noise-research.md).
   */
  readonly joinNeighbours?: boolean;
  /** How the answer's shape is chosen (prompt.ts ShapeVariant). Default: from the passages alone. */
  readonly shapeVariant?: ShapeVariant;
  readonly retrieval?: RetrievalOptions;
  /**
   * How to answer when a field card clearly matches (score at or above the
   * reserved-card bar, or CARD_TOP_FLOOR and top of the search). Default
   * 'verbatim', the only mode that cannot invert a card: measured against the
   * others in docs/results-phase3.md. 'off' treats the card as one passage among four;
   * 'verbatim' shows the card as written; 'card-only' has the model answer
   * from the card alone; 'pick' has the model choose the card's relevant steps
   * and shows those verbatim with the summary, don'ts and get-help line
   * (card-answer.ts, docs/plan-phase3.md step 2).
   */
  readonly cardAnswer?: CardAnswerMode;
  /**
   * When the first search scores under the gate, restate the question in
   * field-manual wording and search again (plan step 4). Costs one short
   * generation, only on questions that would otherwise be declined.
   */
  readonly secondSearch?: boolean;
  /**
   * Deep thinking (#21, docs/plan-deep-thinking.md): the person chose to wait
   * for a better answer. Each strategy is its own switch so it can be
   * measured alone. Cards, declines decided before generation and every
   * safety rule are unchanged.
   */
  readonly deep?: {
    /** A second search in manual wording under the gate, only for messages the scope scorer calls in scope. */
    readonly search?: boolean;
    /** The sentences closest to the question, put first as the evidence to write from. */
    readonly evidence?: boolean;
    /** Every sentence of the answer compared with the source sentences; unsupported ones dropped. */
    readonly check?: boolean;
    /** Drafts to write; the best supported is shown (1 or unset: one). */
    readonly drafts?: number;
  };
  /**
   * When the routed search scores under the gate, search again across every
   * unscoped pack and keep it if it clears the gate. Default on; off only to
   * measure what it changes.
   */
  readonly widenWeakSearch?: boolean;
  /** Name the hiker's state when the question points at it and a state pack is answered from. Default on. */
  readonly locationInPrompt?: boolean;
  /**
   * Compression bounds. `{ minReduction: 0, maxReduction: 0 }` hands the
   * retrieved passages to the model whole.
   */
  readonly compression?: { readonly minReduction: number; readonly maxReduction: number };
  readonly abstainThreshold?: number;
  readonly signal?: AbortSignal;
  /**
   * The hiker's previous message, for a follow-up (docs/plan-memory.md). The
   * message is searched alone and joined to this; the joined search wins only
   * when it scores higher, stays on the earlier topic and keeps any strong
   * match of the message's own (see the rules in ask()). Only then does the
   * model see the earlier question. Absent, ask() behaves exactly as it does
   * for a single question.
   */
  readonly previous?: {
    readonly question: string;
    /** That question's own best search score, from its diagnostics. */
    readonly topScore: number;
  };
  /** Show the model the earlier question when the joined search wins. Default on. */
  readonly previousInPrompt?: boolean;
  /**
   * The hiker's earlier messages in this conversation, oldest first, answered
   * or not (up to CONDITION_HISTORY). The understanding step reads only the
   * current topic's thread of them; the record of conditions reads them all
   * (#98).
   */
  readonly history?: readonly string[];
  /**
   * The understanding step (#98, docs/plan-understand.md): when a weak search
   * follows earlier messages, or an emergency finds nothing, ask the model for
   * the intent and a search request in plain words. Needs `intent`. Default
   * on; off only to measure what it changes.
   */
  readonly understand?: boolean;
  /** Overrides UNDERSTOOD_OWN_FLOOR, for calibration on the tuning sets. */
  readonly understandOwnFloor?: number;
  /**
   * Round 2 of #98 (docs/plan-understand-2.md): the record of conditions and
   * the cards that must not follow them, the question rule, danger signs for
   * the get-help-now reply, and two searches agreeing. Needs `understand`.
   * Default on; off only to measure what it changes.
   */
  readonly guards?: boolean;
  /** #23: quote the closest sentence for a search under the gate (UNDER_GATE_QUOTE_FLOOR). Default on; off only to measure. */
  readonly quoteUnderGate?: boolean;
  /** #23: with no danger sign, try that sentence before the watch reply of a message read as urgent. Default on; off only to measure. */
  readonly quoteBeforeWatch?: boolean;
  /** #23: a field card in place of the model's decline (CLOSEST_CARD_FLOOR). Default on; off only to measure. */
  readonly closestCard?: boolean;
  /** Overrides UNDERSTOOD_OWN_TOP, for calibration on the tuning sets. */
  readonly understandOwnTop?: number;
  /**
   * #109: a specific question answered from a card gets a short direct answer
   * from the card, with the card folded beneath. Default on; off only to
   * measure what it changes.
   */
  readonly lead?: boolean;
  /**
   * #101: the field card Fred showed for the message just before this one,
   * by title, when its reply was a card. A follow-up with nothing of its own
   * stays on it.
   */
  readonly lastCard?: string;
  /**
   * Decide what the hiker wants as well as what they are talking about
   * (intent.ts, docs/results-intent-probe.md): an emergency opens the top field
   * card even under the gate, and where Fred would otherwise say nothing
   * useful (small talk, a decline) the card that led the search is offered,
   * folded. Costs one short generation. Off by default until measured.
   */
  readonly intent?: boolean;
  /**
   * A friendly opening line before a model-written answer (#130, opener.ts):
   * one checked sentence written from the hiker's words, never the passages.
   * Left off for emergencies (a danger sign), card replies, declines, and
   * with guards off. Off by default until measured.
   */
  readonly opener?: boolean;
  /**
   * #172: Fred's side of the conversation around his fixed replies
   * (voice.ts): small-talk replies that fit what was said, a first line from
   * the hiker's own words before a card or a fixed reply, and declines that
   * say what would help. Fixed wording picked by rules, no model call. Off by
   * default so earlier runs compare word for word; left off with guards off.
   */
  readonly voice?: boolean;
  /**
   * Experiment: a trained scorer on the message's search vector gives a
   * second chance to messages about to be called small talk or declined
   * (scope.ts). Off by default until measured.
   */
  readonly scope?: ScopeModel;
  /**
   * #152: the matcher that says which field card a message is about
   * (said-as.ts). A card opened under the gate must be one the message
   * supports, and a pet or a medicine is known by more than a word list.
   */
  readonly saidAs?: SaidAsModel;
  /**
   * #152: the matcher called the message just before this one a pet's
   * (diagnostics.said.pet of that reply). "its bleeding a fair bit" after
   * "our lab tore a pad on the lava rock" is still about the dog.
   */
  readonly previousWasPet?: boolean;
}

export type CardAnswerMode = 'off' | 'verbatim' | 'card-only' | 'pick';

/** A field card shown folded, for the hiker to open if they want it. */
export interface CardOffer {
  readonly title: string;
  readonly text: string;
  readonly citation: Citation;
}

/**
 * With intent on, a field card that is the top search result opens for an
 * emergency or a question even under the gate, down to this floor. Casually
 * worded emergencies put the right card first at 0.19-0.43 on the practice
 * set, under the 0.29 gate, while the gate still refused them.
 */
export const INTENT_CARD_FLOOR = 0.15;
/**
 * #100: an emergency whose own words and restated request lead with the same
 * weather or terrain passage is answered from it a little under the gate.
 * "we're up on the ridge and just heard thunder, what do we do" led both
 * searches with the NWS lightning tips (0.268 and 0.288) and got the watch
 * reply. Only the hazards pack: what to do about lightning, floods and fire,
 * not care, where a lower gate made answers up (results-scope-scorer.md).
 * Never with a danger sign: "the smoke is so thick it's hard to breathe"
 * keeps the get-help reply.
 */
export const HAZARD_AGREED_FLOOR = 0.25;

/** An animal as the patient: no human first-aid card is forced open for it. */
const ABOUT_A_PET = /\b(?:my|our|the|his|her|their)\s+(?:dog|cat|puppy|kitten|horse|pony|pet|mule|donkey|goat)s?\b/i;

/** A message that only asks what to do: "what now", "ok so what do i do?", "help". */
const BARE_ASK = /^\s*(?:(?:ok(?:ay)?|so|and|well|alright)[\s,]+)*(?:what (?:now|next)|now what|what (?:do|should|can) (?:i|we) do(?: now| next)?|what should (?:i|we) be doing|help(?: me| us)?(?: please)?)\s*[?.!]*\s*$/i;

/** The best card counts as leading when it scores at least this share of the top result. */
export const INTENT_CARD_NEAR_TOP = 0.85;
/**
 * #152: a card opened under the gate stays when the matcher gives it at least
 * this share (said-as.ts), sure of it or not. Below it the message says
 * something else: "my friend tripped and landed on her wrist" gave the shock
 * card it opened under 0.01.
 */
export const SAID_SOME = 0.05;
/** A card the matcher only leans to replaces the one that led when its share is at least twice as large (frostbite 0.58 against trench foot 0.20 for white, waxy toes). */
export const SAID_CLEARLY = 2;
/**
 * #200: the share at which the matcher's "minor, no card" label turns NOW into
 * a question. Every friction problem it helped had at least 0.45 (hot spots
 * 0.47-0.79, heels rubbed raw 0.50, chafed thighs 0.70); the replies it made
 * worse were under it ("pain in my lower right belly... is it appendicitis?"
 * 0.36, "it's blistering" after a burn 0.24, a cactus spine 0.15). Set on
 * those seen replies.
 */
export const MINOR_CLEARLY = 0.45;
/**
 * #145: an everyday question is searched in the tips packs too, and that
 * search is kept when a tip leads it by this much over the routed search.
 * "how should i dress for a cold hike" was routed to first aid by "cold" and
 * "freezing", cleared the gate at 0.301 with a survival-manual passage that
 * opens on hot-weather clothing ("cotton or linen"), and never reached the
 * tips page on cold-weather clothing at 0.479.
 */
export const EVERYDAY_MARGIN = 0.05;
/** Childbirth and surgery are declined on purpose (tuning set), whatever the scorer says. */
const BEYOND_FIRST_AID = /\blabou?r\b|\bcontractions\b|\b(?:deliver|delivering) (?:the|a|her|our) baby\b|\bgiv(?:e|ing) birth\b|\bamputat\w*/i;

/**
 * The understanding step's search is kept only if its best passage is among
 * the UNDERSTOOD_OWN_TOPK best for the hiker's own words, scoring at least
 * UNDERSTOOD_OWN_FLOOR (#98). Set on the tuning sets only: every answerable
 * tuning conversation the step admitted scored 0.32 or more; a practice "moose
 * charging" matched the bear card at 0.196. The two out-of-scope admits scored
 * 0.40 and 0.29, so no floor separates scope, and none is claimed to.
 */
export const UNDERSTOOD_OWN_FLOOR = 0.2;
const UNDERSTOOD_OWN_TOPK = 20;
/**
 * Round 2: the request's passage is also kept when it ranks this high for the
 * hiker's own words, whatever its score. Scores shift from one message to the
 * next; ranks are steadier (research-conversation-safety.md). "i think it's a
 * bear" after rustling outside the tent found the bear card through the
 * request (0.396), but the hiker's own words reached it at 0.189, under the
 * floor, and Fred showed the safety net three times (phone, 2026-09-30).
 */
export const UNDERSTOOD_OWN_TOP = 5;
/**
 * The agreement rule still wants the hiker's own search to reach the card at
 * all, and the request's search to lead with it clearly: "my wife's feeling
 * dizzy" led both with the head-injury card, at 0.147 and 0.173, on the word
 * "dizzy" alone, and opened it (phone chats). The burns card that rule is for
 * reached 0.225 through the request. A message whose own search stays under
 * AGREED_CARD_FLOOR has nothing of its own to agree with.
 */
const AGREED_CARD_FLOOR = 0.1;
const AGREED_REQUEST_FLOOR = 0.2;

type UnderstoodDiag = NonNullable<Diagnostics['understood']>;

/**
 * The same backend for one question, adding the wall time spent in each kind
 * of call to `spent`, and embedding each text once. A widened retry, the
 * emergency re-search and the understanding step's searches embed text
 * already embedded; on the phone each embedding costs ~0.7 s (a fresh llama.rn
 * context per text, device-pack.ts), and a question the step ran on spent up
 * to 4.2 s embedding (2026-09-30 phone check).
 */
function timeCalls(b: InferenceBackend, spent: { modelMs: number; embedMs: number }): InferenceBackend {
  const vectors = new Map<string, Promise<Float32Array>>();
  return {
    embeddingSpec: () => b.embeddingSpec(),
    countTokens: (texts) => b.countTokens(texts),
    async embed(text) {
      const t = Date.now();
      let v = vectors.get(text);
      if (v === undefined) { v = b.embed(text); vectors.set(text, v); }
      try { return await v; } finally { spent.embedMs += Date.now() - t; }
    },
    generate(prompt, opts) {
      const inner = b.generate(prompt, opts);
      return (async function* () {
        const t = Date.now();
        try { yield* inner; } finally { spent.modelMs += Date.now() - t; }
      })();
    },
  };
}

/** The best field card, if it leads the search closely enough to answer an emergency. */
/** Every field card by title, read once per store. Cards are few (under 100). */
const cardCache = new WeakMap<PackStore, Promise<Map<string, ChunkRecord>>>();
function fieldCards(store: PackStore, packId: string): Promise<Map<string, ChunkRecord>> {
  let got = cardCache.get(store);
  if (got === undefined) {
    got = store.getChunks(Array.from({ length: 200 }, (_, i) => `${packId}:${i}`))
      .then((cs) => new Map(cs.map((c) => [c.section, c] as const)));
    cardCache.set(store, got);
  }
  return got;
}

/**
 * A card that leads a search by a wide margin, however low the scores: first,
 * and nothing else within THREAD_CARD_MARGIN of it. Scores of a long joined
 * thread are low and fragile: "i think im lost / phone at 15% / its getting
 * dark / what do i do" reached the lost card at 0.071, with nothing else above
 * 0.000; without "phone at 15%" it scored 0.248. Used only for the thread's
 * own words, only in an emergency, and only for a message with nothing of its
 * own.
 */
const THREAD_CARD_MARGIN = 0.5;
/** A question about medicine or a clinical procedure: never answered by a condition's card (#101). */
const MEDICINE_OR_PROCEDURE = /\bblood type\b|\btransfus\w*|\bstitch\w*|\bsutur\w*|\bstaple\w*|\b(?:ibuprofen|advil|tylenol|acetaminophen|aspirin|benadryl|naproxen|aleve|motrin|excedrin|paracetamol|imodium|diamox|antihistamines?|antibiotics?|painkillers?|morphine|meds?|medication|medicine|pills?|dose|dosage|overdos\w*|mg|milligrams?)\b|\bhow (?:many|much) (?:\w+ )?(?:can|should) (?:i|he|she|they|we) (?:take|give)\b|\bhow (?:many|much) [\w' ]{1,30}? (?:is|are) too (?:many|much)\b/i;
/** The body, the wound or the care, in a follow-up about a condition (#101). */
const ABOUT_THE_CARE = /\b(?:legs?|arms?|hands?|fingers?|fingertips?|thumb|wrist|ankle|knees?|foot|feet|toes?|calf|thigh|neck|back|head|face|lips|mouth|throat|chest|skin|wound|bite|sting|burn|blisters?|cut|swelling|bleeding|breathing|rings?|splint|bandage|dressing|ice|cold pack|warm(?: up|ing)?|rub|massage|drink|eat|sleep|nap|rest|walk|move|carry|evacuat\w*|hospital|doctor)\b/i;
/** A symptom or a worsening condition reported in a statement (#101). Not "fine", "better". */
/**
 * A question that asks something specific a card can answer in a sentence:
 * yes or no ("can i put ice on it", "should we run to the car"), or how long,
 * how much, where, which ("how long should i ice it"). Not a how-to ("how do
 * i stop the bleeding") or "what do i do": there the card's steps are the
 * answer.
 */
const LEAD_IN = String.raw`^\W*(?:(?:ok(?:ay)?|so|and|but),?\s+)*`;
// A yes/no opener, but not "can't feel my fingertips" or "don't know which way":
// those are statements.
const YES_NO = new RegExp(LEAD_IN + String.raw`(?:should|shall|can|could|may|is|are|do|does|did|would|will|was|must)\b(?!['’]?t\b)(?!.*\bwhat (?:do|should) (?:i|we) do\b)`, 'i');
const WH = String.raw`(?:how (?:long|much|many|far|tight|warm|hot|cold|often|soon|deep)\b|where (?:exactly |do |should |can )?(?:i|we|you)?\b|which (?:way|side|one)\b|what (?:temperature|should (?:i|we) (?:watch|look) for)\b)`;
/** How long, where, which...: at the start of the message, or anywhere in one that ends in a question mark. */
const WH_START = new RegExp(LEAD_IN + WH, 'i');
const WH_ANY = new RegExp(String.raw`\b` + WH, 'i');
const WOULD_HELP = /\bwould\b.*\bhelp\b/i;
/**
 * The question as the search embeds it. The embedding wrapper keeps each text's
 * vector for the turn, so when retrieval searched these exact words this costs
 * nothing more.
 */
function queryVector(backend: InferenceBackend, query: string): Promise<Float32Array> {
  return backend.embed(applyQueryTemplate(backend.embeddingSpec().queryTemplate, query));
}

/**
 * Deep thinking (#21, docs/plan-deep-thinking.md). Starting values, set
 * before any run and to be calibrated on the development sets only.
 * The evidence floor sits under QUOTE_FLOOR (0.57): evidence is read by the
 * model, not shown, so near lines are welcome.
 */
export const DEEP_EVIDENCE_FLOOR = 0.45;
export const DEEP_EVIDENCE_MAX = 6;
/** The Qwen3 model card's sampling for its non-greedy drafts. */
export const DEEP_DRAFT_TEMPERATURE = 0.6;
export const DEEP_DRAFT_SEED = 1729;
/** An answer sentence this close to some source sentence is taken as supported. */
export const DEEP_CHECK_FLOOR = 0.5;

/**
 * An answer cut into the units the check judges: a numbered or bulleted
 * line is one step; other lines are cut into sentences.
 */
export function answerUnits(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter((l) => l !== '').flatMap((l) =>
    /^(?:\d+[.)]|[-*•])\s/.test(l) ? [l] : l.split(/(?<=[.!?])\s+(?=["'(A-Z])/).map((x) => x.trim()).filter((x) => x !== ''));
}

/**
 * Whether a unit is judged: short ones ("Stay calm.") and the advice to get
 * help are always kept, since a source rarely words them the same way and
 * dropping them could only make an answer less safe.
 */
export function checkable(unit: string): boolean {
  if (unit.replace(/^(?:\d+[.)]|[-*•])\s+/, '').split(/\s+/).length < 5) return false;
  return !/\b(?:emergency services|911|call for help|get help|medical (?:help|attention|care)|see a doctor|seek (?:medical|help))\b/i.test(unit);
}

const JUDGE_STOP = new Set('a an the and or but if then than so to of in on at by for with from as is are was were be been being it its this that these those there here you your yours i me my we our us they them their he she his her him not no do does did can could should would will may might must just also very more most less some any all each every one two into out over under up down about after before while when where what which who how why own same other such only too off again further once'.split(' '));
/** Content words, folded the same way for an answer and its sources: plurals and -ing/-ed cut. */
function judgeWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?|\d+(?:[.,]\d+)?/g) ?? [])
    .filter((w) => !JUDGE_STOP.has(w) && (w.length > 2 || /\d/.test(w)))
    .map((w) => w.replace(/(?:ies)$/, 'y').replace(/(?:ing|ed|es|s)$/, ''));
}

/**
 * Deep thinking's judge, round 2 (#21): a tool reading the words, not
 * vectors. Round 1's vector scores differed by ~0.01 between drafts and
 * chose the one without "3 feet". A draft scores for the specifics of its
 * sources it keeps word for word (numbers, and two-word phrases from the
 * passages) and loses for content words found in neither the sources nor
 * the question (the model's own additions).
 */
export function judgeDraft(draft: string, sources: string, question: string): number {
  const src = judgeWords(sources);
  const known = new Set([...src, ...judgeWords(question)]);
  const pairs = new Set(src.slice(1).map((w, i) => `${src[i]} ${w}`));
  const words = judgeWords(draft);
  if (words.length === 0) return 0;
  const kept = new Set<string>();
  words.forEach((w, i) => {
    if (/\d/.test(w) && known.has(w)) kept.add(w);
    const pair = i > 0 ? `${words[i - 1]} ${w}` : '';
    if (pairs.has(pair)) kept.add(pair);
  });
  const novel = words.filter((w) => !known.has(w)).length / words.length;
  return kept.size - JUDGE_NOVEL_WEIGHT * novel * words.length;
}
/** How much one invented content word costs against one kept specific. */
export const JUDGE_NOVEL_WEIGHT = 0.5;

/** Cosine of two float vectors. */
function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length && i < b.length; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** Kept lines with their step numbers closed up again (1, 3, 4 -> 1, 2, 3). */
export function renumbered(lines: readonly string[]): string[] {
  let n = 0;
  return lines.map((l) => (/^\d+[.)]\s/.test(l) ? l.replace(/^\d+/, String(++n)) : l));
}

export function asksSpecifically(message: string): boolean {
  const specific = YES_NO.test(message) || WH_START.test(message) || (/\?\s*$/.test(message) && WH_ANY.test(message)) || WOULD_HELP.test(message);
  return specific && !/\bhow (?:do|can|should|would) (?:i|we|you)\b|\bwhat (?:do|should|can) (?:i|we) do\b|\bwhat now\b/i.test(message);
}

const SYMPTOM_REPORT = /\b(?:shiver\w*|shaking|shaky|dizzy|nause\w*|headache|throwing up|threw up|vomit\w*|hurts?|pain\w*|bleeding|blood|swell\w*|swollen|blister\w*|rash|itch\w*|numb|cramp\w*|wheez\w*|sweat\w*|breathing|soak\w*|bent|broken|tick|bonk\w*|hit (?:his|her|my|their) head|fell|tripped|landed on|stung|bit|bitten|cut|sliced|gash\w*|burn\w*|scald\w*|splinter|puffy|hives|sick|pale|out of it|confused|getting (?:cold|dark|worse)|freezing|can'?t (?:walk|stand|breathe|feel|move))\b/i;
/** Words of a symptom getting better or worse, for an update on the card just shown (#101). */
const SYMPTOM_UPDATE = /\b(?:swell\w*|swollen|bigger|puffy|puffing|redder|worse|still bleeding|bleeding again|hurts? (?:more|worse)|throbbing|pounding|numb\w*|tingl\w*|blister\w*|bubbles?|itch\w*|spreading|getting (?:worse|bigger|redder|darker))\b/i;
/**
 * "Nothing of its own" means a short message ("what do i do", "what now") or
 * one that asks about the thread ("should we just give him water and let him
 * rest", after heat stroke). A statement of something new does not take the
 * thread's card: "it left. my daughter grabbed the stove and her palm is red
 * and hurting" also scored under AGREED_CARD_FLOOR, and the thread it followed
 * (a bear in camp) opened the bear card for a burn (sealed chat set). Five
 * words alone was too blunt: it lost the heat-stroke follow-up.
 * #212: a longer question must still be on the thread's topic (the joined
 * search keeps FOLLOW_UP_ON_TOPIC of the earlier match). "how do I tell if
 * canned fish has gone bad" right after the head-injury card asked something
 * and scored under AGREED_CARD_FLOOR, and reopened the head-injury card.
 */
const THREAD_CARD_WORDS = 5;
const THREAD_CARD_MIN = 0.05;
function clearlyLeadingCard(candidates: readonly ScoredChunk[], isCard: (c: ScoredChunk) => boolean): ScoredChunk | undefined {
  const [first, second] = [...candidates].sort((a, b) => b.score - a.score);
  if (first === undefined || !isCard(first) || first.score < THREAD_CARD_MIN) return undefined;
  return second === undefined || second.score <= THREAD_CARD_MARGIN * first.score ? first : undefined;
}

/**
 * How close a passage must be to a field card, cosine between their stored
 * vectors, to count as saying the same thing. Measured 2026-10-02 (#121):
 * the same topic scored 0.65-0.81 (the sprain card and NIH's
 * sprain treatment 0.76, the water card and EPA's or the Army's purification
 * 0.68-0.81, hypothermia and NWS's cold page 0.65-0.66); related but different
 * topics 0.43-0.61 (shock and heat exhaustion 0.61, snakebite and sprain
 * treatment 0.48-0.55, choking and chest wounds 0.47-0.53).
 */
export const SAME_THING = 0.65;

/** For each card in a result list, the other passages that say the same thing. */
export type CardSupport = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * A passage that says the same thing as a card is not evidence against it.
 * New reference packs pushed weakly matched cards out of the lead with
 * passages on the very same thing: NIH's sprain treatment (0.181) above the
 * sprain card (0.146) for "my knee swelled up after a long descent", EPA's
 * disinfection page above the water card (#116, #51).
 */
async function cardSupport(candidates: readonly ScoredChunk[], isCard: (c: ScoredChunk) => boolean, store: PackStore): Promise<CardSupport> {
  const cards = candidates.filter(isCard);
  const others = candidates.filter((c) => !isCard(c));
  const out = new Map<string, Set<string>>();
  if (cards.length === 0 || others.length === 0) return out;
  const all = [...cards, ...others];
  const vecs = await store.getVectors(all.map((c) => ({ chunkId: c.chunk.id, packId: c.chunk.packId, ordinal: c.chunk.ordinal })));
  cards.forEach((card, i) => {
    const v = dequantizeInt8(vecs[i]!.vec, vecs[i]!.scale);
    const same = new Set<string>();
    others.forEach((o, j) => { if (cosineInt8(v, vecs[cards.length + j]!.vec) >= SAME_THING) same.add(o.chunk.id); });
    out.set(card.chunk.id, same);
  });
  return out;
}

/**
 * The card's score, or the top result's when the top result says the same
 * thing as the card: the strongest evidence agrees with it. Any agreeing
 * passage was too loose: "do i pop it" (a burn blister) led with a blister
 * passage, and the Army's trench-foot pages two and three down, which agree
 * with the trench-foot card because it mentions blisters, opened that card.
 */
function supportedScore(card: ScoredChunk, candidates: readonly ScoredChunk[], support?: CardSupport): number {
  const top = candidates.reduce<ScoredChunk | undefined>((b, c) => (b === undefined || c.score > b.score ? c : b), undefined);
  return top !== undefined && support?.get(card.chunk.id)?.has(top.chunk.id) === true ? Math.max(card.score, top.score) : card.score;
}

function leadingCard(candidates: readonly ScoredChunk[], isCard: (c: ScoredChunk) => boolean, support?: CardSupport): ScoredChunk | undefined {
  const top = candidates.reduce((m, c) => Math.max(m, c.score), 0);
  const card = candidates.filter(isCard).reduce<ScoredChunk | undefined>((b, c) => (b === undefined || c.score > b.score ? c : b), undefined);
  return card !== undefined && card.score >= INTENT_CARD_FLOOR && supportedScore(card, candidates, support) >= INTENT_CARD_NEAR_TOP * top ? card : undefined;
}

/**
 * A card below the reserved-slot bar still counts as a clear match when it
 * outscores every manual passage and clears this floor. On the tuning set the
 * right card sat at 0.338-0.340 on top for burns, cuts and boil-less water,
 * while the highest-scoring wrong card (choking, for a chest wound) was 0.308
 * and below a manual passage (docs/results-phase3.md).
 */
export const CARD_TOP_FLOOR = 0.32;

/**
 * #23: when the model declines a question the search chose to answer, the
 * best field card it was handed is shown under CLOSEST_CARD_LEAD, if the card
 * scored at least this. "how do i start a fire with wet wood" had the campfire
 * card at 0.318, under CARD_TOP_FLOOR, and the model declined three times in
 * four on the phone with the card's dry-tinder and dry-base lines in hand.
 * Nothing else changes: this runs only on a reply that was a decline.
 */
export const CLOSEST_CARD_FLOOR = 0.29;

/**
 * #23: a search under the gate is still answered, by quoting, when the best
 * sentence in the passages found is at least this close to the question. On
 * the tuning, breadth and working `assembled` sets (55 searches declined under
 * the gate) the four at or above 0.60 were all the answer: "walk 200 feet or
 * 70 large steps away" for how far from the lake to dig, "Fresh rainwater
 * collected into containers does not require purification" (0.608 to 0.676).
 * The closest sentence for a question Fred must decline was 0.592 ("How do I
 * amputate a trapped limb?") and 0.582 (stitching a cut), then 0.556 and down.
 * Stricter than QUOTE_FLOOR, which is only used above the gate.
 */
export const UNDER_GATE_QUOTE_FLOOR = 0.6;

/**
 * A follow-up whose own best match reaches this keeps that match: the search
 * joined to the previous question may only win if it contains it. The same
 * bar that makes a field card a clear match (retrieve.ts reserve.minScore).
 */
export const FOLLOW_UP_KEEP = 0.35;

/** Share of the earlier question's own score the joined search must keep. */
export const FOLLOW_UP_ON_TOPIC = 0.9;

/** A provider-only passage this close to the best manual match triggers a referral. */
export const PROVIDER_NEAR_TOP = 0.95;

/** Words that point at where the hiker is, which the model cannot resolve alone. */
const REFERS_TO_LOCATION = /\b(?:this|my|our) (?:state|area|region)\b|\baround here\b|\bnear (?:me|here)\b|\bnearby\b|\bhere\b|\blocal(?:ly)?\b/i;

export interface Citation {
  readonly index: number;
  readonly chunkId: string;
  readonly source: string;
  readonly section: string;
  readonly page: number | null;
  readonly licenseId: string;
  readonly score: number;
  /**
   * For a field card: the manuals and pages its quotes come from, so the
   * reader can check the card against its sources (manifest `cardSources`).
   */
  readonly basis?: readonly CardSource[];
  /**
   * For sources credited per page (a licence id with a colon, e.g.
   * "wikivoyage:Hiking"): the credit line the licence requires and a link to
   * the page at the revision quoted (#96, docs/licensing.md).
   */
  readonly credit?: { readonly text: string; readonly url: string };
  /**
   * The passage itself, as the guide words it, so the reader can see what the
   * answer was drawn from and not only where (US-03, #215). Left out for a
   * field card, whose own text is the answer.
   */
  readonly passage?: string;
}

export interface Diagnostics {
  readonly keywords: readonly Keyword[];
  readonly route: RouteResult;
  readonly candidates: readonly ScoredChunk[];
  readonly topScore: number;
  readonly tokensBefore: number;
  readonly tokensAfter: number;
  readonly contextReduction: number;
  readonly maxTokens: number;
  readonly memoryPressure: number;
  /** Model's verdict on whether the context answers the question; null if unchecked. */
  readonly sufficient?: boolean | null;
  /** The understanding step, when it ran: what it read, and whether its search was kept. */
  /** #228: the message read as small talk was answered as the understanding step's request. */
  readonly addedToThread?: { readonly message: string; readonly request: string };
  readonly understood?: {
    readonly intent: Understood['intent'];
    readonly request: string;
    /** Best score of the request's own search. */
    readonly topScore?: number;
    /** That passage scored against the hiker's own words; undefined when not among them. */
    readonly ownScore?: number;
    /** Its rank (0-based) among the hiker's own words' results; undefined when not among them. */
    readonly ownRank?: number;
    readonly used: boolean;
    /** #100: a card the bare follow-up found was left closed, as the request did not lead with it. */
    readonly cardLeftClosed?: string;
  };
  /** Round 2: the conditions the conversation established (conditions.ts). */
  readonly conditions?: readonly string[];
  /** Round 2: a card that was not shown because it must not follow a condition. */
  readonly blocked?: { readonly card: string; readonly condition: string };
  /** #240: the card just shown, held back from being shown whole again; the model wrote with it first. */
  readonly repeatHeld?: string;
  /** Round 2: a below-gate emergency card opened because two searches agreed on it. */
  readonly agreedCard?: string;
  /**
   * Round 2: set while a condition is active and the answer is model-written.
   * `replacedBy` is filled in once the stream has been read, when the answer
   * gave advice the condition's card says not to give and the card was shown.
   */
  /** #23: the retrieved passages' sentence closest to the question, when the search fell under the gate. */
  readonly nearSentence?: { readonly similarity: number; readonly text: string };
  /** `refused`: the model's whole reply was a dead end (#23); `replacedBy`: what was shown instead. */
  readonly answerGuard?: { readonly replacedBy?: string; readonly refused?: boolean };
  /** Time before the decision, split into model calls and embedding (ms). */
  readonly timing?: { readonly modelMs: number; readonly embedMs: number; readonly totalMs: number };
  /** Top score of the search widened to every unscoped pack, when the routed one fell under the gate. */
  readonly widenedTopScore?: number;
  /** The manual-wording restatement, when a second search ran, and what it scored. */
  readonly secondSearch?: { readonly rewrite: string; readonly topScore: number };
  /** What deep thinking did (#21): drafts written, support of the one shown, sentences dropped. */
  readonly deep?: { readonly drafts: number; readonly support: readonly number[]; readonly chosen: number; readonly dropped: readonly string[]; readonly quoted: boolean; readonly evidence: number; readonly units: readonly { readonly draft: number; readonly text: string; readonly support: number; readonly onQuestion: number }[]; readonly texts: readonly string[] };
  /** What the hiker wants, when intent is on. */
  readonly intent?: Intent;
  /** The scope scorer's score, and what it changed, when it is on (scope.ts). */
  readonly scope?: { readonly z: number; readonly used: readonly ('framed' | 'not-chat' | 'card' | 'gate' | 'hazard')[] };
  /**
   * The card matcher's top label and its share, what it changed, and whether
   * it took the message as a pet's (said-as.ts).
   */
  readonly said?: { readonly label: string; readonly p: number; readonly pet: boolean; readonly used: readonly ('card' | 'no-card' | 'opened' | 'offered' | 'minor')[] };
  /** The everyday-tips packs were searched too and led (#145). */
  readonly everyday?: { readonly routedTopScore: number; readonly topScore: number };
  /** Small talk taken as news about a problem still open in the conversation. */
  readonly newsNotChat?: boolean;
  /** Conversation memory: both searches' top scores, and whether the joined one won. */
  readonly followUp?: { readonly standaloneTopScore: number; readonly joinedTopScore: number; readonly used: boolean };
  /** Set when the answer was built from a field card rather than the passages. */
  readonly cardAnswer?: CardAnswerMode;
}

/** A card's clarifying question, ready to show (see AskResult 'answer'). */
export interface ClarifyView {
  readonly question: string;
  readonly choices: readonly { readonly label: string; readonly text: string }[];
  /** The answer the message already gave, or null when Fred should ask. */
  readonly picked: string | null;
  /** The whole card, for "Not sure". */
  readonly whole: string;
}

export type AskResult =
  /** Retrieval succeeded and cleared the gate; stream the answer. */
  | {
      readonly kind: 'answer';
      readonly stream: AsyncIterable<string>;
      readonly citations: readonly Citation[];
      readonly medical: boolean;
      /**
       * Exactly what the model is given. Exposed so the eval can check whether
       * the answer's source passage survived retrieval and compression, which
       * the citation labels alone cannot show.
       */
      readonly prompt: PromptParts;
      /**
       * A field card whose steps depend on one detail (#50). The app shows
       * the question with a button per answer; each answer's text is the
       * card's own steps for that case. `picked` is set when the message
       * already said which (the answer then shows only that case).
       */
      readonly clarify?: ClarifyView;
      /**
       * #109: the field card the answer was written from, shown folded beneath
       * a short direct answer. Undefined when the card itself is the answer.
       */
      readonly card?: CardOffer;
      /**
       * #130: the opening line streamed before the answer, filled in once it
       * is decided (null: none was shown). Undefined when no opener was tried.
       * #172: also the rule-picked first line before a card or a fixed reply.
       */
      readonly opener?: { text?: string | null };
      readonly diagnostics: Diagnostics;
    }
  /** Small talk: a short fixed reply, with the matching card offered if any. */
  | {
      readonly kind: 'chat';
      readonly reply: string;
      readonly offer: CardOffer | null;
      readonly diagnostics: Diagnostics;
    }
  /** The query needs a state pack but the location is unknown. */
  | {
      readonly kind: 'needs-location';
      readonly candidatePacks: readonly string[];
      readonly diagnostics: Diagnostics;
    }
  /**
   * Fred declines. `reason` says why: nothing cleared the threshold, the model
   * judged the passages insufficient, or the question is a clinical procedure
   * (the best match is provider-only material), which the app answers with
   * REFER_REPLY rather than "I don't know". 'safety-net': an emergency found
   * nothing, and the app shows SAFETY_NET_REPLY instead of a dead end; with
   * guards on, only when a danger sign is present. 'watch': something is
   * wrong but no danger sign and nothing matched: the app shows WATCH_REPLY.
   * 'out-of-scope': the understanding step read it as outside Fred's scope.
   */
  | {
      readonly kind: 'abstain';
      readonly reason: 'low-score' | 'insufficient' | 'provider-only' | 'safety-net' | 'watch' | 'out-of-scope';
      readonly nearest: readonly Citation[];
      /** The field card that led the search, when one did: shown folded under the decline. */
      readonly offer?: CardOffer;
      /** #172: a first line before the safety-net or watch reply. */
      readonly lead?: string;
      /** #172: what to say for a plain decline, in place of the one fixed sentence. */
      readonly decline?: DeclineReply;
      readonly diagnostics: Diagnostics;
    };

const MEDICAL_DOMAINS = new Set(['first-aid-physical', 'first-aid-psychological']);

/**
 * Where both tips packs made the cut, the National Park Service passage is
 * read before the Wikivoyage one (#96): Wikivoyage is volunteer-written and
 * unreviewed. Only the tips swap places among themselves; every other passage
 * keeps its position.
 */
export function tipsInTrustOrder(cs: readonly ScoredChunk[]): ScoredChunk[] {
  const rank = (c: ScoredChunk): number => (c.chunk.packId === 'core-tips-nps' ? 0 : 1);
  const slots = cs.map((c, i) => (c.chunk.domain === 'outdoor-skills' ? i : -1)).filter((i) => i >= 0);
  const tips = slots.map((i) => cs[i]!).sort((a, b) => rank(a) - rank(b));
  const out = [...cs];
  slots.forEach((i, k) => { out[i] = tips[k]!; });
  return out;
}

/**
 * Run the intent check and the understanding step once, on a harmless
 * message, so their model contexts are set up and their fixed prompts read
 * before the hiker's first question (#133). Cold, the first message after the
 * app opened spent 24 s in those two calls on the phone ("there's smoke and
 * fire coming up the ridge toward us": 26 s to the emergency reply). The same
 * code and prompts as a real question, so nothing here can drift from them.
 */
/** The hiker says something isn't there: "there's no manual", "i don't have a filter", "forgot the poles". */
/** A message that only acknowledges or reports progress: "ok it's off", "thanks", "ok made camp". */
export const ACKNOWLEDGES = /^\s*(?:ok(?:ay)?|k|alright|all right|thanks?|thank you|thx|got it|will do|done|cool|great|nice|sounds good|perfect)\b/i;

/** A message of nothing but acknowledgement: "ok thanks", "got it, will do", "cool!". */
const ACK_WORD = "(?:ok(?:ay)?|k|alright|all right|thanks?(?: (?:so much|a lot|again))?|thank you(?: (?:so much|again))?|thx|ty|got it|will do|cool|great|nice|sounds good|perfect|awesome|appreciate it)";
export const ONLY_ACKNOWLEDGES = new RegExp(`^\\s*${ACK_WORD}(?:[\\s,.!]+${ACK_WORD})*[\\s.!]*$`, 'i');

export const SAYS_MISSING = /\b(?:there'?s no|there is no|there are no|no (?!(?:longer|more|worries|problem|thanks|way|idea)\b)[a-z]+s?$|(?:i|we) (?:don'?t|do not|didn'?t) (?:have|bring|pack)|without (?:a|an|the|any)|(?:forgot|lost|broke|left) (?:the|my|our|a)|(?:doesn'?t|didn'?t) come with|(?:it'?s|is) (?:missing|broken))\b/i;

export async function warmUp(backend: InferenceBackend): Promise<void> {
  await classifyIntent('hello there', backend);
  await understandMessage('it hurts', ['i slipped on the trail'], backend);
}

export async function ask(
  query: string,
  deps: PipelineDeps,
  opts: AskOptions,
): Promise<AskResult> {
  // Deep thinking's "search harder" (#21, round 4): Fred answers as normal
  // first, and only a flat decline (search under the bar, no card offered)
  // is tried again with the second search. Running it before the quote and
  // card rescues (rounds 1-3) let a written answer replace a right quote ("dead
  // man" staking) or card (wet fire) on the confirmation sets.
  const searchHarder = opts.deep?.search === true;
  let res = await askUnvoiced(query, deps, searchHarder ? { ...opts, deep: { ...opts.deep, search: false } } : opts);
  if (searchHarder && res.kind === 'abstain' && res.reason === 'low-score' && res.offer === undefined && !opts.signal?.aborted) {
    const again = await askUnvoiced(query, deps, opts);
    if (again.kind === 'answer') res = again;
  }
  // #228: a message that adds a condition to the question just answered is
  // not small talk. "what should i bring on a day hike" then "it's supposed
  // to rain a lot" got "say the word if something comes up", though the
  // understanding step had read it as "what to bring on a day hike when it's
  // supposed to rain a lot" and that request found Wikivoyage's rain clothing
  // at 0.443. The request is asked instead when it carries a word of the
  // hiker's own that the earlier question didn't ("rain"), and only an
  // answer is taken from it. "thanks, that helps" and "good to know" add no
  // topic word to the request and stay small talk.
  // The understanding step runs only after a weak search; a follow-up joined
  // to the question before it searched well ("it's really windy up here"
  // after a tarp question) and was never restated, so it is read here.
  let addedRequest: string | undefined;
  if (mayAddToThread(res, query, opts)) {
    const request = res.kind === 'chat' ? res.diagnostics.understood?.request
      ?? (await understandMessage(query, opts.history ?? [opts.previous!.question], deps.backend, opts.signal))?.request : undefined;
    addedRequest = request === undefined ? undefined : addsToThread(res, query, opts, request);
  }
  if (addedRequest !== undefined && !opts.signal?.aborted) {
    // The request already carries the earlier question; joining it again would double it.
    const { previous: _joined, ...alone } = opts;
    let asked = addedRequest;
    let again = await askUnvoiced(addedRequest, deps, alone);
    // A terse restatement can read as small talk on its own ("water amount
    // for 12 mile hike in august"): the earlier question with the message
    // joined to it is asked instead.
    if (again.kind !== 'answer' && !opts.signal?.aborted) {
      asked = `${opts.previous!.question}, ${query}`;
      again = await askUnvoiced(asked, deps, alone);
    }
    // A card already in play is not swapped for another one: in a dizzy,
    // pale, headachy hiker's thread, "we're about 2 miles from the car" was
    // restated with the whole emergency and opened the head-injury card, which
    // then stuck to the next four messages (chats-phone, ph-day-hike).
    const card = again.kind === 'answer' && again.citations[0]?.source === 'Fred field card' ? again.citations[0].section : undefined;
    const swapsCard = opts.lastCard !== undefined && card !== undefined && card !== opts.lastCard;
    if (again.kind === 'answer' && !swapsCard) {
      res = { ...again, diagnostics: { ...again.diagnostics, addedToThread: { message: query, request: asked } } };
    }
  }
  return opts.voice === true && opts.guards !== false ? voiced(res, query, opts.history ?? []) : res;
}

/**
 * #228: the understanding step's request, when a message read as small talk
 * adds something of its own to the question Fred just answered.
 */
export function mayAddToThread(res: AskResult, query: string, opts: Pick<AskOptions, 'previous' | 'guards' | 'intent'>): boolean {
  return res.kind === 'chat' && opts.previous !== undefined && opts.guards !== false && opts.intent === true &&
    !ACKNOWLEDGES.test(query) && !ONLY_ACKNOWLEDGES.test(query) && !saysResolved(query) && !REPORTS_SUCCESS.test(query);
}

/** Words a restatement uses to frame a question, which add nothing to it. */
const THREAD_FILLER = new Set(['need', 'want', 'know', 'tell', 'get', 'make', 'way', 'best', 'safe', 'good', 'help', 'thing', 'deal', 'handle', 'tip', 'advice', 'question', 'ask', 'mean', 'like', 'right', 'now']);

/**
 * A message that says something worked is a wrap-up, not a new condition:
 * "haha nice, the fire is going now" after a campfire question was answered
 * with the campfire card again (#228, fresh controls).
 */
const REPORTS_SUCCESS = /^\s*(?:haha|ha|lol|yay|woo+|nice|sweet|awesome|perfect|great|good|cool|ok(?:ay)?|thanks?)\b|\b(?:is|are|it's|its) (?:going|working|lit|burning) (?:now|fine|well)\b|\b(?:that |it )?(?:worked|did the trick|did it)\b|\bmade it\b|\bfound (?:it|the trail|them|him|her)\b|\b(?:all|we're|were) (?:set|good|fine)\b/i;

export function addsToThread(res: AskResult, query: string, opts: Pick<AskOptions, 'previous' | 'guards' | 'intent'>, requestIn?: string): string | undefined {
  if (!mayAddToThread(res, query, opts) || res.kind !== 'chat' || opts.previous === undefined) return undefined;
  const request = (requestIn ?? res.diagnostics.understood?.request)?.trim();
  if (request === undefined || request === '') return undefined;
  const earlier = judgeWords(opts.previous.question);
  const before = new Set(earlier);
  const inRequest = new Set(judgeWords(request));
  // What the restatement adds to the earlier question. Not only the hiker's
  // own words: "over 100 degrees" was restated as "in hot weather", "only a
  // pot and a lighter" lost "pot" (#228, second round). Part of an earlier
  // word is not new: "fire" after "campfire".
  const isNew = (w: string): boolean => !before.has(w) && !earlier.some((e) => e.includes(w) || w.includes(e)) && !THREAD_FILLER.has(w);
  const added = [...inRequest].filter(isNew);
  return added.length > 0 ? request : undefined;
}

/**
 * #172: the reply with Fred's side of the conversation added (voice.ts).
 * What is decided, and every word of a card or an answer, stays as it was.
 */
function voiced(res: AskResult, query: string, history: readonly string[]): AskResult {
  if (res.kind === 'needs-location') return res;
  if (res.kind === 'chat') return { ...res, reply: chatReply(query, history, res.offer !== null) };
  const moment = dangerSign(sinceResolved([...history, query])) ? 'danger' : res.diagnostics.intent === 'now' ? 'now' : 'calm';
  if (res.kind === 'abstain') {
    if (res.reason === 'provider-only') return res;
    if (res.reason === 'safety-net' || res.reason === 'watch') {
      const lead = leadLine(query, history, res.reason === 'safety-net' ? 'danger' : moment, ['urgent', 'problem', 'worry']);
      return lead === null ? res : { ...res, lead };
    }
    return { ...res, decline: declineReply(query, history, res.reason === 'out-of-scope') };
  }
  // A model-written answer with the opener on: the line is settled there.
  if (res.opener !== undefined) return res;
  const lead = leadLine(query, history, moment);
  if (lead === null) return res;
  const inner = res.stream;
  return { ...res, stream: (async function* () { yield `${lead}\n`; yield* inner; })(), opener: { text: lead } };
}

async function askUnvoiced(
  query: string,
  deps: PipelineDeps,
  opts: AskOptions,
): Promise<AskResult> {
  // The opener goes only in front of a model-written answer: a card or a
  // reviewed reply is already quick and in Fred's voice, a decline gets none,
  // and in an emergency (a danger sign, or the intent check reads NOW) the
  // first words must be what to do.
  const res = await askCore(query, deps, opts);
  // News about an open problem that nothing answered stays small talk: a
  // decline would read as Fred not listening ("i can hear a river").
  if (res.kind === 'abstain' && (res.reason === 'low-score' || res.reason === 'insufficient') && res.diagnostics.newsNotChat === true) {
    return {
      kind: 'chat', reply: res.offer === undefined ? CHAT_REPLY : CHAT_REPLY_WITH_OFFER, offer: res.offer ?? null,
      diagnostics: res.diagnostics,
    };
  }
  if (opts.opener !== true || opts.understand === false || opts.guards === false) return res;
  if (res.kind !== 'answer' || res.diagnostics.cardAnswer !== undefined || res.clarify !== undefined) return res;
  const earlier = opts.history ?? [];
  if (res.diagnostics.intent === 'now' || dangerSign(sinceResolved([...earlier, query]))) return res;
  // Generated after the search, just before the answer. Started as the
  // message arrives instead, beside the search, it made answers 15-25 s
  // slower on the phone (docs/results-friendly-opener.md).
  const holder: { text?: string | null } = {};
  const inner = res.stream;
  async function* withOpener(): AsyncGenerator<string> {
    holder.text = await makeOpener(query, earlier, deps.backend, opts.signal).catch(() => null);
    // #172: a line the check dropped is replaced by one picked by rules.
    if (holder.text === null && opts.voice === true) holder.text = leadLine(query, earlier, 'calm');
    if (holder.text !== null) yield `${holder.text}\n`;
    yield* inner;
  }
  return { ...res, stream: withOpener(), opener: holder };
}

/**
 * #240: cards that stay the answer to any follow-up while the danger lasts,
 * because a written reply could tell the hiker to do the one thing the card
 * forbids, and no check (conditions.ts) catches it for these: "should i sit
 * her up against a tree" after a possible neck injury, "can we keep going up
 * tomorrow" after altitude illness, "is it ok to let him nap" after a head
 * injury, "do we play dead" with a bear close. Reviewed by title.
 */
export const CARD_HOLDS_FOLLOW_UPS: ReadonlySet<string> = new Set([
  'Heavy bleeding from a wound', 'A bandage soaking through with blood', 'Snakebite', 'Someone is choking',
  'Hypothermia: shivering, confused, too cold', 'Heat exhaustion and heat stroke', 'Someone is unconscious or not responding',
  'CPR: not breathing, no pulse', 'Shock after an injury', 'Severe allergic reaction (anaphylaxis)', 'Head injury or concussion',
  'Possible neck or back injury', 'Wound to the chest', 'Hip or pelvis injury after a fall', 'Altitude illness', 'Seizure',
  'Low blood sugar', 'Wound to the belly', 'Chest pain or signs of a stroke', 'A bear close by, charging or attacking',
  'A wildfire or its smoke nearby',
]);

async function askCore(
  query: string,
  deps: PipelineDeps,
  opts: AskOptions,
): Promise<AskResult> {
  const { store, packs, memory } = deps;
  // Where the time before the decision goes: model calls (intent, the
  // understanding step, a card's pick) and turning text into vectors (#98).
  const spent = { modelMs: 0, embedMs: 0 };
  const startedAt = Date.now();
  const backend = timeCalls(deps.backend, spent);
  // A card's citation carries the manuals its quotes come from.
  const citeOf = (c: ScoredChunk, i: number): Citation => {
    const basis = store.cardSourcesFor?.(c.chunk.id);
    const lic = c.chunk.licenseId.includes(':') ? store.licenseFor?.(c.chunk.licenseId) : undefined;
    return {
      ...toCitation(c, i),
      ...(basis === undefined ? {} : { basis }),
      ...(lic === undefined ? {} : { credit: { text: lic.attribution, url: lic.sourceUrl } }),
    };
  };
  const retrievalOpts = opts.retrieval ?? DEFAULT_RETRIEVAL;
  // A field card by its title: a condition's own card (conditions.ts).
  const cardByTitle = async (title: string): Promise<ScoredChunk | undefined> => {
    const packId = retrievalOpts.reserve?.packId;
    if (packId === undefined) return undefined;
    const chunk = (await fieldCards(store, packId)).get(title);
    return chunk === undefined ? undefined : { chunk, cosineRaw: 0, cosine: 0, sLex: 0, score: 0 };
  };
  // The card of the condition a follow-up is about: the latest one said,
  // when this message leans on the ones before it, points at someone with a
  // pronoun, or its own search reached that card at all.
  const conditionCardFor = async (q: string): Promise<ScoredChunk | undefined> => {
    const lc = latestFor(record, q, here);
    if (lc === undefined || lc.inLast) return undefined;
    // #173: the message just before said how someone got hurt (a fall), and
    // Fred answered it with another card: the follow-up is about that card.
    // "my mom slipped on the wet boardwalk... her wrist is swollen" got the
    // broken-bone card, and "can she still carry her pack" a line of the
    // spine card ("Pack rolled clothing ... on both sides of the head").
    // So that card is the one a decline falls back to: with no card, "can she
    // still carry her pack" got "I don't have reliable information on that".
    const shown = q === query && lc.condition.cause === true && lc.at === here - 1 && lastShown !== undefined && lastShown.chunk.section !== lc.condition.card;
    const card = shown ? lastShown : await cardByTitle(lc.condition.card);
    if (card === undefined) return undefined;
    // A question in the middle of a condition is about it when it names the
    // body, the wound or the care: "should i prop my leg up on my pack" after
    // the hiker's own snakebite. Any question was too broad: "how do i figure
    // out which way to go" after a cold night got the hypothermia card (phone,
    // 2026-09-30).
    // Never for a medicine or a procedure: "what blood type can I give them?"
    // after heavy bleeding got the bleeding card (conversation set, #101).
    if (MEDICINE_OR_PROCEDURE.test(q) || (q === query && medicine)) return undefined;
    // A situation (being lost) is not what a question about the body is
    // about, even one that points back: "I have a bad blister on my heel...
    // what should I do about it?" (conversation set).
    if (lc.condition.situation === true && ABOUT_THE_CARE.test(q)) return undefined;
    const about = leansBack(q) || (lc.condition.situation !== true && ABOUT_THE_CARE.test(q)) || /\b(?:he|she|it|his|her|him|they|them|its|it's)\b/i.test(q) ||
      candidates.some((c) => c.chunk.id === card.chunk.id);
    return about ? card : undefined;
  };
  const tipsPackIds = new Set(packs.filter((p) => p.domains.includes('outdoor-skills')).map((p) => p.id));
  const threshold = opts.abstainThreshold ?? DEFAULT_ABSTAIN_THRESHOLD;

  const pressure = memory?.pressure() ?? 0;
  const maxTokens = maxTokensForPressure(pressure);

  // #51: a situation with a disease risk the hiker does not name is searched
  // with the disease beside it ("a raccoon bit my kid" + rabies). Search only:
  // the prompt keeps the hiker's own words.
  const searched = opts.understand !== false && opts.guards !== false ? withExposures(query) : query;
  let keywords = extractKeywords(searched);
  let routed = route(keywords, packs, {
    state: opts.state,
    ...(opts.allowRoutingFallback === true ? { allowFallback: true } : {}),
  });
  let effectiveThreshold = routed.fallback
    ? (opts.fallbackThreshold ?? DEFAULT_FALLBACK_THRESHOLD)
    : threshold;


  // The text the adopted search was run on: the question, or it joined to the
  // previous one, or restated (below).
  let searchText = searched;
  // #152 (said-as.ts): which card the message is about, or what kind of
  // message no card is for, when the matcher is sure. A pet and a medicine
  // are known by the word lists or by the matcher: "our lab tore a pad on
  // the lava rock" has no "dog" in it, "how many naproxen is too many" named
  // a medicine the list lacked.
  const saidOn = opts.saidAs !== undefined && opts.understand !== false && opts.guards !== false;
  const saidList: readonly Said[] = saidOn ? saidAs(opts.saidAs!, await queryVector(backend, query)) : [];
  const saidTop = saidList[0];
  const saidSure = saidTop !== undefined && saidTop.p >= opts.saidAs!.sure ? saidTop : undefined;
  const saidKind = saidSure === undefined ? undefined : noCardKind(saidSure.label);

  // #100: the wildfire card is for a fire, and its words reach other things
  // coming at the hiker ("a group on horses is coming toward us on the
  // trail", "a storm rolled in and we can barely see in the snow"). Unless
  // WILDFIRE or the matcher says a fire, and not one that is over, it is left
  // out of every search, and the rest runs as if it did not exist (NO_FIRE).
  const fireCardOk = opts.understand === false || opts.guards === false ||
    WILDFIRE_NEAR.said([...currentThread(query, opts.history ?? []), query]) ||
    (saidTop?.label === WILDFIRE_NEAR.card && saidTop.p >= opts.saidAs!.leans && !PAST_FIRE.test(query));
  const search: typeof retrieve = async (...a) => {
    const cs = await retrieve(...a);
    return fireCardOk ? cs : cs.filter((c) => !(c.chunk.packId === retrievalOpts.reserve?.packId && c.chunk.section === WILDFIRE_NEAR.card));
  };

  let candidates = await search(keywords, routed.packIds, store, backend, retrievalOpts, routed.domains, searched);
  // The best score, not the first chunk's: a reserved field card goes first
  // and may score below the top manual passage (retrieve.ts).
  const best = (cs: readonly ScoredChunk[]): number => cs.reduce((m, c) => Math.max(m, c.score), 0);
  let topScore = best(candidates);


  // Conversation memory: search the follow-up joined to the previous question
  // too, and keep whichever scores higher.
  let followUp: { standaloneTopScore: number; joinedTopScore: number; used: boolean } | undefined;
  // #212: joining the message to the earlier question diluted that question's
  // own match, so the message is about something else.
  let leftTopic = false;
  let standalone = candidates;
  // Memory applies only after a question Fred could answer: a follow-up to a
  // declined question has no topic to build on. With a knot question that
  // itself fell under the gate as the opener, "what's the capital of France?"
  // was turned into a request for the hiker's state.
  if (opts.previous !== undefined && opts.previous.topScore >= effectiveThreshold) {
    // #51: the earlier message's exposure holds for its follow-up: "a fox ...
    // nipped my ankle" then "should i be worried" (phone).
    const joined = opts.understand !== false && opts.guards !== false
      ? withExposures(`${opts.previous.question} ${query}`) : `${opts.previous.question} ${query}`;
    const keywordsJ = extractKeywords(joined);
    const routedJ = route(keywordsJ, packs, {
      state: opts.state,
      ...(opts.allowRoutingFallback === true ? { allowFallback: true } : {}),
    });
    const candidatesJ = await search(keywordsJ, routedJ.packIds, store, backend, retrievalOpts, routedJ.domains, joined);
    const joinedTop = best(candidatesJ);
    // A message with a strong match of its own keeps it: the joined search
    // may win only if it still holds that match. Without this, "find north
    // without a compass?" then "someone is choking" found the navigation
    // passages again (0.439 against the choking card's 0.407), and the model
    // answered a choking question from them (docs/plan-memory.md).
    const aloneTop = candidates.reduce<ScoredChunk | undefined>((b, c) => (b === undefined || c.score > b.score ? c : b), undefined);
    const keepsAlone = topScore < FOLLOW_UP_KEEP || candidatesJ.some((c) => c.chunk.id === aloneTop?.chunk.id);
    // A follow-up stays on the earlier topic: joining it keeps most of the
    // earlier question's own match. An unrelated message dilutes it. On the
    // tuning sets, 17 of 20 follow-ups kept 0.91 or more; the choking switch
    // kept 0.69, and four out-of-scope follow-ups 0.76-0.85.
    const staysOnTopic = joinedTop >= FOLLOW_UP_ON_TOPIC * opts.previous.topScore;
    leftTopic = !staysOnTopic;
    // Memory exists to answer: a joined search that still falls under the gate
    // must not change how Fred declines (into a location request, say, from the
    // joined query's routing). None of the 29 measured follow-ups needed it.
    const answers = joinedTop >= effectiveThreshold;
    // #100: a message the matcher is sure names another card than the one
    // the conversation is on is a new problem, not a follow-up: "and now i
    // sliced my thumb on the can lid" after a wasp sting joined to the sting
    // (0.294 against 0.115 alone) and was answered from the stings card and
    // a fire-ant passage, though the matcher was sure of the cut card (0.85).
    const onCard = opts.lastCard ?? candidatesJ.reduce<ScoredChunk | undefined>((b, c) => (b === undefined || c.score > b.score ? c : b), undefined)?.chunk.section;
    const namesAnother = saidSure !== undefined && saidKind === undefined && onCard !== undefined && saidSure.label !== onCard;
    followUp = {
      standaloneTopScore: topScore, joinedTopScore: joinedTop,
      used: joinedTop > topScore && keepsAlone && staysOnTopic && answers && !namesAnother,
    };
    standalone = candidates;
    if (followUp.used) {
      keywords = keywordsJ;
      routed = routedJ;
      candidates = candidatesJ;
      searchText = joined;
      topScore = joinedTop;
    }
  }
  let earlier = followUp?.used === true && opts.previousInPrompt !== false ? opts.previous!.question : undefined;

  // Routing is a hint, and a weak routed search is not evidence that Fred has
  // nothing: search again across every unscoped pack, and keep that only if it
  // clears the same gate. Routing picks packs by vocabulary, and some words
  // point only at state packs: with California set, "there's a bear in front of
  // me" and "how do I keep bears out of my food" searched the California
  // species pack alone (bear biology, U=0.16) and declined, while the NPS
  // food-storage page scores 0.59. Widening up front instead would reach the
  // manuals on every species question, and ATP 3-50.21's plants chapter once
  // outranked the species reviews for "what plants and animals are near me?".
  let widenedTopScore: number | undefined;
  const widenOn = opts.widenWeakSearch !== false;
  const widen = async (
    kw: readonly Keyword[], r: RouteResult, pool: readonly RoutablePack[], text: string,
  ): Promise<{ routed: RouteResult; candidates: ScoredChunk[]; top: number } | undefined> => {
    const extra = pool.filter((p) => p.scope.kind !== 'us-state' && !r.packIds.includes(p.id));
    if (!widenOn || extra.length === 0) return undefined;
    const packIds = [...r.packIds, ...extra.map((p) => p.id)];
    const domains = [...new Set([...r.domains, ...extra.flatMap((p) => p.domains)])];
    const cs = await search(kw, packIds, store, backend, retrievalOpts, domains, text);
    widenedTopScore = best(cs);
    return { routed: { ...r, packIds, domains, reason: `${r.reason}; widened after a weak routed search` }, candidates: cs, top: widenedTopScore };
  };
  if (topScore < effectiveThreshold) {
    const w = await widen(keywords, routed, packs, searchText);
    if (w !== undefined && w.top >= effectiveThreshold) {
      routed = w.routed;
      candidates = w.candidates;
      topScore = w.top;
    }
  }

  const saidUsed: ('card' | 'no-card' | 'opened' | 'offered' | 'minor')[] = [];
  // #152, round 3 (docs/results-unsure-label.md): an unsure top label is still
  // used where it is measured to be right. The no-card labels together: the
  // matcher is often unsure which kind a message is and right that no card is
  // for it ("i can see a stream below me": other 0.56, all kinds 0.62).
  const saidTopKind = saidTop === undefined ? undefined : noCardKind(saidTop.label);
  const saidNoCard = saidTopKind !== undefined && saidTopKind !== 'fragment' &&
    opts.saidAs?.noCard !== undefined && noCardShare(saidList) >= opts.saidAs.noCard;
  const saidBestCard = saidList.find((x) => noCardKind(x.label) === undefined);
  // A pet on top is a pet whether or not the matcher is sure, when it leads
  // every card clearly: "our lab tore a pad on the lava rock" is pet 0.30
  // against 0.13 for the nearest card. Only where the search has no answer
  // of its own: "can i let my dog off leash on the trail" is pet 0.39 and is
  // answered from the hiking-with-pets pages.
  const saidLeansPet = saidTopKind === 'pet' && topScore < effectiveThreshold && (saidNoCard ||
    (saidTop!.p >= opts.saidAs!.leans && saidTop!.p >= SAID_CLEARLY * (saidBestCard?.p ?? 0)));
  const saidPet = (saidKind === 'pet' || saidLeansPet || (opts.previousWasPet === true && saidOn && pointsBackAtPet(query))) && !personIsHurt(query);
  // And the other way: the matcher sure of a card for people, in a message
  // about the speaker, is a person hurt with a pet nearby: "i tripped over
  // the dog leash and my ankle rolled" was declined as a pet question.
  const saidPerson = saidSure !== undefined && saidKind === undefined && namesSpeaker(query);
  const aboutPet = (ABOUT_A_PET.test(query) && !saidPerson) || saidPet;
  const medicine = MEDICINE_OR_PROCEDURE.test(query) || saidKind === 'medicine';

  // Experiment (scope.ts): does the message need an answer, by a scorer
  // trained for that question rather than by how well it matches a passage.
  // Never for a medicine or a procedure: those are declined on purpose.
  const scopeZ = opts.scope === undefined ? undefined : scopeScore(opts.scope, await queryVector(backend, query));
  const inScope = scopeZ !== undefined && scopeZ >= opts.scope!.threshold && !medicine && !BEYOND_FIRST_AID.test(query);
  const scopeUsed: ('framed' | 'not-chat' | 'card' | 'gate' | 'hazard')[] = [];

  let secondSearch: { rewrite: string; topScore: number } | undefined;
  // Deep thinking's "search harder" (#21): the phase-3 second search admitted
  // out-of-scope questions (results-phase3.md step 4), so it runs here only
  // for a message the scope scorer calls in scope, and never for a medicine
  // or a procedure.
  // Smoke test 2026-11-15: the scope scorer alone shut out "what can I do
  // with paracord if I take it apart?" (-0.63), whose answer is in the Army
  // manual. A card as the matcher's top label is let through too.
  // Dev run 2026-11-15: also letting in a message whose top matcher label is
  // a card admitted a belay knot, "where am I right now?" and magnetic
  // declination (scope -0.22, -1.71, -1.09), the phase-3 failure again. Back
  // to the scope scorer alone; paracord (-0.63) stays out.
  const deepSearch = opts.deep?.search === true && inScope && !medicine && !aboutPet;
  if ((opts.secondSearch === true || deepSearch) && topScore < effectiveThreshold) {
    let rewrite = '';
    for await (const tok of backend.generate(buildRewriteParts(query), { maxTokens: 80, temperature: 0 })) rewrite += tok;
    // Markdown headings and bold came back in the smoke test ("**TREATING INJURIES...**").
    rewrite = rewrite.replace(/[*#_`]+/g, ' ').replace(/\s+/g, ' ').trim();
    const keywords2 = extractKeywords(`${query} ${rewrite}`);
    const routed2 = route(keywords2, packs, { state: opts.state, ...(opts.allowRoutingFallback === true ? { allowFallback: true } : {}) });
    const candidates2 = await search(keywords2, routed2.packIds, store, backend, retrievalOpts, routed2.domains, rewrite);
    secondSearch = { rewrite, topScore: best(candidates2) };
    // Only adopted if it clears the same gate. The rewrite is searched with,
    // never answered from: the prompt below still carries the hiker's question
    // and the manual's passages.
    if (secondSearch.topScore >= effectiveThreshold) {
      keywords = keywords2;
      routed = routed2;
      candidates = candidates2;
      searchText = rewrite;
      topScore = secondSearch.topScore;
    }
  }

  // Intent: what the hiker wants, beside what they are talking about.
  let intent: Intent | undefined;
  let forcedCard: ScoredChunk | undefined;
  // #152: the forced card is the one that led this message's own search.
  let forcedOwn = false;
  // #100: a bare "what now" kept on the card just shown.
  let keptShown = false;
  let offer: CardOffer | undefined;
  const reserve = retrievalOpts.reserve;
  const isCard = (c: ScoredChunk): boolean => reserve !== undefined && c.chunk.packId === reserve.packId && c.chunk.audience !== 'provider';
  // #121: with guards on, passages that say the same thing as a
  // card back it instead of outranking it.
  // #115: the message's own best score, leaving out passages that say the
  // same thing as the conversation's card. "its getting dark" in a lost chat
  // lost the lost card once a Forest Service passage on getting lost ("STOP
  // where you are") scored above AGREED_CARD_FLOOR.
  const ownTopAgainst = async (card: ScoredChunk | undefined): Promise<number> => {
    const top = candidates.reduce((m, c) => Math.max(m, c.score), 0);
    if (card === undefined || candidates.length === 0) return top;
    const others = candidates.filter((c) => c.chunk.id !== card.chunk.id);
    const vecs = await store.getVectors([card, ...others].map((c) => ({ chunkId: c.chunk.id, packId: c.chunk.packId, ordinal: c.chunk.ordinal })));
    const v = dequantizeInt8(vecs[0]!.vec, vecs[0]!.scale);
    return others.reduce((m, c, j) => (cosineInt8(v, vecs[j + 1]!.vec) >= SAME_THING ? m : Math.max(m, c.score)), 0);
  };
  const supportOf = async (cs: readonly ScoredChunk[]): Promise<CardSupport | undefined> =>
    (opts.understand !== false && opts.guards !== false ? cardSupport(cs, isCard, store) : undefined);
  // #126: the one or two sentences of these passages that are closest to the
  // question, verbatim, when one clears `floor`.
  const quoteFrom = async (chunks: readonly ChunkRecord[], floor: number): Promise<{ text: string; similarity: number; chunkIds: string[] } | undefined> => {
    const passages = chunks.map((c) => ({ chunkId: c.id, text: c.text, rows: store.sentenceVectorsFor?.(c.id) }));
    if (!passages.some((p) => p.rows !== undefined)) return undefined;
    const ranked = rankSentences(await queryVector(backend, query), passages);
    const best = ranked[0];
    if (best === undefined || best.similarity < floor) return undefined;
    // The same sentence often sits on two pages ("pick them up if possible so
    // they don't panic and run", three mountain-lion pages): quote it once.
    const norm = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const picked: { text: string; chunkId: string }[] = [];
    for (const r of ranked) {
      if (r.similarity < Math.max(floor, best.similarity - QUOTE_BAND) || picked.length === 2) break;
      if (picked.some((p) => norm(p.text).includes(norm(r.text)) || norm(r.text).includes(norm(p.text)))) continue;
      picked.push({ text: r.text, chunkId: r.chunkId });
    }
    // Introduced by who said it (#135).
    const sources = picked.map((p) => chunks.find((c) => c.id === p.chunkId)?.source ?? '');
    return { text: `${quoteIntro(sources)}\n${picked.map((p) => p.text).join('\n')}`, similarity: best.similarity, chunkIds: picked.map((p) => p.chunkId) };
  };
  // Only the earlier messages this one continues (understand.ts, currentThread).
  const history = currentThread(query, opts.history ?? []);
  const understandOn = opts.understand !== false;
  const guardsOn = understandOn && opts.guards !== false;
  // What has happened in the conversation: every earlier message the app
  // passed, not just this topic's thread. A snakebite two messages ago is
  // still a snakebite (conditions.ts).
  // #101: the record keeps who each condition belongs to and whether it is
  // over (record.ts); only open conditions about this message's person count.
  const record = buildRecord(guardsOn ? [...(opts.history ?? []), query] : []);
  const here = opts.history?.length ?? 0;
  const active: readonly Condition[] = guardsOn ? conditionsFor(record, query) : [];
  /**
   * A wildfire near (conditions.ts, WILDFIRE_NEAR) rules cards out like a
   * condition does, without joining the record: "there's a fire on the
   * hillside above our camp" got the campfire card (#100).
   */
  const fireNear = guardsOn && WILDFIRE_NEAR.said([...history, query]);
  const blockers: readonly Condition[] = !guardsOn ? active : fireNear ? [...active, WILDFIRE_NEAR] : fireCardOk ? active : [...active, NO_FIRE];
  /** What a situation (a wildfire near, or no fire in view) rules out, beyond the conditions. */
  const situations = blockers.slice(active.length);
  /** Conditions this message itself sets (with the setting said earlier, for altitude and heat). */
  const setHere: readonly Condition[] = record.conditions.filter((r) => r.at === here && !r.resolved).map((r) => r.condition);
  /**
   * A card that belongs to a condition in the record that does not bear on
   * this message (someone else's, or over) is not carried over to it: "my
   * wife just cut her finger opening a can" after the hiker's own burn got
   * the burns card through the conversation (sealed long set, #101).
   */
  const ownCard = (c: ScoredChunk | undefined): ScoredChunk | undefined =>
    c !== undefined && record.conditions.some((r) => r.condition.card === c.chunk.section) &&
    !active.some((a) => a.card === c.chunk.section) ? undefined : c;
  const lastShown = ownCard(guardsOn && opts.lastCard !== undefined ? await cardByTitle(opts.lastCard) : undefined);
  // A condition that explains this message's symptom (altitude, heat, low
  // blood sugar): its card leads over a card that only shares the words.
  // A danger sign in the thread, unless the hiker has since said it is over (#173).
  const dangerNow = guardsOn ? dangerStands([...history, query], active) : dangerSign([...history, query]);
  const explaining = setHere.find((c) => c.explains === true);
  const explainCard = explaining === undefined ? undefined : await cardByTitle(explaining.card);
  let understood: UnderstoodDiag | undefined;
  let u: Understood | undefined;
  // The request's search's leading card, for the agreement rule below.
  let requestCard: ScoredChunk | undefined;
  /** The restated request's best passage, searched on its own. */
  let requestTop: ScoredChunk | undefined;
  let agreedCard: ScoredChunk | undefined;
  // The leading card of the hiker's own thread, searched as one text.
  let threadCard: ScoredChunk | undefined;
  // Small talk read as news about an open problem (below); ask() turns a decline back into small talk.
  let newsNotChat = false;
  let everyday: { routedTopScore: number; topScore: number } | undefined;
  // #173: news that help has taken over, with nothing new in it and nothing
  // asked, is small talk too: "ok the rangers carried him out" after a
  // snakebite was called NOW and got the get-help-now reply. Not "ok
  // paramedics have him. unrelated but i sliced my finger whittling".
  const helpHasThem = onlyHandedOver(query) && setHere.length === 0 && !asksSomething(query) && !dangerSign([query]);
  // Nothing but thanks or an acknowledgement is small talk, without asking the
  // model: "ok thanks" after a burn is three words, so it was read in its
  // conversation, restated as "bubbles on skin, what to do", called NOW, and
  // answered (20 s on the phone).
  const onlyThanks = guardsOn && opts.intent === true && (ONLY_ACKNOWLEDGES.test(query) || helpHasThem);
  if (onlyThanks) intent = 'chat';
  if (opts.intent === true && !onlyThanks) {
    // A weak search that follows earlier messages is read in its conversation.
    // The understanding call also gives the intent, so it replaces the intent
    // check rather than adding to it.
    if (understandOn && topScore < effectiveThreshold && history.length > 0) {
      u = await understandMessage(query, history, backend, opts.signal);
    }
    if (u !== undefined && u.intent === undefined) u = { ...u, intent: await classifyIntent(u.request, backend, opts.signal) };
    intent = u === undefined ? await classifyIntent(query, backend, opts.signal)
      : u.intent === 'out' ? 'question' : u.intent;
    // A message that asks something is never small talk, whatever the model
    // says. Round 1's understanding step called "how much water" and "should
    // i follow it down" CHAT, and Fred answered "Got it" (phone, 2026-09-30).
    // A danger sign does not overrule CHAT: "he was bleeding badly yesterday
    // but he's fine now" is small talk.
    // A follow-up that says something is missing asks for another way, whatever
    // the model calls it: "how do i set up a tent" / "there's no manual" was
    // restated as "missing tent manual, how to set up a tent" and still called
    // CHAT, and Fred said "Got it" (Ryan, phone, 2026-10-04). Only then: the
    // restatement adds "what to do next" to plain news ("ok we made it back"),
    // which is small talk.
    const lacks = u !== undefined && SAYS_MISSING.test(query) && asksSomething(u.request);
    if (guardsOn && intent === 'chat' && (asksSomething(query) || lacks)) {
      intent = 'question';
      if (u !== undefined && u.intent === 'chat') u = { ...u, intent };
    }
    // News about a problem still open in the conversation is not small talk:
    // "a few bubbles came up on the skin" after a burn, "my kid already tried
    // one" after berries, "yep its a bear" got "Got it" (sealed chat sets).
    // Unless the hiker says it is over ("he's fine now") or is only
    // acknowledging ("ok it's off", "ok made camp", "thanks"). If nothing then
    // answers it, ask() falls back to small talk (newsNotChat): in a lost-hiker
    // chat "i can hear a river" went from "Got it" to a decline.
    const openProblem = active.length > 0 || eatingUnknownInThread(query, opts.history ?? []) ||
      dangerNow;
    if (guardsOn && intent === 'chat' && (opts.history?.length ?? 0) > 0 && openProblem &&
        !saysResolved(query) && !ACKNOWLEDGES.test(query)) {
      newsNotChat = true;
      intent = dangerNow ? 'now' : 'question';
      if (u !== undefined && u.intent === 'chat') u = { ...u, intent };
    }
    // A message that says something happened to someone (a condition,
    // conditions.ts) is not small talk either: "my son brushed his arm on the
    // camp stove grate" was CHAT and got "Got it" (confirmation chat set).
    if (guardsOn && intent === 'chat' && setHere.length > 0 && !saysResolved(query) && !petIsPatient(query)) {
      intent = 'now';
      if (u !== undefined && u.intent === 'chat') u = { ...u, intent };
    }
    // #200: a minor problem is not an emergency. When the card matcher's top
    // label says no card is for it because it is minor, with no danger sign
    // and no condition in the conversation, NOW is read as a question: "my
    // feet are covered in hot spots" was searched in first aid only, reworded
    // as "what to do right now", and opened the trench-foot card; "new boots
    // chewed up my heels" got the watch reply. The blister tips were never
    // searched. On the cards' own chats the matcher's top label was the card
    // every time (trench foot, frostbite and burn blisters, a cut foot).
    // Not after any condition still open in the conversation, whoever it is
    // about: "it's blistering" after "my kid just burned her hand" lost the
    // burns card.
    if (guardsOn && intent === 'now' && saidTop?.label === 'none:minor' && saidTop.p >= MINOR_CLEARLY && !dangerNow &&
        !record.conditions.some((r) => !r.resolved)) {
      intent = 'question';
      saidUsed.push('minor');
      if (u !== undefined && u.intent === 'now') u = { ...u, intent };
    }
    // An emergency is answered from first aid, never from everyday tips (#96,
    // docs/plan-tips.md): "stepped in a hole and my ankle is huge" must not be
    // answered from a passage on choosing boots. The search is run again as if
    // the tips packs were not installed, rather than filtering what came back:
    // "tick dug into my armpit" routed to the tips alone ("tick" is a tips
    // word too), filtering left nothing, and the tick card was lost.
    if (intent === 'now' && routed.packIds.some((id) => tipsPackIds.has(id))) {
      const noTips = packs.filter((p) => !tipsPackIds.has(p.id));
      routed = route(keywords, noTips, { state: opts.state, ...(opts.allowRoutingFallback === true ? { allowFallback: true } : {}) });
      effectiveThreshold = routed.fallback ? (opts.fallbackThreshold ?? DEFAULT_FALLBACK_THRESHOLD) : threshold;
      candidates = await search(keywords, routed.packIds, store, backend, retrievalOpts, routed.domains, searchText);
      topScore = best(candidates);
      if (topScore < effectiveThreshold) {
        const w = await widen(keywords, routed, noTips, searchText);
        if (w !== undefined && w.top >= effectiveThreshold) {
          routed = w.routed;
          candidates = w.candidates;
          topScore = w.top;
        }
      }
    }
    // #145: a question that is no emergency is searched in the everyday-tips
    // packs too when routing left them out, and that search is kept when a tip
    // leads it clearly (EVERYDAY_MARGIN). Routing picks packs by vocabulary,
    // and a routed search that just clears the gate is never widened.
    const tipsLeftOut = [...tipsPackIds].filter((id) => !routed.packIds.includes(id));
    if (guardsOn && (intent === 'question' || intent === 'prevent') && tipsLeftOut.length > 0 && u === undefined) {
      const packIds = [...routed.packIds, ...tipsLeftOut];
      const domains: DomainTag[] = [...new Set<DomainTag>([...routed.domains, 'outdoor-skills'])];
      const cs = await search(keywords, packIds, store, backend, retrievalOpts, domains, searchText);
      const lead = cs.reduce<ScoredChunk | undefined>((b, c) => (b === undefined || c.score > b.score ? c : b), undefined);
      if (lead !== undefined && tipsPackIds.has(lead.chunk.packId) && lead.score >= effectiveThreshold && lead.score >= topScore + EVERYDAY_MARGIN) {
        everyday = { routedTopScore: topScore, topScore: lead.score };
        routed = { ...routed, packIds, domains, reason: `${routed.reason}; everyday tips searched too` };
        candidates = cs;
        topScore = lead.score;
      }
    }
    // An emergency that found nothing, and no card to fall back on, is read
    // again in plain words: "uhh dude there's a bear in front of me".
    const noTipsPool = (): readonly RoutablePack[] => packs.filter((p) => !tipsPackIds.has(p.id));
    if (understandOn && u === undefined && intent === 'now' && topScore < effectiveThreshold &&
        leadingCard(candidates, isCard, await supportOf(candidates)) === undefined && !aboutPet) {
      u = await understandMessage(query, history, backend, opts.signal);
      if (u !== undefined && u.intent === undefined) u = { ...u, intent: await classifyIntent(u.request, backend, opts.signal) };
      if (u?.intent === 'out') intent = 'question';
    }
    if (u !== undefined && u.intent !== 'out' && u.intent !== 'chat') {
      // Search the request. An emergency keeps to first aid, as above.
      const pool = intent === 'now' ? noTipsPool() : packs;
      const kwR = extractKeywords(u.request);
      let routedR = route(kwR, pool, { state: opts.state, ...(opts.allowRoutingFallback === true ? { allowFallback: true } : {}) });
      let candR = await search(kwR, routedR.packIds, store, backend, retrievalOpts, routedR.domains, u.request);
      if (best(candR) < effectiveThreshold) {
        const w = await widen(kwR, routedR, pool, u.request);
        if (w !== undefined && w.top > best(candR)) { routedR = w.routed; candR = w.candidates; }
      }
      const topR = candR.reduce<ScoredChunk | undefined>((b, c) => (b === undefined || c.score > b.score ? c : b), undefined);
      // The request's result must clear the normal gate. An emergency's
      // below-gate card rule (INTENT_CARD_FLOOR) was measured on the hiker's
      // own words; stacked on the model's restatement it opened the shock card,
      // which says to move them into shade, for "my friend fell off a ledge /
      // he's not moving" (0.270, sealed set, graded unsafe).
      const clears = topR !== undefined && topR.score >= effectiveThreshold;
      // What the request found must also match what the hiker actually said.
      // The request is the model's words; phase 3 showed the model makes any
      // question sound like a manual. Search the hiker's own messages over
      // every pack the request could reach, and look for the same passage.
      let ownScore: number | undefined;
      let ownRank: number | undefined;
      // With guards on, the hiker's own thread is searched whenever there is
      // one: its leading card is used below when the message has nothing of
      // its own ("what do i do").
      if (clears || (guardsOn && history.length > 0)) {
        const own = [...history.slice(-UNDERSTAND_HISTORY), query].join(' ');
        const kwO = extractKeywords(own);
        const ids = [...new Set([...routedR.packIds, ...pool.filter((p) => p.scope.kind !== 'us-state').map((p) => p.id)])];
        const domains = [...new Set([...routedR.domains, ...pool.filter((p) => ids.includes(p.id)).flatMap((p) => p.domains)])];
        const candO = await search(kwO, ids, store, backend, { ...retrievalOpts, topK: UNDERSTOOD_OWN_TOPK }, domains, own);
        const ranked = [...candO].sort((a, b) => b.score - a.score);
        const at = topR === undefined ? -1 : ranked.findIndex((c) => c.chunk.id === topR.chunk.id);
        if (at >= 0) { ownScore = ranked[at]!.score; ownRank = at; }
        threadCard = leadingCard(candO, isCard, await supportOf(candO)) ?? clearlyLeadingCard(candO, isCard);
      }
      // Kept when it clears the own-words floor or, with guards on, ranks
      // near the top for the hiker's own words.
      const used = clears && ownScore !== undefined && (
        ownScore >= (opts.understandOwnFloor ?? UNDERSTOOD_OWN_FLOOR) ||
        (guardsOn && ownRank !== undefined && ownRank < (opts.understandOwnTop ?? UNDERSTOOD_OWN_TOP)));
      requestCard = leadingCard(candR, isCard, await supportOf(candR));
      requestTop = topR;
      understood = { intent: u.intent, request: u.request, ...(topR === undefined ? {} : { topScore: topR.score }), ...(ownScore === undefined ? {} : { ownScore }), ...(ownRank === undefined ? {} : { ownRank }), used };
      if (used) {
        keywords = kwR;
        routed = routedR;
        candidates = candR;
        topScore = best(candR);
        searchText = u.request;
        // The model that answers sees the hiker's own messages, never the request.
        earlier = history.slice(-UNDERSTAND_HISTORY).join(' / ');
      }
    } else if (u !== undefined) {
      understood = { intent: u.intent, request: u.request, used: false };
    }
    // The leading card: the best field card, if it is first or within
    // INTENT_CARD_NEAR_TOP of the first. "His leg is bleeding a lot, help"
    // ranked a manual passage first (0.289) and the bleeding card second
    // (0.256); for an emergency the card is the safer answer.
    const topCard = leadingCard(candidates, isCard, await supportOf(candidates));
    // Only an emergency forces a card open under the gate. Forcing it for any
    // question too opened the cuts card for "talk me through stitching a cut
    // closed" on the tuning set. And a pet is never the patient: veterinary
    // care is out of scope, and "my dog cut his paw" opened the human card.
    if (guardsOn && explainCard !== undefined && intent !== 'prevent' && !aboutPet) forcedCard = agreedCard = explainCard;
    // #100: "what now" right after a card has nothing of its own, so it is
    // about that card, whatever its thread's words lead the search with: after
    // the anaphylaxis card the stings card led, and the model wrote from both.
    else if (guardsOn && lastShown !== undefined && BARE_ASK.test(query) && setHere.length === 0 && !aboutPet) { forcedCard = agreedCard = lastShown; keptShown = true; }
    // #112: a follow-up that points back at the card just shown, says nothing
    // new, and still finds that card near the top stays on it, rather than
    // the card that leads by a few shared words: "can i rub them" after the
    // frostbite card for white, waxy toes led with trench foot (0.296 against
    // 0.273). Not when the leading card is the one for the condition the
    // hiker described: "my toes went white and numb" opened trench foot, and
    // "should i rub them with snow" then found frostbite again.
    else if (guardsOn && lastShown !== undefined && topCard !== undefined && topCard.chunk.id !== lastShown.chunk.id &&
        setHere.length === 0 && !aboutPet && leansBack(query) && !active.some((a) => a.card === topCard.chunk.section) &&
        candidates.some((c) => c.chunk.id === lastShown.chunk.id && c.score >= INTENT_CARD_NEAR_TOP * topCard.score)) {
      forcedCard = agreedCard = lastShown;
      keptShown = true;
    }
    // #112: the message says what happened, and the condition's trigger
    // phrases and the card matcher agree on its card: that card opens, not
    // one that leads the search by a few shared words. "my toes went white
    // and numb" (frostbite, matcher 0.91) led with trench foot, 0.379 to 0.310.
    else if (guardsOn && topCard !== undefined && saidSure !== undefined && saidKind === undefined && !aboutPet &&
        topCard.chunk.section !== saidSure.label && setHere.some((c) => c.card === saidSure.label) &&
        candidates.some((c) => isCard(c) && c.chunk.section === saidSure.label)) {
      forcedCard = agreedCard = candidates.find((c) => isCard(c) && c.chunk.section === saidSure.label)!;
      forcedOwn = true;
    }
    // #100: a follow-up that only points back ("how do i pull it out") is
    // about its conversation, so a card its bare words find under the gate
    // opens only when the restated request leads with the same card. After
    // "can i touch a cholla cactus" / "dang its stuck in my hand now", the
    // bare words found the tick card (0.197) and the request "cholla cactus
    // stuck in hand, how to remove it" found nothing (0.073): Fred showed
    // the tick card, rash and all. Nothing is offered either.
    else if (guardsOn && topCard !== undefined && intent === 'now' && understood?.used === false && lastShown === undefined &&
        setHere.length === 0 && leansBack(query) && topCard.score < effectiveThreshold && requestCard?.chunk.id !== topCard.chunk.id) {
      understood = { ...understood, cardLeftClosed: topCard.chunk.section };
    }
    else if (topCard !== undefined && intent === 'now' && !aboutPet) { forcedCard = topCard; forcedOwn = true; }
    // #101: a message that says what happened opens that condition's card when
    // it leads, even read as a question: "i think im lost" led with the lost
    // card at 0.252 and only offered it, folded under "I don't have reliable
    // information on that".
    else if (guardsOn && topCard !== undefined && setHere.some((c) => c.card === topCard.chunk.section) && !aboutPet) { forcedCard = agreedCard = topCard; forcedOwn = true; }
    // Round 2: two searches agreeing beat one score. An emergency whose card
    // leads the hiker's own search, but under the card floor, opens it when
    // the understanding step's request, searched on its own, puts the same
    // card first. "ok it left. my kid just burned her hand on the stove": the
    // burns card led at 0.139, under 0.15, and the request found it too
    // (phone, 2026-09-30); Fred showed the safety net.
    else if (guardsOn && topCard === undefined && intent === 'now' && !aboutPet) {
      const own = candidates.filter(isCard).reduce<ScoredChunk | undefined>((b, c) => (b === undefined || c.score > b.score ? c : b), undefined);
      if (own !== undefined && own.score >= AGREED_CARD_FLOOR && requestCard !== undefined &&
          requestCard.score >= AGREED_REQUEST_FLOOR && own.chunk.id === requestCard.chunk.id && ownCard(own) !== undefined) {
        forcedCard = agreedCard = own;
        forcedOwn = true;
      } else if ((lastShown !== undefined || threadCard !== undefined) && await ownTopAgainst(lastShown ?? threadCard) < AGREED_CARD_FLOOR && !medicine &&
          (query.trim().split(/\s+/).length <= THREAD_CARD_WORDS || (asksSomething(query) && !leftTopic))) {
        // A message with nothing of its own ("what do i do") takes the card
        // its thread leads with, searched in the hiker's own words: "i think
        // im lost" / "phone at 15%" / "its getting dark" / "what do i do".
        // The model's request for it ("lost and dark, phone dead") reached
        // the lost card at only 0.119 (phone chats, 2026-09-30).
        // #101: the card just shown comes first. "what do i do" right after the
        // anaphylaxis card took the stings card its thread's words led with
        // (phone, 2026-09-30).
        forcedCard = agreedCard = lastShown ?? ownCard(threadCard);
      } else {
        // An emergency whose message itself says what happened opens that
        // condition's card when nothing else leads: "my fingertips went hard
        // and waxy on the summit push" found the frostbite card at 0.092
        // (confirmation chat set). The trigger phrases are reviewed; the
        // model has no part in it.
        const said = setHere[0];
        const card = said === undefined ? undefined : await cardByTitle(said.card);
        // #152: the trigger phrases are a guess too, so the matcher checks the
        // card (forcedOwn): "the pot of soup slid off the stove into my lap"
        // read as a fall and opened the neck-and-back card.
        if (card !== undefined) { forcedCard = agreedCard = card; forcedOwn = true; }
      }
    }
    // A short question with nothing of its own takes its thread's card too:
    // "we lost the trail a while ago" / "sun is setting" / "what now" was read
    // as a question and declined (confirmation chat set).
    else if (guardsOn && topCard === undefined && intent === 'question' && !aboutPet) {
      const said = setHere[0];
      if ((lastShown !== undefined || threadCard !== undefined) && await ownTopAgainst(lastShown ?? threadCard) < AGREED_CARD_FLOOR && !medicine &&
          (query.trim().split(/\s+/).length <= THREAD_CARD_WORDS || (asksSomething(query) && !leftTopic))) {
        forcedCard = agreedCard = lastShown ?? ownCard(threadCard);
      } else if (said !== undefined && topScore < effectiveThreshold) {
        // "splashed hot coffee all over my wrist" was read as a question and
        // declined; the message says what happened, and that card answers it.
        const card = await cardByTitle(said.card);
        if (card !== undefined) { forcedCard = agreedCard = card; forcedOwn = true; }
      }
    }
    // Otherwise the card is offered, folded, wherever Fred would say nothing
    // useful: beside small talk, and beside a decline. On the breadth set
    // (docs/results-breadth.md) the right card led the search for "I just
    // grabbed a hot pot handle and my palm is blistering" and "everything is
    // wet, how do I get a fire going", both under the gate, and Fred said
    // only "I don't have reliable information". Across all three sets every
    // card this offers beside a decline was the right one or, for questions
    // Fred must decline ("walk me through stitching a cut"), a safe
    // alternative (the cuts card: clean it and cover it). Only an answer
    // leaves it out; a pet still never gets a human card.
    // #152: nor when the matcher says the message is a small ailment no card
    // is for: "feet are throbbing after 15 miles today" was declined with the
    // trench-foot card folded under it, "calves are tight and sore after all
    // that climbing" with the sprain card. Only the minor label: a question
    // Fred must decline still gets its safe alternative (the cuts card).
    else if (topCard !== undefined && !aboutPet && !(guardsOn && saidNoCard && saidTopKind === 'minor')) offer = toOffer(topCard, citeOf(topCard, 0));
    // A prevention question takes the normal path, cards included: several
    // cards are prevention guidance ("staying warm on a cold night", "staying
    // healthy", "river crossing"), and hiding them cost three tuning answers.
    // The price is that "how do I avoid snakebite?" can still get the
    // treatment card (docs/results-intent-probe.md).
  }

  // Round 2: whether something unnamed is safe to eat is answered by the
  // wild-plants card, never from a species page (triage.ts).
  if (guardsOn && forcedCard === undefined && ((intent !== 'now' && asksToEatUnknown(query)) || eatingUnknownInThread(query, opts.history ?? []))) {
    forcedCard = await cardByTitle('Eating wild plants and berries');
  }
  // Round 2: a pet that is hurt or sick is outside Fred's scope, and the
  // human cards are wrong for it (triage.ts).
  const petPatient = guardsOn && ((petIsPatient(query, opts.history?.at(-1)) && !saidPerson) || saidPet);

  // A card must never be shown, open or folded, after a condition it is not
  // for (conditions.ts). A folded offer becomes the condition's own card.
  let blocked: { card: string; condition: string } | undefined;
  let repeatHeld: string | undefined;
  if (offer !== undefined) {
    const by = blockingCondition(offer.title, blockers);
    const instead = by === undefined ? undefined : await cardByTitle(by.card);
    if (by !== undefined) {
      blocked = { card: offer.title, condition: by.id };
      offer = instead === undefined ? undefined : toOffer(instead, citeOf(instead, 0));
    }
  }

  // Experiment (scope.ts): the model's CHAT is overruled when the scorer
  // says the message needs an answer, after every rule above has had its
  // say: "rolled my ankle on a rock" got "Got it" with the sprain card
  // folded. The folded card is opened; with none, the message goes on as a
  // question, and if nothing then answers it ask() falls back to small talk.
  // Not when the hiker says it is over or is only acknowledging.
  if (inScope && intent === 'chat' && !saysResolved(query) && !ACKNOWLEDGES.test(query) && !petPatient) {
    intent = dangerNow ? 'now' : 'question';
    newsNotChat = true;
    scopeUsed.push('not-chat');
    // A remark about unnamed berries or mushrooms gets the wild-plants card,
    // never a species page: "these little red berries look tasty" was answered
    // "these little red berries are edible" from the red huckleberry page
    // (sealed chat set).
    const card = /\b(?:berr(?:y|ies)|mushrooms?|fungus|fungi)\b/i.test(query) ? await cardByTitle('Eating wild plants and berries')
      : offer === undefined ? undefined : await cardByTitle(offer.title);
    if (card !== undefined && forcedCard === undefined) { forcedCard = agreedCard = card; forcedOwn = card.chunk.section === offer?.title; }
  }

  const baseDiag = {
    ...(intent === undefined ? {} : { intent }),
    ...(newsNotChat ? { newsNotChat } : {}),
    ...(scopeZ === undefined ? {} : { scope: { z: scopeZ, used: scopeUsed } }),
    ...(saidTop === undefined ? {} : { said: { label: saidTop.label, p: saidTop.p, pet: saidPet, used: saidUsed } }),
    ...(everyday === undefined ? {} : { everyday }),
    keywords,
    route: routed,
    maxTokens,
    memoryPressure: pressure,
    ...(widenedTopScore === undefined ? {} : { widenedTopScore }),
    ...(understood === undefined ? {} : { understood }),
    ...(active.length === 0 ? {} : { conditions: active.map((c) => c.id) }),
    ...(agreedCard === undefined ? {} : { agreedCard: agreedCard.chunk.section }),
    ...(blocked === undefined ? {} : { blocked }),
    timing: { ...spent, totalMs: Date.now() - startedAt },
    ...(secondSearch === undefined ? {} : { secondSearch }),
    ...(followUp === undefined ? {} : { followUp }),
  };

  if (petPatient) {
    return { kind: 'abstain', reason: 'out-of-scope', nearest: [], diagnostics: { ...baseDiag, candidates, topScore, tokensBefore: 0, tokensAfter: 0, contextReduction: 0 } };
  }

  // #101: a message that reports a symptom is not small talk when a card
  // leads its search: "i'm shivering a bit" got "Got it" with the hypothermia
  // card folded, "it's getting cold fast" (lost overnight) the shelter card.
  if (intent === 'chat' && guardsOn && offer !== undefined && SYMPTOM_REPORT.test(query) && !saysResolved(query) && !petPatient) {
    const card = await cardByTitle(offer.title);
    if (card !== undefined) { forcedCard = agreedCard = card; forcedOwn = true; intent = 'question'; }
  }

  // #152: small talk the matcher leans to a card for gets that card folded
  // under the reply, when nothing else is offered: "we missed the junction a
  // while back" was "Got it" and nothing more, with the lost card at 0.49.
  // Folded, not opened: a leaning label is right about four times in five.
  if (intent === 'chat' && offer === undefined && saidTop !== undefined && saidTopKind === undefined &&
      saidTop.p >= opts.saidAs!.leans && saidTop.p >= SAID_CLEARLY * (saidList.find((x) => x !== saidTop && noCardKind(x.label) === undefined)?.p ?? 0) &&
      !saysResolved(query) && !ACKNOWLEDGES.test(query)) {
    const card = ownCard(await cardByTitle(saidTop.label));
    if (card !== undefined && blockingCondition(card.chunk.section, blockers) === undefined) { offer = toOffer(card, citeOf(card, 0)); saidUsed.push('offered'); }
  }

  if (intent === 'chat') {
    return {
      kind: 'chat', reply: offer === undefined ? CHAT_REPLY : CHAT_REPLY_WITH_OFFER, offer: offer ?? null,
      diagnostics: { ...baseDiag, candidates, topScore, tokensBefore: 0, tokensAfter: 0, contextReduction: 0 },
    };
  }

  // #152: a card opened under the gate because it led the message's own search
  // must be one the message supports (said-as.ts).
  /**
   * The card itself; the card the matcher is sure of, or leans to when the
   * message gives this one no share; or none, when the message is about
   * something no card is for.
   */
  const supportedCard = async (card: ScoredChunk): Promise<ScoredChunk | undefined> => {
    if (saidTop === undefined || saidTop.label === card.chunk.section) return card;
    const share = saidList.find((x) => x.label === card.chunk.section)?.p ?? 0;
    const toKind = noCardKind(saidTop.label);
    // Another card, sure or leaning: "we need to drink from this stream" led
    // with the river-crossing card and leaned to the water card at 0.66.
    // Leaning is not enough against a card with a real share of its own:
    // "he's not moving and I can't tell if he's breathing at all" leaned to
    // the CPR card at 0.52 over the unresponsive card, whose first step is to
    // check the breathing.
    if (toKind === undefined && (saidSure !== undefined || (saidTop.p >= opts.saidAs!.leans && saidTop.p >= SAID_CLEARLY * share))) {
      const other = ownCard(await cardByTitle(saidTop.label));
      if (other !== undefined && blockingCondition(other.chunk.section, blockers) === undefined) { saidUsed.push('card'); return other; }
      return card;
    }
    // Sure it is something else, or the card has no share: no card. A message
    // with nothing of its own ("how long should i keep it under the water")
    // says nothing against the card, and with a danger sign in the thread an
    // unsure matcher takes no card away ("the shirt i'm holding on it is soaked
    // through" lost the bleeding card). A follow-up fragment, however sure,
    // takes none away either: "is it safer to keep going or stop" after
    // "the light is fading" lost the lost-hiker card (#152).
    if (saidSure !== undefined ? (toKind !== undefined && toKind !== 'fragment') : ((share < SAID_SOME || saidNoCard) && toKind !== 'fragment' && !dangerNow)) { saidUsed.push('no-card'); return undefined; }
    return card;
  };
  if (forcedCard !== undefined && forcedOwn && forcedCard.score < effectiveThreshold) {
    forcedCard = await supportedCard(forcedCard);
    agreedCard = forcedCard === undefined ? undefined : agreedCard === undefined ? undefined : forcedCard;
    if (saidUsed.includes('card')) agreedCard = forcedCard;
  }

  // A follow-up about a condition already in the conversation that would
  // otherwise be declined gets the condition's card: "should i prop my leg up
  // on my pack" after a snakebite, "should i massage her legs hard" for a
  // cold child (confirmation chat set). The card is the reviewed answer for
  // what is going on; a decline is a dead end in the middle of it.
  const followed = guardsOn && !petPatient && u?.intent !== 'out' ? await conditionCardFor(query) : undefined;
  if (forcedCard === undefined && followed !== undefined && (candidates.length === 0 || topScore < effectiveThreshold)) {
    forcedCard = agreedCard = followed;
  }
  // #24: a question that asks for a dose, or which medicine to take, is
  // declined on purpose, with its own wording (voice.ts). It was declined
  // only when the search happened to be weak. With a danger sign in the
  // thread a card may still answer; the model never writes it (below).
  const dose = guardsOn && asksDose(query);
  if (dose && !dangerNow) {
    return { kind: 'abstain', reason: 'low-score', nearest: [], diagnostics: { ...baseDiag, candidates, topScore, tokensBefore: 0, tokensAfter: 0, contextReduction: 0 } };
  }
  // #101: an update on what Fred just showed a card for ("its swelling pretty
  // bad" after the sprain card) that would be declined or get the watch
  // reply stays on that card, unless it names something new (setHere). #100:
  // or the matcher is sure of another card: "and now i sliced my thumb on the
  // can lid" after the stings card (cut, 0.85) got the stings card again.
  const saysAnother = saidSure !== undefined && saidKind === undefined && saidSure.label !== lastShown?.chunk.section;
  if (forcedCard === undefined && lastShown !== undefined && setHere.length === 0 && !saysAnother && !petPatient &&
      (candidates.length === 0 || topScore < effectiveThreshold) &&
      (leansBack(query) || SYMPTOM_UPDATE.test(query))) {
    forcedCard = agreedCard = lastShown;
  }

  // #109: a specific follow-up answered from the lines of the card the
  // conversation is on. Before a decline too (#115): "should we run to the
  // car" after "a bear just came into camp" was declined once a lightning
  // passage on sheltering in a vehicle scored 0.13, above the thread-card
  // floor, though the bear card says "Don't run" in so many words.
  const cardLinesReply = async (): Promise<AskResult | undefined> => {
    const onCard = followed ?? lastShown;
    if (!guardsOn || opts.lead === false || onCard === undefined || !asksSpecifically(query) || petPatient ||
        (opts.cardAnswer ?? 'verbatim') !== 'verbatim') return undefined;
    const parsedOn = parseCard(onCard.chunk.text);
    const lines = cardLines(parsedOn);
    const picked = matchCardLines(await queryVector(backend, query), parsedOn, store.cardLineVectorsFor?.(onCard.chunk.id), query);
    if (picked.length === 0) return undefined;
    return {
      kind: 'answer',
      stream: once([parsedOn.summary, ...picked.slice(0, 2).map((i) => lines[i]!)].join('\n')),
      citations: [citeOf(onCard, 0)],
      prompt: { system: '', user: '' },
      medical: MEDICAL_DOMAINS.has(onCard.chunk.domain),
      card: toOffer(onCard, citeOf(onCard, 0)),
      diagnostics: { ...baseDiag, candidates, topScore, sufficient: null, tokensBefore: 0, tokensAfter: 0, contextReduction: 0, cardAnswer: opts.cardAnswer ?? 'verbatim' },
    };
  };

  // Experiment (scope.ts): a message the scorer says needs an answer gets a
  // second chance where every rule above would decline it or give a fixed
  // reply. Never for a pet, or what the model called out of scope.
  if (inScope && forcedCard === undefined && (candidates.length === 0 || topScore < effectiveThreshold) &&
      u?.intent !== 'out' && !petPatient && !aboutPet) {
    // A statement ("my husband just sliced his palm on a tin can") matches
    // passages written as instructions poorly. Searched as a request for what
    // to do, the same words reach them; kept only when it scores higher, and
    // never when it leads with a clinical procedure. An emergency keeps to
    // first aid, as above.
    // Not a message that leans on earlier ones (currentThread): "everything's soaked
    // though" after a fire question reached the soaked-bandage card, and
    // "he's getting kind of shaky" about a diabetic the hypothermia card.
    // #152: the card the message says, when the matcher is sure, before any
    // second search: "ran hot water over my wrist by accident" has no card
    // leading either search.
    // #100: what is over is the card before, not the one named next: "it
    // left. my wife sliced her hand on the hatchet" after the bear card
    // (cut, 0.66) got the watch reply.
    const overIsEarlier = saysAnother && lastShown !== undefined;
    const saidCard = saidSure !== undefined && saidKind === undefined && (!saysResolved(query) || overIsEarlier) ? ownCard(await cardByTitle(saidSure.label)) : undefined;
    if (saidCard !== undefined && blockingCondition(saidCard.chunk.section, blockers) === undefined) {
      forcedCard = agreedCard = saidCard;
      saidUsed.push('opened');
    }
    if (forcedCard === undefined && !asksSomething(query) && history.length === 0) {
      const pool = intent === 'now' ? packs.filter((p) => !tipsPackIds.has(p.id)) : packs;
      const text = asRequest(searchText);
      const r0 = intent === 'now' ? route(keywords, pool, { state: opts.state, ...(opts.allowRoutingFallback === true ? { allowFallback: true } : {}) }) : routed;
      let cs = await search(keywords, r0.packIds, store, backend, retrievalOpts, r0.domains, text);
      let r = r0;
      if (best(cs) < effectiveThreshold) {
        const w = await widen(keywords, r0, pool, text);
        if (w !== undefined && w.top > best(cs)) { cs = w.candidates; r = w.routed; }
      }
      const lead = cs.reduce<ScoredChunk | undefined>((b, c) => (b === undefined || c.score > b.score ? c : b), undefined);
      if (best(cs) > topScore && lead?.chunk.audience !== 'provider') {
        candidates = cs;
        routed = r;
        topScore = best(cs);
        searchText = text;
        scopeUsed.push('framed');
      }
    }
    // The card that leads the search is opened (reviewed text). With no card
    // leading, the model answers only when the request's search clears the
    // normal gate. A lower gate for these messages was measured and rejected:
    // written from passages under it, answers to sore knees, cactus spines and
    // chafing were made up (docs/results-scope-scorer.md).
    const leading = forcedCard !== undefined || candidates.length === 0 ? undefined : ownCard(leadingCard(candidates, isCard, await supportOf(candidates)));
    const led = leading === undefined ? undefined : await supportedCard(leading);
    if (forcedCard !== undefined) {
      // The matcher's card, above.
    } else if (led !== undefined && blockingCondition(led.chunk.section, blockers) === undefined) {
      forcedCard = agreedCard = led;
      scopeUsed.push('card');
    } else if (topScore >= effectiveThreshold) {
      scopeUsed.push('gate');
    }
  }

  const ownTop = candidates.reduce<ScoredChunk | undefined>((b, c) => (b === undefined || c.score > b.score ? c : b), undefined);
  if (guardsOn && forcedCard === undefined && intent === 'now' && inScope && !dangerNow && ownTop !== undefined && topScore < effectiveThreshold &&
      ownTop.chunk.packId === 'core-hazards' && ownTop.score >= HAZARD_AGREED_FLOOR && requestTop?.chunk.id === ownTop.chunk.id) {
    effectiveThreshold = ownTop.score;
    scopeUsed.push('hazard');
  }
  if (forcedCard === undefined && (candidates.length === 0 || topScore < effectiveThreshold)) {
    const fromCard = await cardLinesReply();
    if (fromCard !== undefined) return fromCard;
    const weak = {
      ...baseDiag,
      candidates,
      topScore,
      tokensBefore: 0,
      tokensAfter: 0,
      contextReduction: 0,
    };
    if (u?.intent === 'out') {
      return { kind: 'abstain', reason: 'out-of-scope', nearest: [], diagnostics: weak };
    }
    // Someone in trouble never gets a dead end. The reply is fixed text from
    // reviewed cards (SAFETY_NET_REPLY), not model-written, so it cannot
    // invent advice; the card that led, if any, is offered under it. Not for
    // a pet: "call emergency services" is the wrong reply to a dog.
    // With guards on, the get-help-now reply needs a danger sign in the
    // hiker's words (triage.ts): downhill knee pain, a burn blister and "is it
    // safe to touch cholla" got it in round 1. Without one, Fred says it has
    // no steps for that, names the signs that would make it urgent, and asks
    // (WATCH_REPLY): still no dead end, and no alarm over a sore knee.
    // Stuck on a ledge opens the signalling card, however the message was
    // classified: "we're stuck on a ledge and can't climb up or down" was read
    // as a question, not NOW, and got a decline (phone, #128).
    // Not either card whole: the signalling card's first step is to reach
    // the highest ground, and the lost card's that moving may be better;
    // both summaries, reviewed text, say what fits (stay put; be seen and
    // heard), with the signalling card folded beneath.
    if (guardsOn && !aboutPet && stuckOnTerrain([...history, query])) {
      const signal = await cardByTitle('Signalling for rescue');
      const lost = await cardByTitle('Lost: should I stay or keep moving?');
      if (signal !== undefined && lost !== undefined) {
        return {
          kind: 'answer', stream: once(`${parseCard(lost.chunk.text).summary}\n${parseCard(signal.chunk.text).summary}`),
          citations: [citeOf(lost, 0), citeOf(signal, 1)], card: toOffer(signal, citeOf(signal, 0)),
          prompt: { system: '', user: '' }, medical: false,
          diagnostics: { ...weak, sufficient: null, cardAnswer: 'verbatim' },
        };
      }
    }
    // #23: a search under the gate whose passages hold a sentence this close
    // to the question is answered with that sentence, word for word
    // (UNDER_GATE_QUOTE_FLOOR). Nothing is written, so nothing is made up.
    const sourcesFound = candidates.slice(0, retrievalOpts.topK)
      .filter((c) => !isCard(c) && c.chunk.audience !== 'provider' && c.chunk.packId !== retrievalOpts.reserve?.packId);
    const nearQuote = async (): Promise<{ diagnostics: typeof weak; answer?: AskResult }> => {
      const near = guardsOn && !aboutPet && !petPatient && !NOT_FREDS_JOB.test(query)
        ? await quoteFrom(sourcesFound.map((c) => c.chunk), 0) : undefined;
      if (near === undefined) return { diagnostics: weak };
      const diagnostics = { ...weak, nearSentence: { similarity: near.similarity, text: near.text } };
      if (near.similarity < UNDER_GATE_QUOTE_FLOOR || opts.quoteUnderGate === false) return { diagnostics };
      const quoted = sourcesFound.filter((c) => near.chunkIds.includes(c.chunk.id));
      return {
        diagnostics,
        answer: {
          kind: 'answer', stream: once(near.text), citations: quoted.map(citeOf),
          prompt: { system: '', user: '' }, medical: quoted.some((c) => MEDICAL_DOMAINS.has(c.chunk.domain)),
          diagnostics: { ...diagnostics, sufficient: null, answerGuard: { replacedBy: 'near-quote' } },
          ...(offer === undefined ? {} : { card: offer }),
        },
      };
    };
    if (understandOn && intent === 'now' && !aboutPet) {
      const danger = !guardsOn || dangerNow;
      // With no danger sign, the sentence is tried before "I don't have steps
      // for that": "is it ok to eat snow if im out of water", read as urgent
      // on the phone, got that reply with the manual's answer in hand (#23).
      const near = danger || opts.quoteBeforeWatch === false ? { diagnostics: weak } : await nearQuote();
      if (near.answer !== undefined) return near.answer;
      return {
        kind: 'abstain', reason: danger ? 'safety-net' : 'watch', nearest: candidates.slice(0, 2).map(toCitation), diagnostics: near.diagnostics,
        ...(offer === undefined ? {} : { offer }),
      };
    }
    // Asking for a location is now a post-retrieval decision, made on evidence
    // rather than on which domain a word happens to be tagged with. It fires
    // only when the unscoped packs were searched and had nothing worth saying,
    // while a state pack that was skipped might have. That ordering is the
    // difference between "which state are you in?" and an answer for questions
    // like spoiled fish or testing cordage, where a plants/wildlife word routed
    // to state packs but core-survival held the answer all along.
    if (routed.skippedStatePacks.length > 0) {
      return { kind: 'needs-location', candidatePacks: routed.skippedStatePacks, diagnostics: weak };
    }
    const near = await nearQuote();
    if (near.answer !== undefined) return near.answer;
    return {
      kind: 'abstain', reason: 'low-score', nearest: candidates.slice(0, 2).map(toCitation), diagnostics: near.diagnostics,
      ...(offer === undefined ? {} : { offer }),
    };
  }

  // Tips are general advice, not local knowledge (#96). "Are there dangerous
  // animals in this area?" with no location was answered from a desert-safety
  // passage; the state pack that could say which animals was skipped. When
  // the question points at where the hiker is and the best passage is a tip,
  // ask for the location instead.
  const leader = candidates.reduce<ScoredChunk | undefined>((b, c) => (b === undefined || c.score > b.score ? c : b), undefined);
  if (forcedCard === undefined && opts.state === null && routed.skippedStatePacks.length > 0 &&
    leader?.chunk.domain === 'outdoor-skills' && REFERS_TO_LOCATION.test(query)) {
    return {
      kind: 'needs-location', candidatePacks: routed.skippedStatePacks,
      diagnostics: { ...baseDiag, candidates, topScore, tokensBefore: 0, tokensAfter: 0, contextReduction: 0 },
    };
  }

  // Clinical procedures (IV lines, needle decompression, dose tables) are
  // marked provider-only at ingest. When one is the best manual match and no
  // field card matched, the question is asking to be walked through it, and
  // Fred refers the hiker on instead (docs/plan-phase3.md, class B). Otherwise
  // the marked passages are dropped, so the model is never handed a procedure
  // that sits beside the one the hiker actually needs.
  const reservedPack = retrievalOpts.reserve?.packId;
  const cardMatched = retrievalOpts.reserve !== undefined && candidates.some(
    (c) => c.chunk.packId === reservedPack && c.score >= retrievalOpts.reserve!.minScore,
  );
  const bestManual = candidates
    .filter((c) => c.chunk.packId !== reservedPack)
    .reduce<ScoredChunk | undefined>((b, c) => (b === undefined || c.score > b.score ? c : b), undefined);
  // Referred when a provider-only passage is the best manual match or within
  // PROVIDER_NEAR_TOP of it. Only "the best" let a re-ranking switch the
  // referral off: with contextual preambles the needle-decompression passage
  // came second at 0.476 against 0.477 and the procedure was walked through
  // (docs/results-contextual.md). On every answerable tuning and held-out
  // question, no provider-only passage reached the top four at all.
  const providerNearTop = bestManual !== undefined && candidates.some((c) =>
    c.chunk.packId !== reservedPack && c.chunk.audience === 'provider' &&
    c.score >= PROVIDER_NEAR_TOP * bestManual.score);
  if (!cardMatched && providerNearTop) {
    return {
      kind: 'abstain',
      reason: 'provider-only',
      nearest: candidates.slice(0, 2).map(toCitation),
      diagnostics: { ...baseDiag, candidates, topScore, tokensBefore: 0, tokensAfter: 0, contextReduction: 0 },
    };
  }
  // With a wildfire near, no passage that says to start a fire or make smoke,
  // and no card it rules out, reaches the model (FIRE_STARTING, NOT_AFTER).
  let usable = tipsInTrustOrder(candidates.filter((c) => c.chunk.audience !== 'provider' &&
    !(fireNear && FIRE_STARTING.test(c.chunk.text)) && !(isCard(c) && blockingCondition(c.chunk.section, situations) !== undefined)));

  const cardMode = opts.cardAnswer ?? 'verbatim';
  let clear = forcedCard ?? clearCard(usable, retrievalOpts.reserve, await supportOf(usable));
  // #268: the card the matcher is sure of, when the search found it too, is
  // shown above the gate as it is under it ('opened', above). Between the
  // gate and CARD_TOP_FLOOR neither rule held: "we can see a big smoke column
  // a few ridges over" led with the wildfire card at 0.30 (matcher 0.73) and
  // got a written answer, and "a wildfire started on the slope below the
  // trailhead" (0.82) the same. Only a first message that says what is
  // happening; a specific question keeps its written answer.
  if (clear === undefined && forcedCard === undefined && saidSure !== undefined && saidKind === undefined &&
      history.length === 0 && !asksSpecifically(query) && !saysResolved(query) && cardMode === 'verbatim') {
    const said = usable.find((c) => isCard(c) && c.chunk.section === saidSure.label);
    if (said !== undefined && ownCard(said) !== undefined) {
      clear = said;
      saidUsed.push('opened');
    }
  }
  // The same holds for the understanding step's search: "what's the magnetic
  // declination where I'm standing?" after "how can I find north?" was read as
  // a navigation request and repeated the finding-north card word for word
  // (convo-oos, #98 calibration). Outside an emergency, the model answers from
  // the passages with the conversation in view, and can say they don't cover it.
  if (understood?.used === true && forcedCard === undefined) clear = undefined;
  // Showing a card word for word claims it answers the question, so for a
  // follow-up the card must also clearly match the new message on its own.
  // Matched on the joined search alone, "can I stitch it closed?" after a cut
  // repeated the cuts card: every out-of-scope follow-up in the tuning set was
  // answered that way (docs/plan-memory.md). Without the card, the model
  // answers from the passages and can say the sources do not cover it.
  if (followUp?.used === true && clear !== undefined && !keptShown && !(opts.scope !== undefined && forcedCard?.chunk.section === 'Eating wild plants and berries') &&
      clearCard(standalone, retrievalOpts.reserve, await supportOf(standalone))?.chunk.id !== clear.chunk.id) {
    clear = undefined;
  }
  // Round 2: a card that must not follow a condition is never shown
  // (conditions.ts). "its on his ankle and swelling" after a snakebite opened
  // the sprain card (ice, wrap, raise) on the phone. Fred shows the
  // condition's own card and asks, so a separate injury is a tap away.
  if (clear !== undefined) {
    const by = blockingCondition(clear.chunk.section, blockers);
    if (by !== undefined) {
      blocked = { card: clear.chunk.section, condition: by.id };
      const instead = await cardByTitle(by.card);
      if (instead !== undefined && cardMode === 'verbatim') {
        const mine = parseCard(instead.chunk.text);
        const theirs = parseCard(clear.chunk.text);
        const whole = renderCard(mine);
        return {
          kind: 'answer',
          stream: once(whole),
          citations: [citeOf(instead, 0)],
          prompt: buildPromptParts(query, [{ chunk: instead.chunk, text: instead.chunk.text }], opts.answerVariant),
          medical: MEDICAL_DOMAINS.has(instead.chunk.domain),
          clarify: {
            question: CONDITION_CLARIFY(by.label),
            choices: [
              { label: `Yes, the ${by.label}`, text: whole },
              { label: 'No, something else', text: renderCard(theirs) },
            ],
            picked: null,
            whole,
          },
          diagnostics: {
            ...baseDiag, blocked, candidates, topScore, sufficient: null,
            tokensBefore: 0, tokensAfter: 0, contextReduction: 0, cardAnswer: cardMode,
          },
        };
      }
      clear = undefined;
    }
  }
  // A model-written answer never reads a card that must not follow a
  // condition, and in the condition's thread it reads the condition's card.
  if (active.length > 0) {
    usable = usable.filter((c) => !isCard(c) || blockingCondition(c.chunk.section, blockers) === undefined);
    // Only the condition this message is about (conditionCardFor): "i have a
    // bad blister on my heel" after being lost was written from the lost card
    // first (conversation set, #101).
    // The condition this message sets belongs there too: "they fell off a
    // rock, so should I still tilt their head back?" needs the spine card in
    // front of the model (conversation set).
    const here = await Promise.all(setHere.filter((c) => c.situation !== true).map((c) => cardByTitle(c.card)));
    for (const card of [...here, history.length > 0 ? followed : undefined]) {
      if (card !== undefined && !usable.some((x) => x.chunk.id === card.chunk.id)) usable = [card, ...usable];
    }
  }
  // #240: the card just shown is not shown again, whole, for a specific
  // question it does not answer. "should i pop it" after the burns card and
  // "can she walk on it" after the sprain card got the same card again (11
  // of 17 repeats in the dev chats fell short, docs/c258). The lines that
  // answer it still come from the card (#109); with none close enough, the
  // model writes, with the card first and the conversation in view ("Do not
  // pop the blister"). Only questions (Ryan, 2026-11-22): told a plain
  // statement, the model wrote off the point ("it's about 7pm" after the lost
  // card got how to find north with a watch), so a statement keeps the card.
  // An update on the condition, a bare "what now", anything with a danger
  // sign, and the cards for a danger that lasts (CARD_HOLDS_FOLLOW_UPS) keep
  // it too.
  if (clear !== undefined && guardsOn && cardMode === 'verbatim' && opts.lead !== false && lastShown?.chunk.id === clear.chunk.id &&
      asksSpecifically(query) && !CARD_HOLDS_FOLLOW_UPS.has(clear.chunk.section) && !dangerNow && !petPatient && !SYMPTOM_UPDATE.test(query) && !BARE_ASK.test(query)) {
    const shown = clear;
    const picked = matchCardLines(await queryVector(backend, query), parseCard(shown.chunk.text), store.cardLineVectorsFor?.(shown.chunk.id), query);
    if (picked.length === 0) {
      clear = undefined;
      repeatHeld = shown.chunk.section;
      usable = [shown, ...usable.filter((c) => c.chunk.id !== shown.chunk.id)];
      earlier ??= (opts.history ?? []).slice(-UNDERSTAND_HISTORY).join(' / ') || undefined;
    }
  }
  if (cardMode !== 'off' && clear !== undefined) {
    const card = clear;
    const parsed = parseCard(card.chunk.text);
    const cardBlocks: ContextBlock[] = [{ chunk: card.chunk, text: card.chunk.text }];
    const prompt = buildPromptParts(query, cardBlocks, opts.answerVariant);
    const diagnostics = {
      ...baseDiag, candidates, topScore, sufficient: null,
      tokensBefore: 0, tokensAfter: 0, contextReduction: 0, cardAnswer: cardMode,
    };
    const common = { kind: 'answer' as const, citations: [citeOf(card, 0)], prompt, medical: MEDICAL_DOMAINS.has(card.chunk.domain), diagnostics };
    if (cardMode === 'card-only') {
      return { ...common, stream: backend.generate(prompt, opts.signal ? { maxTokens, signal: opts.signal } : { maxTokens }) };
    }
    // #109: a specific question about the card's subject ("can i put ice on
    // it", "how long should i ice it") gets the card's summary and the lines
    // that answer it, in the card's own words, with the whole card folded
    // beneath. The lines are matched to the question by the search model, as
    // passages are; nothing is written. A rewritten answer inverted the card
    // ("No. Do not take off her ring", #109 try-out; results-phase3.md), and
    // the 1.7B model asked to pick line numbers found no line for "can i put
    // ice on it" beside "Don't put ice on it". The summary leads because the
    // lines alone miss the point a card opens with ("rest" for a sprain). No
    // line close enough: the card itself, open, as before. How-to questions
    // and first reports keep the card open: its steps are the answer.
    if (cardMode === 'verbatim' && guardsOn && opts.lead !== false && asksSpecifically(query) && !petPatient) {
      const lines = cardLines(parsed);
      const picked = matchCardLines(await queryVector(backend, query), parsed, store.cardLineVectorsFor?.(card.chunk.id), query);
      if (picked.length > 0) {
        return {
          ...common,
          card: toOffer(card, citeOf(card, 0)),
          stream: once([parsed.summary, ...picked.slice(0, 2).map((i) => lines[i]!)].join('\n')),
        };
      }
    }
    if (cardMode === 'verbatim') {
      const ask = store.clarifyFor?.(card.chunk.id);
      if (ask === undefined) return { ...common, stream: once(renderCard(parsed)) };
      const choices = ask.choices.map((c) => ({ label: c.label, text: renderCardSteps(parsed, c.steps) }));
      const picked = pickChoice(ask.choices, query);
      // Vague ("how do I treat a burn?"): the whole card, as before, with the
      // question offered to narrow it. Already said ("my palm is
      // blistering"): only that case, with the others a tap away.
      return {
        ...common,
        stream: once(picked === null ? renderCard(parsed) : choices[picked]!.text),
        clarify: { question: ask.question, choices, picked: picked === null ? null : choices[picked]!.label, whole: renderCard(parsed) },
      };
    }
    const signal = opts.signal;
    return {
      ...common,
      stream: (async function* () {
        let pick = '';
        for await (const tok of backend.generate(buildPickParts(query, parsed), signal ? { maxTokens: 24, temperature: 0, signal } : { maxTokens: 24, temperature: 0 })) {
          pick += tok;
        }
        yield renderCard(parsed, readPick(pick, parsed.steps.length));
      })(),
    };
  }

  // #109: a specific follow-up about the card this conversation is on (the
  // condition it is about, or the card just shown) gets that card's summary
  // and matching lines when a line is close enough: "should we kill the snake
  // to bring it to the hospital" after a snakebite was written from four manual
  // passages (13-25 s on the phone) though the snakebite card says not to. No
  // line close enough: the passages, as before.
  {
    const fromCard = await cardLinesReply();
    if (fromCard !== undefined) return fromCard;
  }

  // #24: no card answered a dose question in an emergency.
  if (dose) {
    return { kind: 'abstain', reason: 'safety-net', nearest: [], diagnostics: { ...baseDiag, candidates, topScore, tokensBefore: 0, tokensAfter: 0, contextReduction: 0 } };
  }

  // Stage 3 — compress before prefill.
  const compressed = await compressContext(
    opts.joinNeighbours === true ? joinNeighbours(usable.map((c) => c.chunk)) : usable.map((c) => c.chunk),
    keywords,
    { ...(opts.compression ?? NO_COMPRESSION), countTokens: (texts) => backend.countTokens(texts) },
  );

  const blocks: ContextBlock[] = compressed.chunks.map((c) => ({
    chunk: c.chunk,
    text: c.text,
  }));

  // The sufficiency check runs here, after compression, so it sees exactly the
  // passages the answer would be built from. Asking before compression would
  // judge material the generator never gets.
  let sufficient: boolean | null = null;
  if (opts.checkSufficiency === true) {
    let verdict = '';
    for await (const tok of backend.generate(buildSufficiencyParts(query, blocks, opts.sufficiencyVariant), {
      maxTokens: 4, temperature: 0,
    })) {
      verdict += tok;
      if (verdict.trim().length >= 3) break;
    }
    sufficient = readSufficiency(verdict);
    if (!sufficient) {
      return {
        kind: 'abstain',
        reason: 'insufficient',
        nearest: candidates.slice(0, 2).map(toCitation),
        diagnostics: {
          ...baseDiag,
          candidates,
          topScore,
          tokensBefore: compressed.tokensBefore,
          tokensAfter: compressed.tokensAfter,
          contextReduction: compressed.reduction,
          sufficient,
        },
      };
    }
  }

  // Say where the hiker is only when the question points at it ("this state",
  // "around here") and a state pack is being answered from. Added to every
  // state-pack answer it fixed ff-bear-01 but also reworded answers that
  // needed no location, losing details (docs/results-phase3.md).
  const statePacks = new Set(packs.filter((p) => p.scope.kind === 'us-state').map((p) => p.id));
  const place = opts.state !== null && opts.locationInPrompt !== false && REFERS_TO_LOCATION.test(query) &&
    blocks.some((b) => statePacks.has(b.chunk.packId))
    ? STATE_NAMES[opts.state] : undefined;
  // Deep thinking's "evidence first" (#21): the sentences closest to the
  // question, found by their vectors (no model), go first as the lines to
  // write from. The passages follow as before.
  const deepInfo: { drafts: number; support: number[]; chosen: number; dropped: string[]; quoted: boolean; evidence: number; units: { draft: number; text: string; support: number; onQuestion: number }[]; texts: string[] } =
    { drafts: 0, support: [], chosen: 0, dropped: [], quoted: false, evidence: 0, units: [], texts: [] };
  const supportPassages = usable.map((c) => ({ chunkId: c.chunk.id, text: c.chunk.text, rows: store.sentenceVectorsFor?.(c.chunk.id) }));
  let promptBlocks = blocks;
  if (opts.deep?.evidence === true) {
    const seen = new Set<string>();
    const lines = rankSentences(await queryVector(backend, query), supportPassages)
      .filter((r) => r.similarity >= DEEP_EVIDENCE_FLOOR && !seen.has(r.text) && seen.add(r.text) !== undefined)
      .slice(0, DEEP_EVIDENCE_MAX);
    const first = lines[0] === undefined ? undefined : usable.find((c) => c.chunk.id === lines[0]!.chunkId);
    if (first !== undefined) {
      deepInfo.evidence = lines.length;
      promptBlocks = [{ chunk: first.chunk, text: `The lines closest to the question:\n${lines.map((l) => `- ${l.text}`).join('\n')}` }, ...blocks];
    }
  }
  const prompt = buildPromptParts(query, promptBlocks, opts.answerVariant, place, earlier, opts.shapeVariant);
  const generateOpts = opts.signal
    ? { maxTokens, signal: opts.signal }
    : { maxTokens };

  // Round 2: while a condition is active, a model-written answer is read in
  // full before it is shown, and one that gives advice the condition's card
  // says not to give is replaced by that card (conditions.ts). Streaming is
  // given up only then.
  // #51: a risk with no card (an algal bloom) guards the answer too, with its
  // reviewed reply in place of a card.
  // #126: the one or two sentences of the passages given that are closest to
  // the question, verbatim, when one clears QUOTE_FLOOR.
  const quoteSources = async (): Promise<string | undefined> => {
    if (!guardsOn || NOT_FREDS_JOB.test(query)) return undefined;
    return (await quoteFrom(blocks.filter((b) => b.chunk.packId !== retrievalOpts.reserve?.packId).map((b) => b.chunk), QUOTE_FLOOR))?.text;
  };
  const closestCard = (): ScoredChunk | undefined => {
    if (!guardsOn || opts.closestCard === false || NOT_FREDS_JOB.test(query) || petPatient || saidNoCard) return undefined;
    const card = usable.filter(isCard).reduce<ScoredChunk | undefined>((b, c) => (b === undefined || c.score > b.score ? c : b), undefined);
    return card !== undefined && card.score >= CLOSEST_CARD_FLOOR ? card : undefined;
  };
  const watched = [...active.filter((c) => c.forbidden !== undefined), ...(fireNear ? [WILDFIRE_NEAR] : []), ...(guardsOn ? exposureConditions([...history, query]) : [])];
  // #51: someone in danger is never left with "I don't have reliable
  // information": "we cleaned out a mousy cabin last week and now i have a
  // fever and it's getting hard to breathe" found the hantavirus passages and
  // the model declined (health set).
  const emergency = guardsOn && dangerNow;
  const guardCard = async (text: string): Promise<string> => {
    // A refusal in the middle of a condition is a dead end too.
    if (isRefusal(text) && followed !== undefined) {
      answerGuard.refused = true;
      answerGuard.replacedBy = 'refusal';
      return renderCard(parseCard(followed.chunk.text));
    }
    if (isRefusal(text)) {
      answerGuard.refused = true;
      // The reviewed reply for the risk at hand, when there is one: a
      // lightning victim gets "safe to touch... start CPR", not only "call
      // emergency services" (#115).
      const specific = emergency ? watched.find((c) => c.instead !== undefined) : undefined;
      if (specific !== undefined) { answerGuard.replacedBy = specific.id; return specific.instead!; }
      // #126: the sources' own sentences, when the search cleared the gate
      // and one of them is close to the question.
      const quoted = await quoteSources();
      if (quoted !== undefined) { answerGuard.replacedBy = 'quoted'; return quoted; }
      // #23: the field card the model was handed and declined to use.
      const near = closestCard();
      if (near !== undefined) {
        answerGuard.replacedBy = 'card';
        return `${CLOSEST_CARD_LEAD}\n${renderCard(parseCard(near.chunk.text))}`;
      }
      if (emergency) { answerGuard.replacedBy = 'safety-net'; return SAFETY_NET_REPLY; }
      return text;
    }
    const by = violatedCondition(text, watched);
    if (by === undefined) return text;
    if (by.instead !== undefined) { answerGuard.replacedBy = by.id; return by.instead; }
    const card = await cardByTitle(by.card);
    if (card === undefined) return text;
    answerGuard.replacedBy = by.id;
    return renderCard(parseCard(card.chunk.text));
  };
  const answerGuard: { replacedBy?: string; refused?: boolean } = {};
  // #126: the generation with its numbers checked against the passages given.
  const sourceText = [query, earlier ?? '', ...blocks.map((b) => b.text)].join('\n');
  const draft = (i: number): AsyncIterable<string> => {
    // Draft 0 is the normal greedy answer; further drafts sample (#21).
    const o = i === 0 ? generateOpts : { ...generateOpts, temperature: DEEP_DRAFT_TEMPERATURE, seed: DEEP_DRAFT_SEED + i };
    return guardsOn
      ? numberChecked(backend.generate(prompt, o), sourceText, async (shown) => {
        const quoted = await quoteSources();
        answerGuard.replacedBy = 'number';
        if (quoted !== undefined) return shown ? `\n\n${quoted}` : quoted;
        return shown ? '' : NO_ANSWER_REPLY;
      })
      : backend.generate(prompt, o);
  };
  // Deep thinking's "check every step" and "best of N" (#21): each draft is
  // read whole, every step or sentence is compared with the source sentences
  // by vector, the best-supported draft is kept, and with check on its
  // unsupported sentences are dropped. A tool judges, not the model: small
  // models voting or judging themselves lose accuracy (docs/plan-deep-thinking.md).
  const deepOn = opts.deep !== undefined && (opts.deep.check === true || (opts.deep.drafts ?? 1) > 1);
  const deepGenerated = async function* (): AsyncIterable<string> {
    const n = Math.max(1, opts.deep?.drafts ?? 1);
    const questionVec = await queryVector(backend, query);
    const drafts: { text: string; units: { text: string; support: number | null; onQuestion: number | null }[]; score: number }[] = [];
    for (let i = 0; i < n; i++) {
      let text = '';
      for await (const tok of draft(i)) text += tok;
      const units = await Promise.all(answerUnits(text).map(async (u) => {
        if (!checkable(u)) return { text: u, support: null, onQuestion: null };
        const v = await queryVector(backend, u);
        const support = rankSentences(v, supportPassages)[0]?.similarity ?? 0;
        const onQuestion = cosine(v, questionVec);
        deepInfo.units.push({ draft: i, text: u, support: Number(support.toFixed(3)), onQuestion: Number(onQuestion.toFixed(3)) });
        return { text: u, support, onQuestion };
      }));
      const scored = units.filter((u) => u.support !== null);
      const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
      // #21 is answers about something else: a draft is judged on keeping to
      // the question as much as on keeping to the sources.
      deepInfo.texts.push(text);
      // Round 2 (#21): judged by the words (judgeDraft); the vector scores
      // are still recorded beside it for the check.
      const judged = judgeDraft(text, supportPassages.map((p) => p.text).join('\n'), query);
      drafts.push({ text, units, score: isRefusal(text) ? -Infinity : judged });
      void mean;
    }
    deepInfo.drafts = n;
    deepInfo.support = drafts.map((d) => Number(d.score.toFixed(3)));
    const chosen = drafts.reduce((b, d, i) => (d.score > drafts[b]!.score ? i : b), 0);
    deepInfo.chosen = chosen;
    const pick = drafts[chosen]!;
    if (opts.deep?.check !== true || isRefusal(pick.text)) { yield pick.text; return; }
    const keep = pick.units.filter((u) => u.support === null || u.support >= DEEP_CHECK_FLOOR);
    deepInfo.dropped = pick.units.filter((u) => !keep.includes(u)).map((u) => u.text);
    const checked = pick.units.filter((u) => u.support !== null).length;
    if (checked > 0 && deepInfo.dropped.length * 2 > checked) {
      // Most of it had no source behind it: the sources' own sentences instead.
      const quoted = await quoteSources();
      if (quoted !== undefined) { deepInfo.quoted = true; yield quoted; return; }
    }
    yield renumbered(keep.map((u) => u.text)).join('\n');
  };
  const generated = (): AsyncIterable<string> => (deepOn ? deepGenerated() : draft(0));
  // Only advice a condition forbids needs the whole answer read first. A
  // refusal in the middle of a condition is caught from its first words, so
  // everything else still streams: holding every answer in a "lost" chat
  // took the first words to 27.7 s on the phone (#101).
  const refusalOnly = (async function* () {
    const ends = DEAD_ENDS.map((d) => d.toLowerCase());
    let head = '';
    let streaming = false;
    for await (const tok of generated()) {
      if (streaming) { yield tok; continue; }
      head += tok;
      const h = head.trimStart().toLowerCase();
      // Held while it could still be a dead end (a decline, the rule echoed).
      if (!ends.some((e) => e.startsWith(h.slice(0, e.length)) && h.length <= e.length + 4)) { streaming = true; yield head; }
    }
    if (!streaming) yield await guardCard(head);
  })();
  // #103: checked sentence by sentence, so the first words come with the
  // first sentence instead of the whole answer (19 s on the phone, #101).
  const stream = watched.length > 0
    ? streamChecked(generated(), {
      violates: (sentence) => violatedCondition(sentence, watched),
      holdsFirst: (sentence) => (followed !== undefined || emergency) && isRefusal(sentence),
      replace: async (by, shownAlready) => {
        if (by.instead !== undefined) {
          answerGuard.replacedBy = by.id;
          return shownAlready ? `\n\n${CONDITION_INSTEAD(by.label)}\n${by.instead}` : by.instead;
        }
        const card = await cardByTitle(by.card);
        if (card === undefined) return undefined;
        answerGuard.replacedBy = by.id;
        const text = renderCard(parseCard(card.chunk.text));
        // What came before passed the check but may be off for the condition
        // ("apply athletic tape" before a burn blister's forbidden draining),
        // so the switch is said plainly (#103).
        return shownAlready ? `\n\n${CONDITION_INSTEAD(by.label)}\n${text}` : text;
      },
      whole: guardCard,
    })
    // Every answer is read for a dead end at its start (a few tokens): a
    // decline becomes a quote, a card or the safety net (#126).
    : guardsOn ? refusalOnly : backend.generate(prompt, generateOpts);

  return {
    kind: 'answer',
    stream,
    citations: usable.map(citeOf),
    prompt,
    medical: usable.some((c) => MEDICAL_DOMAINS.has(c.chunk.domain)),
    diagnostics: {
      ...baseDiag,
      candidates,
      topScore,
      sufficient,
      tokensBefore: compressed.tokensBefore,
      tokensAfter: compressed.tokensAfter,
      contextReduction: compressed.reduction,
      ...(repeatHeld === undefined ? {} : { repeatHeld }),
      ...(opts.deep === undefined ? {} : { deep: deepInfo }),
      ...(guardsOn ? { answerGuard } : {}),
    },
  };
}

/**
 * The end of the first complete sentence or line in `text`, or -1. A full
 * stop after a digit is a list number ("1. Keep them still"), not an end.
 */
function sentenceEnd(text: string): number {
  const m = /(?<!\d)[.!?](?=\s)|\n/.exec(text);
  return m === null ? -1 : m.index + 1;
}

/**
 * Stream a model-written answer while checking it sentence by sentence (#103).
 * Each complete sentence that `violates` passes is shown at once. At the first
 * that fails, it and everything after are dropped (generation stops) and
 * `replace` supplies what to show instead: the condition's card, after what
 * was already shown. A first sentence `holdsFirst` keeps back (a refusal that
 * may be the whole answer) is decided by `whole` on the full text, as before.
 */
export async function* streamChecked(
  tokens: AsyncIterable<string>,
  check: {
    readonly violates: (sentence: string) => Condition | undefined;
    readonly holdsFirst: (sentence: string) => boolean;
    readonly replace: (by: Condition, shownAlready: boolean) => Promise<string | undefined>;
    readonly whole: (text: string) => Promise<string>;
  },
): AsyncGenerator<string> {
  let buf = '';
  let shown = false;
  let held = '';
  for await (const tok of tokens) {
    buf += tok;
    for (let cut = sentenceEnd(buf); cut > 0; cut = sentenceEnd(buf)) {
      const sentence = buf.slice(0, cut);
      buf = buf.slice(cut);
      const by = check.violates(sentence);
      if (by !== undefined) {
        const instead = await check.replace(by, shown || held !== '');
        if (instead !== undefined) {
          if (held !== '') yield held;
          yield instead;
          return;
        }
      }
      if (!shown && held === '' && check.holdsFirst(sentence)) { held = sentence; continue; }
      if (held !== '') { yield held; held = ''; }
      yield sentence;
      shown = true;
    }
  }
  if (!shown) { yield await check.whole(held + buf); return; }
  const by = buf.trim() === '' ? undefined : check.violates(buf);
  const instead = by === undefined ? undefined : await check.replace(by, true);
  yield instead ?? buf;
}

function toOffer(card: ScoredChunk, citation: Citation): CardOffer {
  return { title: card.chunk.section, text: renderCard(parseCard(card.chunk.text)), citation };
}

/**
 * The field card that clearly matches: at or above the reserved-slot bar, or
 * at least CARD_TOP_FLOOR and above every manual passage. Undefined otherwise.
 */
function clearCard(
  cands: readonly ScoredChunk[],
  reserve: RetrievalOptions['reserve'],
  support?: CardSupport,
): ScoredChunk | undefined {
  if (reserve === undefined) return undefined;
  const top = (cs: readonly ScoredChunk[]): ScoredChunk | undefined =>
    cs.reduce<ScoredChunk | undefined>((b, c) => (b === undefined || c.score > b.score ? c : b), undefined);
  const card = top(cands.filter((c) => c.chunk.packId === reserve.packId && c.chunk.audience !== 'provider'));
  if (card === undefined) return undefined;
  // The top manual passage outranks the card only if it is on something else
  // (cardSupport); one that says the same thing backs it.
  const manualTop = top(cands.filter((c) => c.chunk.packId !== reserve.packId));
  const manual = manualTop !== undefined && support?.get(card.chunk.id)?.has(manualTop.chunk.id) === true ? undefined : manualTop;
  return card.score >= reserve.minScore || (card.score >= CARD_TOP_FLOOR && card.score >= (manual?.score ?? 0))
    ? card : undefined;
}

async function* once(text: string): AsyncIterable<string> {
  yield text;
}

function toCitation(c: ScoredChunk, i: number): Citation {
  return {
    index: i + 1,
    chunkId: c.chunk.id,
    source: c.chunk.source,
    section: c.chunk.section,
    page: c.chunk.page,
    licenseId: c.chunk.licenseId,
    score: c.score,
    ...(c.chunk.source === 'Fred field card' ? {} : { passage: c.chunk.text }),
  };
}

/**
 * US-13 (#80): will this message get a written answer, which runs the model
 * for seconds, or a quick reply (a field card, small talk, a decline)? For
 * the battery estimate shown before sending. The search only, on the message
 * alone: no model call, so the intent and understanding steps, and the
 * conversation, have no say. It predicts the likely path, not a guarantee
 * (measured in docs/results-battery-estimate.md).
 */
export async function predictCost(
  query: string,
  deps: PipelineDeps,
  opts: Pick<AskOptions, 'state' | 'retrieval' | 'abstainThreshold' | 'saidAs'>,
): Promise<ReplyCost> {
  const { store, packs, backend } = deps;
  if (query.trim() === '' || ONLY_ACKNOWLEDGES.test(query)) return 'quick';
  const retrievalOpts = opts.retrieval ?? DEFAULT_RETRIEVAL;
  const keywords = extractKeywords(withExposures(query));
  const unscoped = packs.filter((p) => p.scope.kind !== 'us-state' || p.scope.state === opts.state);
  const routed = route(keywords, packs, { state: opts.state });
  // Every pack the pipeline could end up searching (a weak routed search is
  // widened, an everyday question reaches the tips): the best it can find.
  const ids = [...new Set([...routed.packIds, ...unscoped.filter((p) => p.scope.kind !== 'us-state').map((p) => p.id)])];
  const domains = [...new Set([...routed.domains, ...unscoped.filter((p) => ids.includes(p.id)).flatMap((p) => p.domains)])];
  const candidates = await retrieve(keywords, ids, store, backend, retrievalOpts, domains, query);
  const top = candidates.reduce((m, c) => Math.max(m, c.score), 0);
  if (top < (opts.abstainThreshold ?? DEFAULT_ABSTAIN_THRESHOLD)) return 'quick';
  // A card that clearly matches, or one the matcher is sure of, is shown as it is.
  const usable = candidates.filter((c) => c.chunk.audience !== 'provider');
  if (clearCard(usable, retrievalOpts.reserve) !== undefined) return 'quick';
  if (opts.saidAs !== undefined) {
    const said = saidAs(opts.saidAs, await queryVector(backend, query))[0];
    if (said !== undefined && said.p >= opts.saidAs.sure && noCardKind(said.label) !== 'other' && noCardKind(said.label) !== 'gear' && noCardKind(said.label) !== 'minor') return 'quick';
  }
  return 'written';
}
