/**
 * Situations that carry a disease risk the hiker does not name (#51).
 *
 * "a raccoon bit my kid's hand" is a rabies exposure, and the health pack's
 * rabies passages answer it, but they are written in the agencies' words
 * ("post-exposure prophylaxis") and scored 0.10-0.16 for the hiker's; asked
 * "do I need a rabies shot after a raccoon bite", the same passage scored 0.48.
 * A first-aid instructor makes the link without thinking; the search model
 * does not. So a short list of reviewed links names the disease beside the
 * message before it is searched. The model is never asked to make the link,
 * and the answer is still written from the passages with the hiker's own
 * words in the prompt.
 *
 * Each link is a public-health fact from the pack's own sources (CDC): which
 * animals carry rabies, what spreads hantavirus, what fleas and dead rodents
 * can mean, what a green scum on water can be. Squirrels, chipmunks and other
 * small rodents are left out of the rabies link on purpose: the CDC says they
 * almost never carry it.
 */

import type { Condition } from './conditions.ts';

export interface ExposureLink {
  readonly id: string;
  /** What is added to the search, in the sources' own vocabulary. */
  readonly term: string;
  readonly when: RegExp;
  /**
   * Advice a model-written answer must not give while this link holds, and
   * the reviewed reply that replaces it (conditions.ts, `instead`).
   */
  readonly guard?: { readonly label: string; readonly forbidden: RegExp; readonly instead: string };
}

/** Wild mammals the CDC names as carrying rabies in the US, and a catch-all. */
const RABIES_ANIMAL = String.raw`(?:raccoons?|skunks?|fox(?:es)?|bats?|coyotes?|bobcats?|groundhogs?|woodchucks?|wolf|wolves|wild animals?|stray (?:dog|cat)s?)`;
const BITE = String.raw`(?:bit|bite[sd]?|bitten|biting|nipped|scratch(?:ed|es)?|clawed|attacked|licked)`;

export const EXPOSURE_LINKS: readonly ExposureLink[] = [
  {
    id: 'rabies',
    term: 'rabies exposure, when to seek medical care',
    when: new RegExp(String.raw`\b${RABIES_ANIMAL}\b[^.?!]{0,60}\b${BITE}\b|\b${BITE}\b[^.?!]{0,40}\b${RABIES_ANIMAL}\b`, 'i'),
  },
  {
    // A bat where someone slept, or touching someone, with no bite noticed:
    // bat bites can be too small to see (CDC).
    id: 'rabies-bat',
    term: 'rabies, bats, contact with a bat',
    when: /\bbats?\b[^.?!]{0,60}\b(?:tent|room|cabin|bed|sleeping|asleep|woke|landed|touched|on (?:me|my|him|her|his))\b|\b(?:tent|room|cabin|bed)\b[^.?!]{0,40}\bbats?\b/i,
  },
  {
    id: 'hantavirus',
    term: 'hantavirus, rodent droppings, cleaning up safely',
    when: /\b(?:mouse|mice|rats?|rodents?|packrats?|woodrats?|deer mice)\b[^.?!]{0,50}\b(?:droppings|poop\w*|scat|nests?|urine|pee|mess)\b|\b(?:droppings|poop\w*|nests?)\b[^.?!]{0,30}\b(?:mouse|mice|rats?|rodents?|packrats?|woodrats?)\b|\bmousy\b|\b(?:mice|rats|rodents) (?:got into|in the|everywhere)\b/i,
  },
  {
    id: 'plague',
    term: 'plague, fleas and dead rodents',
    when: /\bdead (?:squirrels?|rodents?|chipmunks?|prairie dogs?|rats?|mice|rabbits?)\b|\bfleas\b/i,
  },
  {
    id: 'algal-bloom',
    term: 'harmful algal bloom, toxins in water',
    // Asked "can i filter it and drink it", the model told a hiker to boil the
    // water or use tablets, then to test it and drink it cautiously (health
    // set, #51). EPA: "No, boiling water will not remove cyanotoxins and may
    // increase toxin levels." CDC: the toxins make people and animals sick by
    // touch, spray or swallowing.
    guard: {
      label: 'an algal bloom',
      forbidden: /\b(?:boil\w*|filter\w*|purif\w*|tablets?|bleach|iodine|chlorin\w*|disinfect\w*|test\w*)\b|\bdrink\w*\b[^.]*\b(?:cautious\w*|safe)\b/i,
      instead: "Don't drink water with a scum, foam or bloom on it, even filtered or boiled: boiling won't remove the algae's toxins and may increase them. " +
        "Stay out of it, and keep dogs out too: the toxins can make people and animals sick through the skin, spray or swallowing. Find another water source.",
    },
    when: /\b(?:scum|algae|algal|pond scum)\b|\b(?:green|blue-green|bright green)\b[^.?!]{0,20}\b(?:foam|slime|film|water)\b/i,
  },
];

/** The search terms of every link this message makes, in list order. */
export function exposureTerms(message: string): string[] {
  return EXPOSURE_LINKS.filter((l) => l.when.test(message)).map((l) => l.term);
}

/** The message as searched: with the linked terms beside it, or unchanged. */
export function withExposures(message: string): string {
  const terms = exposureTerms(message);
  return terms.length === 0 ? message : `${message} (${terms.join('; ')})`;
}

/** The links in these messages that guard an answer, as conditions with a reviewed reply and no card. */
export function exposureConditions(messages: readonly string[]): Condition[] {
  return EXPOSURE_LINKS.filter((l) => l.guard !== undefined && messages.some((m) => l.when.test(m)))
    .map((l) => ({ id: l.id, label: l.guard!.label, card: '', said: () => true, forbidden: l.guard!.forbidden, instead: l.guard!.instead }));
}
