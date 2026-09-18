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
    // How hikers describe injuries, as opposed to how clinicians do. Without
    // these, the proposal's own US-02 question ("I cut myself on a branch")
    // matched no domain, fell back to every pack, and ranked a bird snare first
    // on the word "cut".
    'cut', 'gash', 'scrape', 'graze', 'blood', 'bleed', 'blister', 'ankle',
    'twisted', 'broken', 'hurt',
    // Shared with wildlife on purpose. Listed only there, "a rattlesnake bit my
    // leg" routed to wildlife alone and never reached a first-aid pack.
    'bite', 'bit', 'bitten', 'sting', 'stung', 'venom', 'venomous', 'snakebite',
    // Body parts, because a hiker names where it hurts rather than the injury.
    // "Something is stuck in my eye" carried no domain vocabulary at all.
    'eye', 'head', 'face', 'neck', 'back', 'leg', 'arm', 'hand', 'foot', 'feet',
    'finger', 'toe', 'knee', 'shoulder', 'rib', 'skin',
    // Symptoms as described rather than diagnosed. "Shivering uncontrollably and
    // confused" is hypothermia, but the word hypothermia never appears.
    'shivering', 'shiver', 'numb', 'pale', 'dizzy', 'dizziness', 'nausea',
    'vomiting', 'confused', 'confusion', 'faint', 'weak', 'weakness', 'pain',
    'painful', 'sore', 'swollen', 'bruise', 'rash', 'itch',
    // Heat and cold as lay words; the lexicon had only the clinical names.
    'heat', 'exhaustion', 'cold', 'freezing', 'overheated',
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
    // Terrain and predicament words. "I need to cross a river" and "I think I'm
    // lost" are core survival questions that matched no domain vocabulary.
    'river', 'stream', 'creek', 'cross', 'crossing', 'ford', 'current',
    'lost', 'stranded', 'night', 'dark', 'wind',
    // Eating vocabulary, shared with plants on purpose. ATP 3-50.21 chapter 4
    // holds the edibility and avoid lists, and those chunks carry domain
    // 'survival' — so "how do I know if a wild plant is safe to eat?" routed
    // only to 'plants', reached nothing but state packs, and asked for a
    // location it does not need.
    //
    // Note what is NOT here: bare 'plant'. Adding it put the survival manual's
    // PLANTS chapter in competition with the state packs, and it won — "what
    // plants and animals are near me?" started citing ATP 3-50.21 p.77 instead
    // of a species review. Whether something is safe to eat is survival
    // knowledge; which species grow here is not.
    'eat', 'eating', 'edible', 'edibility', 'poisonous',
  ],
  plants: [
    'plant', 'tree', 'shrub', 'grass', 'forb', 'flower', 'leaf', 'leaves',
    'berry', 'berries', 'root', 'bark', 'seed', 'fruit', 'mushroom', 'fungus',
    'edible', 'poisonous', 'toxic', 'toxicity', 'ivy', 'oak', 'sumac', 'nettle',
    'hemlock', 'nightshade', 'forage', 'identify', 'identification', 'species',
    'habitat', 'bloom', 'thorn', 'sap', 'conifer', 'pine', 'aspen', 'willow',
    // "Where does California huckleberry grow?" names a species the lexicon
    // cannot contain — there are 1,092 of them — so the question verb carries it.
    'grow', 'grows',
  ],
  wildlife: [
    // 'mountain' is deliberately absent: alone it is not a wildlife signal, and
    // it routed "write me a poem about the mountains" to a state pack, which then
    // asked the user for their location. 'lion', 'cougar' and 'puma' already
    // cover the animal it was there for.
    'animal', 'wildlife', 'bear', 'cougar', 'puma', 'lion', 'wolf', 'coyote',
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
  // Lay phrasing carries function words that the clinical corpora do not, and
  // S_lex divides by total keyword weight, so each one dilutes the terms that
  // actually discriminate. "I cut myself on a branch" scored 'cut' at 2 of 4
  // weight; "my friend badly twisted their ankle" scored 'twisted'+'ankle' at
  // 4 of 7. These carry no retrievable content in any corpus.
  //
  // Reflexive and indefinite pronouns:
  'myself', 'yourself', 'yourselves', 'himself', 'herself', 'itself',
  'ourselves', 'themselves', 'someone', 'somebody', 'something', 'anyone',
  'anybody', 'anything', 'everyone', 'everybody', 'everything', 'nothing',
  'nobody',
  // Degree adverbs: they modify severity without naming it. "Badly" twisted is
  // still a twist, and no chunk is retrievable by the word.
  'really', 'quite', 'extremely', 'badly', 'pretty', 'somewhat', 'rather',
  'fairly',
  // Light verbs and placeholder nouns. Note 'bit' is deliberately absent: it is
  // first-aid/wildlife vocabulary ("a rattlesnake bit my leg"), which is exactly
  // the collision the test below guards against.
  'need', 'want', 'know', 'think', 'feel', 'look', 'seem', 'help', 'try',
  'use', 'give', 'come', 'take', 'make', 'put', 'keep', 'tell', 'ask',
  'please', 'thing', 'things', 'lot', 'way', 'time',
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
 * The lexicon entry a query token refers to, if any.
 *
 * The lexicon lists mostly singular forms, and matching only the raw token meant
 * "can animals get in?" carried no wildlife signal at all — the proposal's own
 * US-08-AC2 wording. stem() alone is not enough either: it maps "snakes" to
 * "snak", so the plain trailing-s form is tried as well.
 */
function lexiconFormOf(token: string): string | null {
  const candidates = [token, stem(token), token.endsWith('s') ? token.slice(0, -1) : token];
  return candidates.find((c) => ALL_DOMAIN_TERMS.has(c)) ?? null;
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
    // Lexicon first, so domain vocabulary can never be deleted by a stopword
    // that happens to share its spelling — "a rattlesnake bit my leg" must keep
    // 'bit'. Then test the stem as well, so inflected function words ("needs",
    // "looks") drop out alongside their base form.
    const lexiconTerm = lexiconFormOf(raw);
    if (lexiconTerm === null && (STOPWORDS.has(raw) || STOPWORDS.has(stem(raw)))) continue;
    const isDomain = lexiconTerm !== null;
    const term = lexiconTerm ?? stem(raw);
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
