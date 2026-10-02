/**
 * End-to-end query pipeline, tying together routing, hybrid retrieval, selective
 * context compression, the abstention gate, and generation.
 *
 * Pure orchestration — every platform-specific concern arrives through the
 * interfaces in backends.ts, so this exact code path runs both on device and in
 * tools/eval.
 */
import type { InferenceBackend, MemoryMonitor, PackStore } from './backends.ts';
import type { CardSource, ChunkRecord } from '@fred/pack-format';
import { compressContext } from './compress.ts';
import { extractKeywords, type Keyword } from './lexicon.ts';
import { isRefusal, NO_ANSWER_REPLY, CONDITION_INSTEAD, buildPromptParts, buildRewriteParts, buildSufficiencyParts, readSufficiency, CHAT_REPLY, CHAT_REPLY_WITH_OFFER, CONDITION_CLARIFY, type ContextBlock, type PromptParts, type SufficiencyVariant, type AnswerVariant, type ShapeVariant } from './prompt.ts';
import { applyQueryTemplate, retrieve, DEFAULT_RETRIEVAL, type RetrievalOptions, type ScoredChunk } from './retrieve.ts';
import { classifyIntent, type Intent } from './intent.ts';
import { currentThread, leansBack, understandMessage, UNDERSTAND_HISTORY, type Understood } from './understand.ts';
import { blockingCondition, CONDITIONS, violatedCondition, type Condition } from './conditions.ts';
import { buildRecord, conditionsFor, latestFor, saysResolved } from './record.ts';
import { asksSomething, asksToEatUnknown, dangerSign, eatingUnknownInThread, petIsPatient } from './triage.ts';
import { joinNeighbours } from './join.ts';
import { withExposures } from './exposures.ts';
import { route, type RoutablePack, type RouteResult } from './router.ts';
import { buildPickParts, cardLines, matchCardLines, parseCard, pickChoice, readPick, renderCard, renderCardSteps } from './card-answer.ts';
import { STATE_NAMES } from './states.ts';

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

/** An animal as the patient: no human first-aid card is forced open for it. */
const ABOUT_A_PET = /\b(?:my|our|the|his|her|their)\s+(?:dog|cat|puppy|kitten|horse|pony|pet|mule|donkey|goat)s?\b/i;

/** The best card counts as leading when it scores at least this share of the top result. */
export const INTENT_CARD_NEAR_TOP = 0.85;

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
const MEDICINE_OR_PROCEDURE = /\bblood type\b|\btransfus\w*|\bstitch\w*|\bsutur\w*|\bstaple\w*|\b(?:ibuprofen|advil|tylenol|acetaminophen|aspirin|benadryl|antibiotics?|painkillers?|morphine|meds?|medication|medicine|pills?|dose|dosage|mg|milligrams?)\b|\bhow (?:many|much) (?:\w+ )?(?:can|should) (?:i|he|she|they|we) (?:take|give)\b/i;
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
 */
const THREAD_CARD_WORDS = 5;
const THREAD_CARD_MIN = 0.05;
function clearlyLeadingCard(candidates: readonly ScoredChunk[], isCard: (c: ScoredChunk) => boolean): ScoredChunk | undefined {
  const [first, second] = [...candidates].sort((a, b) => b.score - a.score);
  if (first === undefined || !isCard(first) || first.score < THREAD_CARD_MIN) return undefined;
  return second === undefined || second.score <= THREAD_CARD_MARGIN * first.score ? first : undefined;
}

function leadingCard(candidates: readonly ScoredChunk[], isCard: (c: ScoredChunk) => boolean): ScoredChunk | undefined {
  const top = candidates.reduce((m, c) => Math.max(m, c.score), 0);
  const card = candidates.filter(isCard).reduce<ScoredChunk | undefined>((b, c) => (b === undefined || c.score > b.score ? c : b), undefined);
  return card !== undefined && card.score >= INTENT_CARD_FLOOR && card.score >= INTENT_CARD_NEAR_TOP * top ? card : undefined;
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
  };
  /** Round 2: the conditions the conversation established (conditions.ts). */
  readonly conditions?: readonly string[];
  /** Round 2: a card that was not shown because it must not follow a condition. */
  readonly blocked?: { readonly card: string; readonly condition: string };
  /** Round 2: a below-gate emergency card opened because two searches agreed on it. */
  readonly agreedCard?: string;
  /**
   * Round 2: set while a condition is active and the answer is model-written.
   * `replacedBy` is filled in once the stream has been read, when the answer
   * gave advice the condition's card says not to give and the card was shown.
   */
  readonly answerGuard?: { readonly replacedBy?: string };
  /** Time before the decision, split into model calls and embedding (ms). */
  readonly timing?: { readonly modelMs: number; readonly embedMs: number; readonly totalMs: number };
  /** Top score of the search widened to every unscoped pack, when the routed one fell under the gate. */
  readonly widenedTopScore?: number;
  /** The manual-wording restatement, when a second search ran, and what it scored. */
  readonly secondSearch?: { readonly rewrite: string; readonly topScore: number };
  /** What the hiker wants, when intent is on. */
  readonly intent?: Intent;
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

