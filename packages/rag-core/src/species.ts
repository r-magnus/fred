/**
 * Which section of a species review answers a question (#126,
 * docs/plan-grounded-answers.md, step 4).
 *
 * FEIS species reviews (the state packs) use fixed section names, and the
 * form of a question says which one answers it. "when is the elk rut" was
 * answered "in late spring to early summer" from a habitat passage; a timing
 * question belongs to Seasonal Development or Biological Characteristics.
 * Matching passages go first among the state-pack passages in the prompt,
 * since the model leans on what comes first. Order only: no score or gate
 * moves.
 */
import type { ScoredChunk } from './retrieve.ts';

const SECTION_FOR: readonly (readonly [RegExp, RegExp])[] = [
  [/\b(?:look(?:s)? like|identify|tell .* apart|how (?:tall|big|large|high|long)|what colou?r|bark|leaves|flowers? look|peeling)\b/i,
    /^(?:Botanical Description|Biological Characteristics)$/],
  [/\b(?:where (?:does|do|can|is|are|would)|grow|found|range|habitat|live|around here|in this (?:state|area))\b/i,
    /^(?:General Distribution|Site Characteristics|Preferred Habitat|Cover Requirements)$/],
  [/\b(?:eat|eats|eaten|eating|food|diet|prey|hunt|hunts|forage|browse|feed on|predators?)\b/i,
    /^(?:Diet|Predators|Importance to Wildlife and Livestock|Palatability and Nutritional Value)$/],
  [/\b(?:when (?:is|does|do|are)|what time of year|season|rut|bloom|blooms|flowering|breed|breeding|mate|mating|calve|calving|ripen)\b/i,
    /^(?:Seasonal Development|Biological Characteristics)$/],
  [/\b(?:edible|can (?:you|i|we|people) eat|used for|uses?)\b/i, /^Other Uses$/],
];

/** The review section a passage is from: "elk > Diet" -> "Diet". */
const sectionOf = (c: ScoredChunk): string => c.chunk.section.split(' > ')[1] ?? '';

/**
 * State-pack passages reordered so those from the sections the question asks
 * about come first; every other passage keeps its place.
 */
export function speciesSectionOrder(cs: readonly ScoredChunk[], query: string, statePacks: ReadonlySet<string>): ScoredChunk[] {
  const wanted = SECTION_FOR.filter(([q]) => q.test(query)).map(([, s]) => s);
  if (wanted.length === 0) return [...cs];
  const slots = cs.map((c, i) => (statePacks.has(c.chunk.packId) ? i : -1)).filter((i) => i >= 0);
  const rank = (c: ScoredChunk): number => (wanted.some((s) => s.test(sectionOf(c))) ? 0 : 1);
  const ordered = slots.map((i) => cs[i]!).map((c, k) => ({ c, k })).sort((a, b) => rank(a.c) - rank(b.c) || a.k - b.k).map((x) => x.c);
  const out = [...cs];
  slots.forEach((i, k) => { out[i] = ordered[k]!; });
  return out;
}
