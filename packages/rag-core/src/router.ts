/**
 * Pack routing: decide which packs a query should search.
 *
 * Keyword heuristics over the shared DOMAIN_LEXICON — fast, deterministic, and
 * inspectable in the debug overlay. An SLM-based router is a reasonable ablation
 * later, but it costs a generation pass on the critical path, which is exactly
 * what the latency work is trying to protect.
 */
import { DOMAIN_TAGS, type DomainTag, type PackScope } from '@fred/pack-format';
import { DOMAIN_LEXICON, domainsForTerm, type Keyword } from './lexicon.ts';

/** The routing-relevant subset of a pack manifest. */
export interface RoutablePack {
  readonly id: string;
  readonly domains: readonly DomainTag[];
  readonly scope: PackScope;
}

export interface RouteContext {
  /** USPS code resolved from last known location, or chosen manually. */
  readonly state: string | null;
  /**
   * Search every domain when no vocabulary matches, instead of declining.
   *
   * Off by default. The held-out eval showed declining on no-match refuses 15
   * of 31 answerable questions, against 0 of 46 on the set the lexicon was
   * built from (docs/results-holdout.md) — so the no-match rule is measuring
   * the lexicon's vocabulary, not the query's scope. This exists to measure
   * what a fallback recovers; the pipeline raises its threshold when it fires.
   */
  readonly allowFallback?: boolean;
}

export interface RouteResult {
  readonly packIds: readonly string[];
  readonly domains: readonly DomainTag[];
  readonly scores: Readonly<Partial<Record<DomainTag, number>>>;
  /**
   * State-scoped packs that matched the query's domains but were excluded because
   * the location is unresolved or is a different state. Non-empty here means the
   * right answer probably exists but is gated on location — the pipeline turns
   * this into a "pick your state" prompt rather than a generic "I don't know".
   */
  readonly skippedStatePacks: readonly string[];
  /** True when no vocabulary matched and every domain was searched anyway. */
  readonly fallback: boolean;
  /** Human-readable explanation, surfaced in the debug overlay. */
  readonly reason: string;
}

/**
 * There is no fallback. A query matching no domain vocabulary is not searched.
 *
 * This used to search first aid and survival anyway, on the reasoning that "the
 * cost of over-searching is latency; the cost of under-searching is a missed
 * answer when it matters most". The graded eval priced that trade properly: the
 * cost of over-searching was answering "how do I perform a cricothyrotomy", "how
 * deep can I dive before I need a decompression stop" and "is it going to rain
 * tomorrow" — 13 of 19 questions no pack covers (docs/results-akr2.md).
 *
 * The reasoning was sound about the risk, though, and removing the fallback
 * blindly would have refused eight genuine questions, including "my friend is
 * shivering uncontrollably and confused after falling in a cold creek" — a
 * hypothermia emergency described without a single clinical word. So the lexicon
 * was extended with lay vocabulary first: body parts, described symptoms,
 * terrain. Measured over the graded set after that, declining on no-match
 * refuses 0 of 46 answerable questions and correctly declines 12 of 22.
 *
 * The invariant to preserve: before narrowing this further, check the answerable
 * side of the graded set, not just the decline side.
 */

/** A domain must reach this share of the top domain's score to be searched. */
const RELATIVE_THRESHOLD = 0.4;

export function scoreDomains(
  keywords: readonly Keyword[],
): Partial<Record<DomainTag, number>> {
  const scores: Partial<Record<DomainTag, number>> = {};
  for (const kw of keywords) {
    for (const domain of domainsForTerm(kw.term)) {
      scores[domain] = (scores[domain] ?? 0) + kw.weight;
    }
  }
  return scores;
}

export function route(
  keywords: readonly Keyword[],
  available: readonly RoutablePack[],
  ctx: RouteContext,
): RouteResult {
  const scores = scoreDomains(keywords);
  const entries = Object.entries(scores) as [DomainTag, number][];

  let domains: DomainTag[];
  let reason: string;

  let fallback = false;

  if (entries.length === 0 && ctx.allowFallback !== true) {
    // Nothing recognisable: decline rather than guess. Returning no domains also
    // leaves skippedStatePacks empty, so the pipeline abstains instead of asking
    // for a location it has no use for.
    return {
      packIds: [],
      domains: [],
      scores,
      skippedStatePacks: [],
      fallback: false,
      reason: 'no domain vocabulary matched; out of scope',
    };
  } else if (entries.length === 0) {
    // Vocabulary told us nothing, so let retrieval decide on the evidence. The
    // pipeline demands a higher score before answering on this path.
    fallback = true;
    domains = [...DOMAIN_TAGS];
    reason = 'no domain vocabulary matched; searching everything on a raised bar';
  } else {
    const top = Math.max(...entries.map(([, v]) => v));
    domains = entries
      .filter(([, v]) => v >= top * RELATIVE_THRESHOLD)
      .sort((a, b) => b[1] - a[1])
      .map(([d]) => d);
    reason = `matched ${domains.join(', ')}`;
  }

  const wanted = new Set(domains);
  const selected: string[] = [];
  const skippedForState: string[] = [];

  for (const pack of available) {
    if (!pack.domains.some((d) => wanted.has(d))) continue;
    if (pack.scope.kind === 'us-state') {
      // A state pack is only meaningful for the state the user is actually in.
      // Searching Colorado wildlife in Ohio is worse than returning nothing.
      if (ctx.state === null || pack.scope.state !== ctx.state) {
        skippedForState.push(pack.id);
        continue;
      }
    }
    selected.push(pack.id);
  }

  if (skippedForState.length > 0) {
    reason += ctx.state === null
      ? '; skipped state packs (location unresolved)'
      : `; skipped state packs outside ${ctx.state}`;
  }

  return { packIds: selected, domains, scores, skippedStatePacks: skippedForState, fallback, reason };
}

/** Domains with no vocabulary at all — a lexicon coverage check for tests. */
export function domainsWithoutVocabulary(): DomainTag[] {
  return (Object.keys(DOMAIN_LEXICON) as DomainTag[]).filter(
    (d) => (DOMAIN_LEXICON[d]?.length ?? 0) === 0,
  );
}