export async function ask(
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
    const card = await cardByTitle(lc.condition.card);
    if (card === undefined) return undefined;
    // A question in the middle of a condition is about it when it names the
    // body, the wound or the care: "should i prop my leg up on my pack" after
    // the hiker's own snakebite. Any question was too broad: "how do i figure
    // out which way to go" after a cold night got the hypothermia card (phone,
    // 2026-09-30).
    // Never for a medicine or a procedure: "what blood type can I give them?"
    // after heavy bleeding got the bleeding card (conversation set, #101).
    if (MEDICINE_OR_PROCEDURE.test(q)) return undefined;
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
  let candidates = await retrieve(keywords, routed.packIds, store, backend, retrievalOpts, routed.domains, searched);
  // The best score, not the first chunk's: a reserved field card goes first
  // and may score below the top manual passage (retrieve.ts).
  const best = (cs: readonly ScoredChunk[]): number => cs.reduce((m, c) => Math.max(m, c.score), 0);
  let topScore = best(candidates);

  // Conversation memory: search the follow-up joined to the previous question
  // too, and keep whichever scores higher.
  let followUp: { standaloneTopScore: number; joinedTopScore: number; used: boolean } | undefined;
  let standalone = candidates;
  // Memory applies only after a question Fred could answer: a follow-up to a
  // declined question has no topic to build on. With a knot question that
  // itself fell under the gate as the opener, "what's the capital of France?"
  // was turned into a request for the hiker's state.
  if (opts.previous !== undefined && opts.previous.topScore >= effectiveThreshold) {
    const joined = `${opts.previous.question} ${query}`;
    const keywordsJ = extractKeywords(joined);
    const routedJ = route(keywordsJ, packs, {
      state: opts.state,
      ...(opts.allowRoutingFallback === true ? { allowFallback: true } : {}),
    });
    const candidatesJ = await retrieve(keywordsJ, routedJ.packIds, store, backend, retrievalOpts, routedJ.domains, joined);
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
    // Memory exists to answer: a joined search that still falls under the gate
    // must not change how Fred declines (into a location request, say, from the
    // joined query's routing). None of the 29 measured follow-ups needed it.
    const answers = joinedTop >= effectiveThreshold;
    followUp = {
      standaloneTopScore: topScore, joinedTopScore: joinedTop,
      used: joinedTop > topScore && keepsAlone && staysOnTopic && answers,
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
    const cs = await retrieve(kw, packIds, store, backend, retrievalOpts, domains, text);
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

  let secondSearch: { rewrite: string; topScore: number } | undefined;
  if (opts.secondSearch === true && topScore < effectiveThreshold) {
    let rewrite = '';
    for await (const tok of backend.generate(buildRewriteParts(query), { maxTokens: 80, temperature: 0 })) rewrite += tok;
    rewrite = rewrite.trim();
    const keywords2 = extractKeywords(`${query} ${rewrite}`);
    const routed2 = route(keywords2, packs, { state: opts.state, ...(opts.allowRoutingFallback === true ? { allowFallback: true } : {}) });
    const candidates2 = await retrieve(keywords2, routed2.packIds, store, backend, retrievalOpts, routed2.domains, rewrite);
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
  let offer: CardOffer | undefined;
  const reserve = retrievalOpts.reserve;
  const isCard = (c: ScoredChunk): boolean => reserve !== undefined && c.chunk.packId === reserve.packId && c.chunk.audience !== 'provider';
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
  const explaining = setHere.find((c) => c.explains === true);
  const explainCard = explaining === undefined ? undefined : await cardByTitle(explaining.card);
  let understood: UnderstoodDiag | undefined;
  let u: Understood | undefined;
  // The request's search's leading card, for the agreement rule below.
  let requestCard: ScoredChunk | undefined;
  let agreedCard: ScoredChunk | undefined;
  // The leading card of the hiker's own thread, searched as one text.
  let threadCard: ScoredChunk | undefined;
  if (opts.intent === true) {
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
    if (guardsOn && intent === 'chat' && asksSomething(query)) {
      intent = 'question';
      if (u !== undefined && u.intent === 'chat') u = { ...u, intent };
    }
    // A message that says something happened to someone (a condition,
    // conditions.ts) is not small talk either: "my son brushed his arm on the
    // camp stove grate" was CHAT and got "Got it" (confirmation chat set).
    if (guardsOn && intent === 'chat' && setHere.length > 0 && !saysResolved(query) && !petIsPatient(query)) {
      intent = 'now';
      if (u !== undefined && u.intent === 'chat') u = { ...u, intent };
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
      candidates = await retrieve(keywords, routed.packIds, store, backend, retrievalOpts, routed.domains, searchText);
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
    // An emergency that found nothing, and no card to fall back on, is read
    // again in plain words: "uhh dude there's a bear in front of me".
    const noTipsPool = (): readonly RoutablePack[] => packs.filter((p) => !tipsPackIds.has(p.id));
    if (understandOn && u === undefined && intent === 'now' && topScore < effectiveThreshold &&
        leadingCard(candidates, isCard) === undefined && !ABOUT_A_PET.test(query)) {
      u = await understandMessage(query, history, backend, opts.signal);
      if (u !== undefined && u.intent === undefined) u = { ...u, intent: await classifyIntent(u.request, backend, opts.signal) };
      if (u?.intent === 'out') intent = 'question';
    }
    if (u !== undefined && u.intent !== 'out' && u.intent !== 'chat') {
      // Search the request. An emergency keeps to first aid, as above.
      const pool = intent === 'now' ? noTipsPool() : packs;
      const kwR = extractKeywords(u.request);
      let routedR = route(kwR, pool, { state: opts.state, ...(opts.allowRoutingFallback === true ? { allowFallback: true } : {}) });
      let candR = await retrieve(kwR, routedR.packIds, store, backend, retrievalOpts, routedR.domains, u.request);
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
        const candO = await retrieve(kwO, ids, store, backend, { ...retrievalOpts, topK: UNDERSTOOD_OWN_TOPK }, domains, own);
        const ranked = [...candO].sort((a, b) => b.score - a.score);
        const at = topR === undefined ? -1 : ranked.findIndex((c) => c.chunk.id === topR.chunk.id);
        if (at >= 0) { ownScore = ranked[at]!.score; ownRank = at; }
        threadCard = leadingCard(candO, isCard) ?? clearlyLeadingCard(candO, isCard);
      }
      // Kept when it clears the own-words floor or, with guards on, ranks
      // near the top for the hiker's own words.
      const used = clears && ownScore !== undefined && (
        ownScore >= (opts.understandOwnFloor ?? UNDERSTOOD_OWN_FLOOR) ||
        (guardsOn && ownRank !== undefined && ownRank < (opts.understandOwnTop ?? UNDERSTOOD_OWN_TOP)));
      requestCard = leadingCard(candR, isCard);
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
    const topCard = leadingCard(candidates, isCard);
    // Only an emergency forces a card open under the gate. Forcing it for any
    // question too opened the cuts card for "talk me through stitching a cut
    // closed" on the tuning set. And a pet is never the patient: veterinary
    // care is out of scope, and "my dog cut his paw" opened the human card.
    if (guardsOn && explainCard !== undefined && intent !== 'prevent' && !ABOUT_A_PET.test(query)) forcedCard = agreedCard = explainCard;
    else if (topCard !== undefined && intent === 'now' && !ABOUT_A_PET.test(query)) forcedCard = topCard;
    // #101: a message that says what happened opens that condition's card when
    // it leads, even read as a question: "i think im lost" led with the lost
    // card at 0.252 and only offered it, folded under "I don't have reliable
    // information on that".
    else if (guardsOn && topCard !== undefined && setHere.some((c) => c.card === topCard.chunk.section) && !ABOUT_A_PET.test(query)) forcedCard = agreedCard = topCard;
    // Round 2: two searches agreeing beat one score. An emergency whose card
    // leads the hiker's own search, but under the card floor, opens it when
    // the understanding step's request, searched on its own, puts the same
    // card first. "ok it left. my kid just burned her hand on the stove": the
    // burns card led at 0.139, under 0.15, and the request found it too
    // (phone, 2026-09-30); Fred showed the safety net.
    else if (guardsOn && topCard === undefined && intent === 'now' && !ABOUT_A_PET.test(query)) {
      const own = candidates.filter(isCard).reduce<ScoredChunk | undefined>((b, c) => (b === undefined || c.score > b.score ? c : b), undefined);
      if (own !== undefined && own.score >= AGREED_CARD_FLOOR && requestCard !== undefined &&
          requestCard.score >= AGREED_REQUEST_FLOOR && own.chunk.id === requestCard.chunk.id && ownCard(own) !== undefined) {
        forcedCard = agreedCard = own;
      } else if ((lastShown !== undefined || threadCard !== undefined) && topScore < AGREED_CARD_FLOOR && !MEDICINE_OR_PROCEDURE.test(query) &&
          (query.trim().split(/\s+/).length <= THREAD_CARD_WORDS || asksSomething(query))) {
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
        if (card !== undefined) forcedCard = agreedCard = card;
      }
    }
    // A short question with nothing of its own takes its thread's card too:
    // "we lost the trail a while ago" / "sun is setting" / "what now" was read
    // as a question and declined (confirmation chat set).
    else if (guardsOn && topCard === undefined && intent === 'question' && !ABOUT_A_PET.test(query)) {
      const said = setHere[0];
      if ((lastShown !== undefined || threadCard !== undefined) && topScore < AGREED_CARD_FLOOR && !MEDICINE_OR_PROCEDURE.test(query) &&
          (query.trim().split(/\s+/).length <= THREAD_CARD_WORDS || asksSomething(query))) {
        forcedCard = agreedCard = lastShown ?? ownCard(threadCard);
      } else if (said !== undefined && topScore < effectiveThreshold) {
        // "splashed hot coffee all over my wrist" was read as a question and
        // declined; the message says what happened, and that card answers it.
        const card = await cardByTitle(said.card);
        if (card !== undefined) forcedCard = agreedCard = card;
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
    else if (topCard !== undefined && !ABOUT_A_PET.test(query)) offer = toOffer(topCard, citeOf(topCard, 0));
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
  const petPatient = guardsOn && petIsPatient(query, opts.history?.at(-1));

  // A card must never be shown, open or folded, after a condition it is not
  // for (conditions.ts). A folded offer becomes the condition's own card.
  let blocked: { card: string; condition: string } | undefined;
  if (offer !== undefined) {
    const by = blockingCondition(offer.title, active);
    const instead = by === undefined ? undefined : await cardByTitle(by.card);
    if (by !== undefined) {
      blocked = { card: offer.title, condition: by.id };
      offer = instead === undefined ? undefined : toOffer(instead, citeOf(instead, 0));
    }
  }

  const baseDiag = {
    ...(intent === undefined ? {} : { intent }),
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
    if (card !== undefined) { forcedCard = agreedCard = card; intent = 'question'; }
  }

  if (intent === 'chat') {
    return {
      kind: 'chat', reply: offer === undefined ? CHAT_REPLY : CHAT_REPLY_WITH_OFFER, offer: offer ?? null,
      diagnostics: { ...baseDiag, candidates, topScore, tokensBefore: 0, tokensAfter: 0, contextReduction: 0 },
    };
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
  // #101: an update on what Fred just showed a card for ("its swelling pretty
  // bad" after the sprain card) that would be declined or get the watch
  // reply stays on that card, unless it names something new (setHere).
  if (forcedCard === undefined && lastShown !== undefined && setHere.length === 0 && !petPatient &&
      (candidates.length === 0 || topScore < effectiveThreshold) &&
      (leansBack(query) || SYMPTOM_UPDATE.test(query))) {
    forcedCard = agreedCard = lastShown;
  }

  if (forcedCard === undefined && (candidates.length === 0 || topScore < effectiveThreshold)) {
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
    if (understandOn && intent === 'now' && !ABOUT_A_PET.test(query)) {
      const danger = !guardsOn || dangerSign([...history, query]);
      return {
        kind: 'abstain', reason: danger ? 'safety-net' : 'watch', nearest: candidates.slice(0, 2).map(toCitation), diagnostics: weak,
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
    return {
      kind: 'abstain', reason: 'low-score', nearest: candidates.slice(0, 2).map(toCitation), diagnostics: weak,
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
  let usable = tipsInTrustOrder(candidates.filter((c) => c.chunk.audience !== 'provider'));

  const cardMode = opts.cardAnswer ?? 'verbatim';
  let clear = forcedCard ?? clearCard(usable, retrievalOpts.reserve);
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
  if (followUp?.used === true && clear !== undefined &&
      clearCard(standalone, retrievalOpts.reserve)?.chunk.id !== clear.chunk.id) {
    clear = undefined;
  }
  // Round 2: a card that must not follow a condition is never shown
  // (conditions.ts). "its on his ankle and swelling" after a snakebite opened
  // the sprain card (ice, wrap, raise) on the phone. Fred shows the
  // condition's own card and asks, so a separate injury is a tap away.
  if (clear !== undefined) {
    const by = blockingCondition(clear.chunk.section, active);
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
    usable = usable.filter((c) => !isCard(c) || blockingCondition(c.chunk.section, active) === undefined);
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
      const picked = matchCardLines(await queryVector(backend, query), parsed, store.cardLineVectorsFor?.(card.chunk.id));
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
  const onCard = followed ?? lastShown;
  if (guardsOn && opts.lead !== false && onCard !== undefined && asksSpecifically(query) && !petPatient && cardMode === 'verbatim') {
    const parsedOn = parseCard(onCard.chunk.text);
    const lines = cardLines(parsedOn);
    const picked = matchCardLines(await queryVector(backend, query), parsedOn, store.cardLineVectorsFor?.(onCard.chunk.id));
    if (picked.length > 0) {
      return {
        kind: 'answer',
        stream: once([parsedOn.summary, ...picked.slice(0, 2).map((i) => lines[i]!)].join('\n')),
        citations: [citeOf(onCard, 0)],
        prompt: { system: '', user: '' },
        medical: MEDICAL_DOMAINS.has(onCard.chunk.domain),
        card: toOffer(onCard, citeOf(onCard, 0)),
        diagnostics: { ...baseDiag, candidates, topScore, sufficient: null, tokensBefore: 0, tokensAfter: 0, contextReduction: 0, cardAnswer: cardMode },
      };
    }
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
  const prompt = buildPromptParts(query, blocks, opts.answerVariant, place, earlier, opts.shapeVariant);
  const generateOpts = opts.signal
    ? { maxTokens, signal: opts.signal }
    : { maxTokens };

  // Round 2: while a condition is active, a model-written answer is read in
  // full before it is shown, and one that gives advice the condition's card
  // says not to give is replaced by that card (conditions.ts). Streaming is
  // given up only then.
  const watched = active.filter((c) => c.forbidden !== undefined);
  const guardCard = async (text: string): Promise<string> => {
    // A refusal in the middle of a condition is a dead end too.
    if (isRefusal(text) && followed !== undefined) {
      answerGuard.replacedBy = 'refusal';
      return renderCard(parseCard(followed.chunk.text));
    }
    const by = violatedCondition(text, watched);
    if (by === undefined) return text;
    const card = await cardByTitle(by.card);
    if (card === undefined) return text;
    answerGuard.replacedBy = by.id;
    return renderCard(parseCard(card.chunk.text));
  };
  const answerGuard: { replacedBy?: string } = {};
  // Only advice a condition forbids needs the whole answer read first. A
  // refusal in the middle of a condition is caught from its first words, so
  // everything else still streams: holding every answer in a "lost" chat
  // took the first words to 27.7 s on the phone (#101).
  const refusalOnly = (async function* () {
    const refusal = NO_ANSWER_REPLY.toLowerCase();
    let head = '';
    let streaming = false;
    for await (const tok of backend.generate(prompt, generateOpts)) {
      if (streaming) { yield tok; continue; }
      head += tok;
      const h = head.trimStart().toLowerCase();
      if (!refusal.startsWith(h.slice(0, refusal.length)) || h.length > refusal.length + 4) { streaming = true; yield head; }
    }
    if (!streaming) yield await guardCard(head);
  })();
  // #103: checked sentence by sentence, so the first words come with the
  // first sentence instead of the whole answer (19 s on the phone, #101).
  const stream = watched.length > 0
    ? streamChecked(backend.generate(prompt, generateOpts), {
      violates: (sentence) => violatedCondition(sentence, watched),
      holdsFirst: (sentence) => followed !== undefined && isRefusal(sentence),
      replace: async (by, shownAlready) => {
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
    : followed !== undefined ? refusalOnly : backend.generate(prompt, generateOpts);

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
      ...(watched.length === 0 ? {} : { answerGuard }),
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
): ScoredChunk | undefined {
  if (reserve === undefined) return undefined;
  const top = (cs: readonly ScoredChunk[]): ScoredChunk | undefined =>
    cs.reduce<ScoredChunk | undefined>((b, c) => (b === undefined || c.score > b.score ? c : b), undefined);
  const card = top(cands.filter((c) => c.chunk.packId === reserve.packId && c.chunk.audience !== 'provider'));
  if (card === undefined) return undefined;
  const manual = top(cands.filter((c) => c.chunk.packId !== reserve.packId));
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
  };
}
