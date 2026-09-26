/**
 * End-to-end query pipeline, tying together routing, hybrid retrieval, selective
 * context compression, the abstention gate, and generation.
 *
 * Pure orchestration — every platform-specific concern arrives through the
 * interfaces in backends.ts, so this exact code path runs both on device and in
 * tools/eval.
 */
import type { InferenceBackend, MemoryMonitor, PackStore } from './backends.ts';
import { compressContext } from './compress.ts';
import { extractKeywords, type Keyword } from './lexicon.ts';
import { buildPromptParts, buildRewriteParts, buildSufficiencyParts, readSufficiency, type ContextBlock, type PromptParts, type SufficiencyVariant, type AnswerVariant } from './prompt.ts';
import { retrieve, DEFAULT_RETRIEVAL, type RetrievalOptions, type ScoredChunk } from './retrieve.ts';
import { route, type RoutablePack, type RouteResult } from './router.ts';
import { buildPickParts, parseCard, readPick, renderCard } from './card-answer.ts';
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
   * message is searched alone and joined to this; the higher-scoring search
   * wins, so a change of topic keeps the standalone result. Only when the
   * joined search wins does the model see the earlier question. Absent, ask()
   * behaves exactly as it does for a single question.
   */
  readonly previous?: { readonly question: string };
  /** Show the model the earlier question when the joined search wins. Default on. */
  readonly previousInPrompt?: boolean;
}

export type CardAnswerMode = 'off' | 'verbatim' | 'card-only' | 'pick';

/**
 * A card below the reserved-slot bar still counts as a clear match when it
 * outscores every manual passage and clears this floor. On the tuning set the
 * right card sat at 0.338-0.340 on top for burns, cuts and boil-less water,
 * while the highest-scoring wrong card (choking, for a chest wound) was 0.308
 * and below a manual passage (docs/results-phase3.md).
 */
export const CARD_TOP_FLOOR = 0.32;

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
  /** The manual-wording restatement, when a second search ran, and what it scored. */
  readonly secondSearch?: { readonly rewrite: string; readonly topScore: number };
  /** Conversation memory: both searches' top scores, and whether the joined one won. */
  readonly followUp?: { readonly standaloneTopScore: number; readonly joinedTopScore: number; readonly used: boolean };
  /** Set when the answer was built from a field card rather than the passages. */
  readonly cardAnswer?: CardAnswerMode;
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
   * REFER_REPLY rather than "I don't know".
   */
  | {
      readonly kind: 'abstain';
      readonly reason: 'low-score' | 'insufficient' | 'provider-only';
      readonly nearest: readonly Citation[];
      readonly diagnostics: Diagnostics;
    };

const MEDICAL_DOMAINS = new Set(['first-aid-physical', 'first-aid-psychological']);

export async function ask(
  query: string,
  deps: PipelineDeps,
  opts: AskOptions,
): Promise<AskResult> {
  const { backend, store, packs, memory } = deps;
  const retrievalOpts = opts.retrieval ?? DEFAULT_RETRIEVAL;
  const threshold = opts.abstainThreshold ?? DEFAULT_ABSTAIN_THRESHOLD;

  const pressure = memory?.pressure() ?? 0;
  const maxTokens = maxTokensForPressure(pressure);

  let keywords = extractKeywords(query);
  let routed = route(keywords, packs, {
    state: opts.state,
    ...(opts.allowRoutingFallback === true ? { allowFallback: true } : {}),
  });
  const effectiveThreshold = routed.fallback
    ? (opts.fallbackThreshold ?? DEFAULT_FALLBACK_THRESHOLD)
    : threshold;


  let candidates = await retrieve(keywords, routed.packIds, store, backend, retrievalOpts, routed.domains, query);
  // The best score, not the first chunk's: a reserved field card goes first
  // and may score below the top manual passage (retrieve.ts).
  const best = (cs: readonly ScoredChunk[]): number => cs.reduce((m, c) => Math.max(m, c.score), 0);
  let topScore = best(candidates);

  // Conversation memory: search the follow-up joined to the previous question
  // too, and keep whichever scores higher.
  let followUp: { standaloneTopScore: number; joinedTopScore: number; used: boolean } | undefined;
  let standalone = candidates;
  if (opts.previous !== undefined) {
    const joined = `${opts.previous.question} ${query}`;
    const keywordsJ = extractKeywords(joined);
    const routedJ = route(keywordsJ, packs, {
      state: opts.state,
      ...(opts.allowRoutingFallback === true ? { allowFallback: true } : {}),
    });
    const candidatesJ = await retrieve(keywordsJ, routedJ.packIds, store, backend, retrievalOpts, routedJ.domains, joined);
    const joinedTop = best(candidatesJ);
    followUp = { standaloneTopScore: topScore, joinedTopScore: joinedTop, used: joinedTop > topScore };
    standalone = candidates;
    if (followUp.used) {
      keywords = keywordsJ;
      routed = routedJ;
      candidates = candidatesJ;
      topScore = joinedTop;
    }
  }
  const earlier = followUp?.used === true && opts.previousInPrompt !== false ? opts.previous!.question : undefined;

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
      topScore = secondSearch.topScore;
    }
  }

  const baseDiag = {
    keywords,
    route: routed,
    maxTokens,
    memoryPressure: pressure,
    ...(secondSearch === undefined ? {} : { secondSearch }),
    ...(followUp === undefined ? {} : { followUp }),
  };

  if (candidates.length === 0 || topScore < effectiveThreshold) {
    const weak = {
      ...baseDiag,
      candidates,
      topScore,
      tokensBefore: 0,
      tokensAfter: 0,
      contextReduction: 0,
    };
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
    return { kind: 'abstain', reason: 'low-score', nearest: candidates.slice(0, 2).map(toCitation), diagnostics: weak };
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
  if (!cardMatched && bestManual?.chunk.audience === 'provider') {
    return {
      kind: 'abstain',
      reason: 'provider-only',
      nearest: candidates.slice(0, 2).map(toCitation),
      diagnostics: { ...baseDiag, candidates, topScore, tokensBefore: 0, tokensAfter: 0, contextReduction: 0 },
    };
  }
  const usable = candidates.filter((c) => c.chunk.audience !== 'provider');

  const cardMode = opts.cardAnswer ?? 'verbatim';
  let clear = clearCard(usable, retrievalOpts.reserve);
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
    const common = { kind: 'answer' as const, citations: [toCitation(card, 0)], prompt, medical: MEDICAL_DOMAINS.has(card.chunk.domain), diagnostics };
    if (cardMode === 'card-only') {
      return { ...common, stream: backend.generate(prompt, opts.signal ? { maxTokens, signal: opts.signal } : { maxTokens }) };
    }
    if (cardMode === 'verbatim') {
      return { ...common, stream: once(renderCard(parsed)) };
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
    usable.map((c) => c.chunk),
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
  const prompt = buildPromptParts(query, blocks, opts.answerVariant, place, earlier);
  const generateOpts = opts.signal
    ? { maxTokens, signal: opts.signal }
    : { maxTokens };

  return {
    kind: 'answer',
    stream: backend.generate(prompt, generateOpts),
    citations: usable.map(toCitation),
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
