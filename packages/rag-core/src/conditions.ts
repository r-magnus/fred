/**
 * What has happened in the conversation, and which cards must not follow it
 * (#98 round 2, docs/plan-understand-2.md step 1).
 *
 * "how do i tell if a snake is venomous" / "my friend just got bit by one" /
 * "its on his ankle and swelling" opened the sprained-ankle card on the phone:
 * ice it, wrap it, raise it. Searched alone, the last message is a sprain; in
 * the conversation it is a snakebite, and the snakebite card says not to put
 * ice on it and to keep the limb below the heart. No score can see that: the
 * wrong card was a confident match (research-conversation-safety.md).
 *
 * So the conversation keeps a short record of conditions, set by fixed trigger
 * phrases in the hiker's own messages, never by the model. Each card lists the
 * conditions it must not follow. Every entry comes from the cards' own reviewed
 * steps and don'ts: the conflict is written down in the cards already, one card
 * saying to do what the other says not to.
 */

/**
 * How many earlier messages the app passes (from the last 30 minutes): a
 * condition set a few messages back still holds. The understanding step reads
 * only the current topic's thread of them (understand.ts).
 */
export const CONDITION_HISTORY = 10;

/** A condition: what happened, the card that treats it, and how the hiker says it. */
export interface Condition {
  readonly id: string;
  /** How Fred names it back ("Is this about the snakebite?"). */
  readonly label: string;
  /** The field card that treats it (its title, which is the chunk's section). */
  readonly card: string;
  /** True when the hiker's messages, oldest first, say it happened. */
  readonly said: (messages: readonly string[]) => boolean;
  /**
   * Advice the condition's card says not to give, as it appears in a
   * model-written answer. A sentence that says not to do it is fine.
   */
  readonly forbidden?: RegExp;
}

const SNAKE = /\b(?:snakes?|rattlers?|rattlesnakes?|copperheads?|cottonmouths?|vipers?|adders?|water moccasins?)\b/i;
const BITE = /\b(?:bit|bitten|bites?|biting|struck|strikes?|nailed|tagged|got (?:him|her|me|them|my|his|our))\b/i;
/** A bite from something that isn't a snake, named in the same message. */
const OTHER_BITER = /\b(?:mosquito(?:e?s)?|ticks?|spiders?|bees?|wasps?|hornets?|ants?|flies|fly|dogs?|horse|mouse|mice|rats?|squirrels?|chipmunks?)\b/i;

/** The message that mentions a snake, or a later one, says it bit someone. */
function snakebiteSaid(messages: readonly string[]): boolean {
  const first = messages.findIndex((m) => SNAKE.test(m));
  if (first < 0) return false;
  return messages.slice(first).some((m) => BITE.test(m) && !(OTHER_BITER.test(m) && !SNAKE.test(m)));
}

/**
 * A fall from height or down a slope, not into water ("fell in the lake" is
 * cold water, not a fall). After a fall a neck or back injury is possible, and
 * the spine card says not to move them.
 */
const FALL = /\b(?:fell|fallen|falls?|tumbled|slid|slipped) (?:off|down|from|over|out of|onto|on)\b|\b(?:took|had) a (?:bad |big |hard |nasty )?(?:fall|tumble|spill)\b|\bslipped and fell\b|\bfell (?:\d+|a few|several|like \d+) (?:feet|ft|meters|metres|m)\b/i;

const BELLY = /\b(?:stabbed|impaled|gored)\b.*\b(?:belly|stomach|abdomen|gut|guts|side)\b|\b(?:belly|stomach|abdomen|abdominal) (?:wound|stab|puncture|gash|cut)\b|\bguts? (?:are |is )?(?:out|showing|hanging)\b/i;

/**
 * A burn, said with or without the word: "my son brushed his arm on the camp
 * stove grate" and "splashed hot coffee all over my wrist" never say "burn"
 * (confirmation chat set).
 */
const BURN = /\bburn(?:ed|t|s|ing)?\b|\bscald(?:ed|ing)?\b|\bseared\b|\b(?:touched|brushed|grabbed|leaned on|put (?:his|her|my|their) hands? on|spilled|splashed|poured|knocked|fell (?:in|into|on))\b[^.]{0,40}\b(?:stove|grate|pan|pot|kettle|coals?|campfire|fire|flames?|embers|boiling|hot (?:water|coffee|tea|oil|soup))\b/i;
const FROSTBITE = /\bfrost ?bit(?:e|ten)\b|\bfrostnip\b|\b(?:toes?|fingers?|fingertips?|nose|ears?|cheeks?|feet|foot)\b[^.]*\b(?:white|waxy|frozen|wooden)\b/i;
const HYPOTHERMIA = /\bhypotherm|\bcan'?t stop (?:shivering|shaking)\b|\b(?:shivering|shaking) (?:uncontrollably|like crazy|badly)\b|\bfell (?:in|into|through) (?:the |a )?(?:ice|lake|river|creek|stream|water)\b|\bwent through the ice\b/i;

