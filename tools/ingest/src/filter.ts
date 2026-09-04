/**
 * Chunk-level filter for course apparatus.
 *
 * WHO BEC is a training workbook, not only a clinical reference. Roughly a
 * quarter of it is teaching scaffolding: acknowledgements and contributor
 * lists, course administration, module objectives, key-terms exercises with
 * blank definition lines, case-scenario worksheets, and blank ABCDE assessment
 * checklists.
 *
 * None of it can answer a first-aid question, but all of it is topically
 * adjacent, so it embeds near real clinical content and competes for the top-k.
 * A contents page already outranked real wound-packing procedures before dot
 * leaders were filtered (docs/results-m1.md); this is the same failure with a
 * different disguise.
 *
 * Filtering is deliberately marker-based rather than statistical: the markers
 * are distinctive strings that clinical guidance does not use, so the rule is
 * predictable and auditable. Anything uncertain is kept — a noisy chunk costs
 * some prefill, a wrongly-dropped one costs an answer.
 */

/** Phrases that only appear in course apparatus, never in clinical guidance. */
const SCAFFOLD_MARKERS: readonly RegExp[] = [
  /\bworkbook question\b/i,
  /\bkey terms\b/i,
  /\bwrite the definition\b/i,
  /\bmultiple choice questions\b/i,
  /\bon completing this module\b/i,
  /\bfinal exam\b/i,
  /\bpre-?test\b/i,
  /\bpost-?test\b/i,
  /\bfacilitators?\b/i,
  /\bparticipants? (?:should|will|must|are)\b/i,
  /\bwe thank\b/i,
  /\bpeer review\b/i,
  /\bfocus groups?\b/i,
  /\bcourse pilots?\b/i,
];

/**
 * Blank ABCDE assessment tables read as "AIRWAY YES NO BREATHING YES NO ...".
 * Two or more such pairs is a worksheet, not prose.
 */
function isBlankChecklist(text: string): boolean {
  return (text.match(/\bYES\s+NO\b/g) ?? []).length >= 2;
}

/** Acknowledgement pages are mostly comma-separated personal names. */
function isNameList(text: string): boolean {
  const commas = (text.match(/,/g) ?? []).length;
  const words = text.split(/\s+/).length;
  if (words < 30 || commas < 8) return false;
  const capitalized = (text.match(/\b[A-Z][a-z]+\b/g) ?? []).length;
  return capitalized / words > 0.45;
}

export interface FilterVerdict {
  readonly drop: boolean;
  readonly reason: string | null;
}

export function classifyChunk(text: string): FilterVerdict {
  for (const marker of SCAFFOLD_MARKERS) {
    if (marker.test(text)) return { drop: true, reason: marker.source };
  }
  if (isBlankChecklist(text)) return { drop: true, reason: 'blank assessment checklist' };
  if (isNameList(text)) return { drop: true, reason: 'contributor name list' };
  return { drop: false, reason: null };
}
