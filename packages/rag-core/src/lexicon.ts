/**
 * Domain lexicon and query keyword extraction.
 *
 * This one table does three jobs, which is why it is worth curating carefully:
 *   1. weighting terms in the S_lex score (score.ts)
 *   2. selecting sentences during context compression (compress.ts)
 *   3. routing a query to the right packs (router.ts)
 */
import type { DomainTag } from '@fred/pack-format';

/**
 * Domain terms, grouped by the pack domain they signal.
 * Seed set — extend as ingest surfaces vocabulary the corpora actually use.
 */
export const DOMAIN_LEXICON: Readonly<Record<DomainTag, readonly string[]>> = {
  'first-aid-physical': [
    'airway', 'breathing', 'circulation', 'bleeding', 'hemorrhage', 'haemorrhage',
    'tourniquet', 'shock', 'cpr', 'compression', 'resuscitation', 'unconscious',
    'unresponsive', 'pulse', 'fracture', 'splint', 'burn', 'wound', 'bandage',
    'choking', 'seizure', 'stroke', 'anaphylaxis', 'allergic', 'poisoning',
    'hypothermia', 'hyperthermia', 'heatstroke', 'frostbite', 'dehydration',
    'concussion', 'sprain', 'dislocation', 'laceration', 'infection', 'sepsis',
    'defibrillator', 'aed', 'recovery', 'position', 'triage', 'trauma', 'injury',
    'chest', 'abdominal', 'spinal', 'artery', 'vein', 'swelling', 'fainting',
  ],
  'first-aid-psychological': [
    'panic', 'anxiety', 'distress', 'trauma', 'grief', 'calm', 'reassure',
    'listening', 'support', 'coping', 'crisis', 'survivor', 'bereavement',
    'psychological', 'emotional', 'stress', 'referral', 'comfort', 'consent',
    'dignity', 'confidentiality', 'hyperventilating', 'dissociation',
  ],
  survival: [
    'fire', 'tinder', 'kindling', 'ember', 'ignition', 'friction', 'shelter',
    'lean', 'debris', 'insulation', 'water', 'purify', 'purification', 'boil',
    'filter', 'iodine', 'navigation', 'compass', 'bearing', 'orient', 'signal',
    'rescue', 'whistle', 'mirror', 'knot', 'cordage', 'rope', 'lashing',
    'forage', 'trap', 'snare', 'fishing', 'ration', 'exposure', 'windchill',
    'bivouac', 'campsite', 'stove', 'fuel', 'flint', 'tarp', 'sleeping',
  ],
  plants: [
    'plant', 'tree', 'shrub', 'grass', 'forb', 'flower', 'leaf', 'leaves',
    'berry', 'berries', 'root', 'bark', 'seed', 'fruit', 'mushroom', 'fungus',
    'edible', 'poisonous', 'toxic', 'toxicity', 'ivy', 'oak', 'sumac', 'nettle',
    'hemlock', 'nightshade', 'forage', 'identify', 'identification', 'species',
    'habitat', 'bloom', 'thorn', 'sap', 'conifer', 'pine', 'aspen', 'willow',
  ],
  wildlife: [
    'animal', 'wildlife', 'bear', 'cougar', 'mountain', 'lion', 'wolf', 'coyote',
    'moose', 'elk', 'deer', 'bison', 'snake', 'rattlesnake', 'venomous', 'venom',
    'spider', 'scorpion', 'tick', 'mosquito', 'insect', 'bite', 'sting', 'attack',
    'predator', 'nest', 'den', 'tracks', 'scat', 'encounter', 'aggressive',
    'rabies', 'lyme', 'bird', 'raptor', 'fish', 'amphibian', 'reptile', 'mammal',
  ],
};

/** Flat lookup of every domain term, for weighting during keyword extraction. */
const ALL_DOMAIN_TERMS: ReadonlySet<string> = new Set(
  Object.values(DOMAIN_LEXICON).flat(),
);

