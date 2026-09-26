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
 * Routing narrows the search. It may never empty it.
 *
 * This file has now been through the full arc. It began searching first aid for
 * every unrecognised query; the graded eval priced that badly (13 of 19
 * uncoverable questions answered, docs/results-akr2.md) and the fallback was
 * removed; removing it bought +20.6 points and looked like the best change of
 * the project. Then the held-out set showed what those points were: the lexicon
 * had been extended until it covered the tuning questions' vocabulary. It
 * reaches 46/46 answerable questions on the set it was built from and 16/31 on
 * questions it has never seen (docs/results-holdout.md).
 *
 * The measurement that settles it: searching every pack on the device with no
 * routing at all costs **1.88 ms**, against a 14,700 ms answer. The phone holds
 * four packs and 7,413 chunks. The narrowing this function exists to provide is
 * worth 0.013% of one answer, and it was costing 15 of 31 questions.
 *
 * So routing survives as a hint, not a gate. When vocabulary matches, the search
 * narrows and keeps its precision. When it does not, everything is searched and
 * the abstention gate decides on evidence — which is also what the production
 * study in docs/results-accuracy-research-2.md found, where a post-retrieval
 * cascade with no training beat every pre-retrieval router 72.2% to 13-38%.
 *
 * The invariant is now structural rather than advisory: `packIds` is empty only
 * when no pack is available at all.
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

  if (entries.length === 0) {
    // Vocabulary told us nothing. That is a statement about the lexicon, not
    // about the query, so it is not grounds for refusing to look.
    fallback = true;
    domains = [...DOMAIN_TAGS];
    reason = 'no domain vocabulary matched; searching everything';
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
        // Only counts as "gated on location" when real vocabulary put us here.
        // On the fallback path every domain is wanted, so every state pack
        // would qualify and "what is the capital of France?" would come back
        // as "which state are you in?" — speculation dressed up as evidence.
        // And only when the location is unknown: with the hiker in California,
        // Oregon's pack is not waiting on a location, and counting it turned
        // low-scoring California questions ("birds eat salmonberries, are they
        // OK for people?") into "which state are you in?".
        if (!fallback && ctx.state === null) skippedForState.push(pack.id);
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

  // The matched domains resolved to state packs only, and those were skipped.
  // Widening rather than returning nothing is what stops "why do people make
  // such a fuss about ticks?" becoming "which state are you in?" — tick maps to
  // wildlife, no core pack declares wildlife, and core-survival p.47 answers it
  // without caring where the reader is standing. skippedStatePacks stays
  // populated, so the pipeline can still ask for a location if the widened
  // search turns up nothing worth saying.
  if (selected.length === 0) {
    const widenedDomains = new Set<DomainTag>();
    for (const pack of available) {
      if (pack.scope.kind === 'us-state') continue;
      selected.push(pack.id);
      for (const d of pack.domains) widenedDomains.add(d);
    }
    if (selected.length > 0) {
      fallback = true;
      // The domains have to widen with the packs. Stage 1 filters candidates by
      // `domains` (retrieve.ts), so widening the pack list alone selects the
      // core packs and then discards every chunk in them: "tick" wants wildlife,
      // core-survival's chunks are tagged survival, and retrieval comes back
      // empty with U=0. That shipped for one eval run and cost three questions.
      domains = [...new Set([...domains, ...widenedDomains])];
      reason += '; widened to unscoped packs and their domains';
    }
  }

  return { packIds: selected, domains, scores, skippedStatePacks: skippedForState, fallback, reason };
}

/** Domains with no vocabulary at all — a lexicon coverage check for tests. */
export function domainsWithoutVocabulary(): DomainTag[] {
  return (Object.keys(DOMAIN_LEXICON) as DomainTag[]).filter(
    (d) => (DOMAIN_LEXICON[d]?.length ?? 0) === 0,
  );
}
