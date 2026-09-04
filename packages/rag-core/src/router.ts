/**
 * Pack routing: decide which packs a query should search.
 *
 * Keyword heuristics over the shared DOMAIN_LEXICON — fast, deterministic, and
 * inspectable in the debug overlay. An SLM-based router is a reasonable ablation
 * later, but it costs a generation pass on the critical path, which is exactly
 * what the latency work is trying to protect.
 */
import type { DomainTag, PackScope } from '@fred/pack-format';
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
  /** Human-readable explanation, surfaced in the debug overlay. */
  readonly reason: string;
}

/**
 * Domains always searched when the query gives no clear signal.
 *
 * Biased toward first aid on purpose: an unrecognized query during an emergency
 * should still reach medical content. The cost of over-searching is latency; the
 * cost of under-searching is a missed answer when it matters most.
 */
const FALLBACK_DOMAINS: readonly DomainTag[] = ['first-aid-physical', 'survival'];

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

  if (entries.length === 0) {
    domains = [...FALLBACK_DOMAINS];
    reason = 'no domain vocabulary matched; searching fallback domains';
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

  return { packIds: selected, domains, scores, skippedStatePacks: skippedForState, reason };
}

/** Domains with no vocabulary at all — a lexicon coverage check for tests. */
export function domainsWithoutVocabulary(): DomainTag[] {
  return (Object.keys(DOMAIN_LEXICON) as DomainTag[]).filter(
    (d) => (DOMAIN_LEXICON[d]?.length ?? 0) === 0,
  );
}