export const CONDITIONS: readonly Condition[] = [
  // Snakebite: "Don't put ice on it", "Don't put a tourniquet on the limb",
  // "Don't cut the bite open or try to suck out the venom", and the limb
  // stays "slightly below the level of the heart".
  { id: 'snakebite', label: 'snakebite', card: 'Snakebite', said: snakebiteSaid,
    forbidden: /\bice\b|\b(?:cold|cool) (?:compress|pack)|\btourniquet|\bsuck|\bcut (?:into|open|the bite)|\belevat|\braise (?:it|the (?:leg|arm|limb|ankle|foot|calf))|\bRICE\b/i },
  // Burns: "Don't use ice or ice water", "Don't put butter, grease, ointments
  // or home remedies on a burn"; a blistering burn is covered, not opened.
  { id: 'burn', label: 'burn', card: 'Burns', said: (ms) => ms.some((m) => BURN.test(m)),
    forbidden: /\bice\b|\bbutter\b|\bgrease\b|\bointments?\b|\btoothpaste\b|\b(?:pop|drain|puncture|lance|burst)\w*\b[^.]*\bblisters?\b|\bblisters?\b[^.]*\b(?:pop|drain|puncture|lance|burst)\w*/i },
  // Frostbite: "Don't rub or massage it", "Don't hold it near a fire to thaw it."
  { id: 'frostbite', label: 'frostbite', card: 'Frostbite and frostnip', said: (ms) => ms.some((m) => FROSTBITE.test(m)),
    forbidden: /\b(?:rub|massag)\w*|\b(?:by|near|over|next to|in front of) (?:a|the) fire\b/i },
  // Hypothermia: "handle them gently", "Don't give alcohol".
  { id: 'hypothermia', label: 'cold', card: 'Hypothermia: shivering, confused, too cold', said: (ms) => ms.some((m) => HYPOTHERMIA.test(m)),
    forbidden: /\b(?:rub|massag)\w*|\balcohol\b|\bhot (?:bath|shower)\b/i },
  { id: 'fall', label: 'fall', card: 'Possible neck or back injury', said: (ms) => ms.some((m) => FALL.test(m)) },
  { id: 'belly-wound', label: 'belly wound', card: 'Wound to the belly', said: (ms) => ms.some((m) => BELLY.test(m)) },
];

/**
 * Cards that must not follow a condition, by card title, with the conflict
 * each entry rests on (all quoted from the reviewed cards).
 */
export const NOT_AFTER: Readonly<Record<string, readonly string[]>> = {
  // Sprain: "Ice ... Compression: wrap or splint it ... Elevation: raise the
  // injured part." Snakebite: "Don't put ice on it", "Keep the bitten arm or
  // leg slightly below the level of the heart".
  'Twisted or sprained ankle, or a strained muscle': ['snakebite'],
  // Stings: "Hold a cold compress, or ice wrapped in cloth, on it."
  // Snakebite: "Don't put ice on it."
  'Bee, wasp and insect stings, spider bites': ['snakebite'],
  // Shock: "lay them on their back with their feet raised", "Get them into
  // shade". Spine: "After a fall ... Don't move them unless they are in
  // immediate danger". Graded unsafe in round 1 (results-understand.md).
  'Shock after an injury': ['fall'],
  // Heat illness: "move them into shade, have them lie down with their legs
  // raised a little". The same conflict with the spine card after a fall.
  'Heat exhaustion and heat stroke': ['fall'],
  // Dehydration: "Sip small amounts of water often". Low blood sugar gives
  // sugar by mouth. Belly wound: "Don't give them food or water."
  'Dehydration': ['belly-wound'],
  'Low blood sugar': ['belly-wound'],
};

/** The conditions the hiker's messages (oldest first, the current one last) establish. */
export function conditionsIn(messages: readonly string[]): Condition[] {
  return CONDITIONS.filter((c) => c.said(messages));
}

const NEGATED = /\b(?:don'?t|do not|never|avoid|not|no|instead of|rather than|without)\b/i;

/**
 * The first active condition whose forbidden advice a model-written answer
 * gives: a sentence that names it without saying not to. "Do not wrap the
 * ankle tightly with ice" passes; "Apply cold compresses intermittently to
 * reduce swelling", written after a snakebite with the snakebite card in the
 * prompt, does not (sealed chat set, #98 round 2).
 */
export function violatedCondition(answer: string, active: readonly Condition[]): Condition | undefined {
  const sentences = answer.split(/(?<=[.!?])\s+|\n+/);
  return active.find((c) => c.forbidden !== undefined &&
    sentences.some((s) => c.forbidden!.test(s) && !NEGATED.test(s)));
}

/**
 * The condition said most recently, and whether the last message said it:
 * the one a follow-up is most likely about.
 */
export function latestCondition(messages: readonly string[]): { condition: Condition; inLast: boolean } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const now = conditionsIn(messages.slice(0, i + 1));
    const before = conditionsIn(messages.slice(0, i));
    const added = now.find((c) => !before.some((b) => b.id === c.id));
    if (added !== undefined) return { condition: added, inLast: i === messages.length - 1 };
  }
  return undefined;
}

/** The first active condition a card must not follow, if any. */
export function blockingCondition(cardTitle: string, active: readonly Condition[]): Condition | undefined {
  const not = NOT_AFTER[cardTitle];
  return not === undefined ? undefined : active.find((c) => not.includes(c.id));
}