/** Reverse index: term -> domains it signals. Used by the router. */
const TERM_TO_DOMAINS: ReadonlyMap<string, readonly DomainTag[]> = (() => {
  const m = new Map<string, DomainTag[]>();
  for (const [domain, terms] of Object.entries(DOMAIN_LEXICON) as [DomainTag, readonly string[]][]) {
    for (const t of terms) {
      const cur = m.get(t);
      if (cur) cur.push(domain);
      else m.set(t, [domain]);
    }
  }
  return m;
})();

const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'than', 'so', 'because',
  'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'about', 'into', 'from',
  'up', 'down', 'out', 'over', 'under', 'again', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'am', 'do', 'does', 'did', 'doing', 'have', 'has',
  'had', 'having', 'can', 'could', 'should', 'would', 'will', 'shall', 'may',
  'might', 'must', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him',
  'her', 'us', 'them', 'my', 'your', 'his', 'its', 'our', 'their', 'this',
  'that', 'these', 'those', 'what', 'which', 'who', 'whom', 'when', 'where',
  'why', 'how', 'all', 'any', 'both', 'each', 'more', 'most', 'other', 'some',
  'such', 'no', 'not', 'only', 'own', 'same', 'too', 'very', 's', 't', 'just',
  'now', 'get', 'got', 'go', 'going', 'there', 'here', 'as', 'also',
]);

/** A query term plus how much it counts toward S_lex. */
export interface Keyword {
  readonly term: string;
  readonly weight: number;
  readonly isDomainTerm: boolean;
}

/** Domain terms count double: they are the discriminating vocabulary. */
export const DOMAIN_TERM_WEIGHT = 2;
export const GENERIC_TERM_WEIGHT = 1;

/**
 * Very light suffix stemmer — enough to match "bleeding"/"bleed" and
 * "berries"/"berry" without pulling in a stemming dependency. Deliberately
 * conservative: over-stemming costs precision on a small corpus.
 */
export function stem(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith('ies') && token.length > 4) return token.slice(0, -3) + 'y';
  if (token.endsWith('sses')) return token.slice(0, -2);
  if (token.endsWith('ing') && token.length > 5) return token.slice(0, -3);
  if (token.endsWith('ed') && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('es') && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Build K_q, the query keyword set of PocketRAG Eq. 2.
 *
 * The paper says "medical keywords extracted from the query" without defining the
 * fallback when a query contains none. Restricting K_q to lexicon terms would make
 * S_lex undefined (0/0) for ordinary phrasing like "what do I do if someone falls".
 * So K_q is all content words, with lexicon terms weighted double. Queries with no
 * domain vocabulary still get a defined score; they just lean on semantics.
 */
export function extractKeywords(query: string): Keyword[] {
  const seen = new Set<string>();
  const out: Keyword[] = [];
  for (const raw of tokenize(query)) {
    if (STOPWORDS.has(raw)) continue;
    const isDomain = ALL_DOMAIN_TERMS.has(raw);
    const term = isDomain ? raw : stem(raw);
    if (term.length < 2 || seen.has(term)) continue;
    seen.add(term);
    out.push({
      term,
      weight: isDomain ? DOMAIN_TERM_WEIGHT : GENERIC_TERM_WEIGHT,
      isDomainTerm: isDomain,
    });
  }
  return out;
}

/** Domains signalled by a term, for routing. */
export function domainsForTerm(term: string): readonly DomainTag[] {
  return TERM_TO_DOMAINS.get(term) ?? [];
}

export function isDomainTerm(term: string): boolean {
  return ALL_DOMAIN_TERMS.has(term);
}

/** Density of domain vocabulary in a span. Drives sentence selection. */
export function domainTermDensity(text: string): number {
  const toks = tokenize(text);
  if (toks.length === 0) return 0;
  let hits = 0;
  for (const t of toks) if (ALL_DOMAIN_TERMS.has(t)) hits++;
  return hits / toks.length;
}
