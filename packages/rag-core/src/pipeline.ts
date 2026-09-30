/**
 * End-to-end query pipeline, tying together routing, hybrid retrieval, selective
 * context compression, the abstention gate, and generation.
 *
 * Pure orchestration — every platform-specific concern arrives through the
 * interfaces in backends.ts, so this exact code path runs both on device and in
 * tools/eval.
 */
import type { InferenceBackend, MemoryMonitor, PackStore } from './backends.ts';
import type { CardSource } from '@fred/pack-format';
import { compressContext } from './compress.ts';
import { extractKeywords, type Keyword } from './lexicon.ts';
import { buildPromptParts, buildRewriteParts, buildSufficiencyParts, readSufficiency, CHAT_REPLY, CHAT_REPLY_WITH_OFFER, type ContextBlock, type PromptParts, type SufficiencyVariant, type AnswerVariant, type ShapeVariant } from './prompt.ts';
import { retrieve, DEFAULT_RETRIEVAL, type RetrievalOptions, type ScoredChunk } from './retrieve.ts';
import { classifyIntent, type Intent } from './intent.ts';
import { understandMessage, UNDERSTAND_HISTORY, type Understood } from './understand.ts';
import { joinNeighbours } from './join.ts';
import { route, type RoutablePack, type RouteResult } from './router.ts';
import { buildPickParts, parseCard, pickChoice, readPick, renderCard, renderCardSteps } from './card-answer.ts';
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
   * or not. Read only by the understanding step (#98).
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

type UnderstoodDiag = NonNullable<Diagnostics['understood']>;

/** The best field card, if it leads the search closely enough to answer an emergency. */
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
    readonly used: boolean;
  };
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
   * nothing, and the app shows SAFETY_NET_REPLY instead of a dead end.
   * 'out-of-scope': the understanding step read it as outside Fred's scope.
   */
  | {
      readonly kind: 'abstain';
      readonly reason: 'low-score' | 'insufficient' | 'provider-only' | 'safety-net' | 'out-of-scope';
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
  const { backend, store, packs, memory } = deps;
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
  const tipsPackIds = new Set(packs.filter((p) => p.domains.includes('outdoor-skills')).map((p) => p.id));
  const threshold = opts.abstainThreshold ?? DEFAULT_ABSTAIN_THRESHOLD;

  const pressure = memory?.pressure() ?? 0;
  const maxTokens = maxTokensForPressure(pressure);

  let keywords = extractKeywords(query);
  let routed = route(keywords, packs, {
    state: opts.state,
    ...(opts.allowRoutingFallback === true ? { allowFallback: true } : {}),
  });
  let effectiveThreshold = routed.fallback
    ? (opts.fallbackThreshold ?? DEFAULT_FALLBACK_THRESHOLD)
    : threshold;


  // The text the adopted search was run on: the question, or it joined to the
  // previous one, or restated (below).
  let searchText = query;
  let candidates = await retrieve(keywords, routed.packIds, store, backend, retrievalOpts, routed.domains, query);
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
  const history = (opts.history ?? []).filter((h) => h.trim() !== '');
  const understandOn = opts.understand !== false;
  let understood: UnderstoodDiag | undefined;
  let u: Understood | undefined;
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
      const clears = topR !== undefined && (topR.score >= effectiveThreshold ||
        (intent === 'now' && leadingCard(candR, isCard) !== undefined));
      // What the request found must also match what the hiker actually said.
      // The request is the model's words; phase 3 showed the model makes any
      // question sound like a manual. Search the hiker's own messages over
      // every pack the request could reach, and look for the same passage.
      let ownScore: number | undefined;
      if (clears) {
        const own = [...history.slice(-UNDERSTAND_HISTORY), query].join(' ');
        const kwO = extractKeywords(own);
        const ids = [...new Set([...routedR.packIds, ...pool.filter((p) => p.scope.kind !== 'us-state').map((p) => p.id)])];
        const domains = [...new Set([...routedR.domains, ...pool.filter((p) => ids.includes(p.id)).flatMap((p) => p.domains)])];
        const candO = await retrieve(kwO, ids, store, backend, { ...retrievalOpts, topK: UNDERSTOOD_OWN_TOPK }, domains, own);
        ownScore = candO.find((c) => c.chunk.id === topR.chunk.id)?.score;
      }
      const used = clears && ownScore !== undefined && ownScore >= (opts.understandOwnFloor ?? UNDERSTOOD_OWN_FLOOR);
      understood = { intent: u.intent, request: u.request, ...(topR === undefined ? {} : { topScore: topR.score }), ...(ownScore === undefined ? {} : { ownScore }), used };
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
    if (topCard !== undefined && intent === 'now' && !ABOUT_A_PET.test(query)) forcedCard = topCard;
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

  const baseDiag = {
    ...(intent === undefined ? {} : { intent }),
    keywords,
    route: routed,
    maxTokens,
    memoryPressure: pressure,
    ...(widenedTopScore === undefined ? {} : { widenedTopScore }),
    ...(understood === undefined ? {} : { understood }),
    ...(secondSearch === undefined ? {} : { secondSearch }),
    ...(followUp === undefined ? {} : { followUp }),
  };

  if (intent === 'chat') {
    return {
      kind: 'chat', reply: offer === undefined ? CHAT_REPLY : CHAT_REPLY_WITH_OFFER, offer: offer ?? null,
      diagnostics: { ...baseDiag, candidates, topScore, tokensBefore: 0, tokensAfter: 0, contextReduction: 0 },
    };
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
    if (understandOn && intent === 'now' && !ABOUT_A_PET.test(query)) {
      return {
        kind: 'abstain', reason: 'safety-net', nearest: candidates.slice(0, 2).map(toCitation), diagnostics: weak,
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
  const usable = tipsInTrustOrder(candidates.filter((c) => c.chunk.audience !== 'provider'));

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

  return {
    kind: 'answer',
    stream: backend.generate(prompt, generateOpts),
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
    },
  };
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
