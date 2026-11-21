/**
 * Field cards: short, plain-language answers written from the manuals.
 *
 * Why they exist (docs/results-strategy-research.md §1i): handed the right
 * manual passage, the 1.7B model still turned 12 of 18 into wrong answers. It
 * mirrors what it reads, and what it reads is military doctrine written for
 * medics, cut into 300-token windows. A card is the same doctrine rewritten for
 * a hiker, in order, with the "don't" stated as a "don't". The model's job
 * shrinks from reading a manual to relaying an answer.
 *
 * The rule that makes a card trustworthy: every claim is backed by a verbatim
 * quote from a pack, and `validateCards` refuses any card whose quote is not
 * found in the source it names. Cards are written by a large model and reviewed
 * by a person before they ship; this check is what makes the review about
 * judgement rather than about catching invented facts.
 */
import type { DomainTag, LicenseEntry } from '@fred/pack-format';

export interface CardSource {
  readonly source: string;
  readonly page: number | null;
  /** Verbatim from the source, line breaks and all. Checked by validateCards. */
  readonly quote: string;
}

export interface FieldCard {
  readonly id: string;
  readonly title: string;
  readonly domain: DomainTag;
  readonly medical: boolean;
  /** Ways a hiker might ask. Embedded with the card, never shown. */
  readonly askedAs: readonly string[];
  readonly summary: string;
  readonly steps: readonly string[];
  readonly dont: readonly string[];
  readonly getHelp: string;
  /** For the reviewer: conflicts between sources, and choices made. */
  readonly reviewerNote: string;
  readonly sources: readonly CardSource[];
  /**
   * Sentences deliberately NOT backed by a manual quote, each with the reason
   * it is there ("call while you still have signal"). Kept separate so a
   * reviewer sees exactly which lines rest on judgement rather than on a
   * source, and so they can be counted and audited. Optional; most cards have
   * none.
   */
  readonly unsourced?: readonly { readonly text: string; readonly why: string }[];
}

export interface PassageText {
  readonly source: string;
  readonly page: number | null;
  readonly text: string;
}

export interface CardProblem {
  readonly cardId: string;
  readonly problem: string;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** How far a quote's page may be from the passage's first page. Chunks span pages. */
const PAGE_SLACK = 2;

/**
 * Every quote must appear in a passage from the named source, near the named
 * page. Also checks the shape a card needs to be useful at all.
 */
export function validateCards(cards: readonly FieldCard[], passages: readonly PassageText[]): CardProblem[] {
  const problems: CardProblem[] = [];
  const bySource = new Map<string, { page: number | null; text: string }[]>();
  for (const p of passages) {
    const list = bySource.get(p.source) ?? [];
    list.push({ page: p.page, text: norm(p.text) });
    bySource.set(p.source, list);
  }
  const ids = new Set<string>();
  for (const c of cards) {
    if (ids.has(c.id)) problems.push({ cardId: c.id, problem: 'duplicate id' });
    ids.add(c.id);
    if (c.steps.length === 0) problems.push({ cardId: c.id, problem: 'no steps' });
    if (c.sources.length === 0) problems.push({ cardId: c.id, problem: 'no sources' });
    if (c.askedAs.length === 0) problems.push({ cardId: c.id, problem: 'no askedAs phrasings' });
    for (const u of c.unsourced ?? []) {
      if (u.why.trim() === '') problems.push({ cardId: c.id, problem: `unsourced line with no reason: "${u.text.slice(0, 60)}"` });
    }
    for (const s of c.sources) {
      const candidates = bySource.get(s.source);
      if (candidates === undefined) {
        problems.push({ cardId: c.id, problem: `unknown source "${s.source}"` });
        continue;
      }
      const q = norm(s.quote);
      const near = candidates.filter((p) =>
        s.page === null || p.page === null || Math.abs(p.page - s.page) <= PAGE_SLACK);
      if (!near.some((p) => p.text.includes(q))) {
        const elsewhere = candidates.some((p) => p.text.includes(q));
        problems.push({
          cardId: c.id,
          problem: elsewhere
            ? `quote found in ${s.source} but not near p.${s.page}: "${s.quote.slice(0, 60)}"`
            : `quote not found in ${s.source}: "${s.quote.slice(0, 60)}"`,
        });
      }
    }
  }
  return problems;
}

/**
 * The text a card is indexed and read as. Plain sentences, "Don't" kept as a
 * word, and no numbering the model could echo as a paragraph reference.
 */
export function cardText(c: FieldCard): string {
  const lines = [c.title, c.summary, ...c.steps.map((s, i) => `${i + 1}. ${s}`)];
  if (c.dont.length > 0) lines.push(...c.dont);
  if (c.getHelp !== '') lines.push(c.getHelp);
  // An unsourced entry that only marks a line (or part of one) the card
  // already says is a provenance note, not a new line: reading it out
  // repeated the wildfire card's last lines and left a fragment (#268).
  const spoken = lines.join('\n');
  for (const u of c.unsourced ?? []) if (!spoken.includes(u.text)) lines.push(u.text);
  return lines.join('\n');
}

/** The `source` a card quote names when it quotes WHO BEC. */
export const WHO_BEC_SOURCE = 'WHO BEC 2018';

/**
 * The field-card pack's own licence entry. Cards paraphrase their sources, so
 * they take the strictest terms among the sources they quote: while any card
 * quotes WHO BEC (NonCommercial-ShareAlike) the pack is nonCommercial, and a
 * commercial bundle refuses it (scripts/build-core-bundle.mjs). Once every
 * WHO quote has been re-backed from public-domain sources (#214), the same
 * build gives a pack a commercial release can ship.
 */
export function cardsLicense(cards: readonly FieldCard[]): LicenseEntry {
  const who = cards.filter((c) => c.sources.some((q) => q.source === WHO_BEC_SOURCE)).map((c) => c.id);
  return who.length > 0
    ? {
        id: 'fred-field-cards',
        license: 'Derived work: CC-BY-NC-SA-3.0-IGO (from WHO BEC) and public domain (US Army ATP 3-50.21, ATP 4-02.11; US National Park Service)',
        sourceTitle: 'Fred field cards, written from WHO BEC 2018, ATP 3-50.21, ATP 4-02.11 and National Park Service pages',
        sourceUrl: 'corpora/cards/cards.json',
        attribution: 'Adapted from WHO/ICRC Basic Emergency Care (2018), CC BY-NC-SA 3.0 IGO, and US Army ATP 3-50.21 (2018) and ATP 4-02.11 (2026), and US National Park Service pages (public domain).',
        nonCommercial: true,
      }
    : {
        id: 'fred-field-cards',
        license: 'Written for Fred from public-domain sources (US Army ATP 3-50.21, ATP 4-02.11; US Government agency pages)',
        sourceTitle: 'Fred field cards, written from public-domain US Government sources',
        sourceUrl: 'corpora/cards/cards.json',
        attribution: 'Adapted from US Army ATP 3-50.21 (2018) and ATP 4-02.11 (2026), and US Government agency pages (public domain).',
        nonCommercial: false,
      };
}
