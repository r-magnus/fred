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
  /**
   * A condition read from a setting or a fact plus a symptom (altitude, heat,
   * low blood sugar): it explains the symptom, so its card leads over a card
   * that only shares the symptom's words ("my buddy has a headache" at 10,500
   * ft opened the head-injury card; #101).
   */
  readonly explains?: boolean;
  /**
   * A situation, not an injury (being lost): a follow-up naming the body
   * ("i have a bad blister on my heel") is not about it (#101).
   */
  readonly situation?: boolean;
  /**
   * For a risk with no field card of its own (#51, exposures.ts): the reviewed
   * reply that replaces an answer giving forbidden advice, in the sources'
   * words. With it, `card` is empty.
   */
  readonly instead?: string;
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
const FROSTBITE = /\bfrost ?bit(?:e|ten)\b|\bfrostnip\b|\b(?:toes?|fingers?|fingertips?|nose|ears?|cheeks?|feet|foot)\b[^.]*\b(?:white|waxy|frozen|wooden|pale)\b|\b(?:white|waxy|pale)\b[^.]*\b(?:toes?|fingers?|fingertips?)\b|\bcan'?t feel (?:my|his|her|their) (?:toes?|fingers?|fingertips?|feet|hands?)\b/i;
const HYPOTHERMIA = /\bhypotherm|\bcan'?t stop (?:shivering|shaking)\b|\b(?:shivering|shaking) (?:uncontrollably|like crazy|badly)\b|\bfell (?:in|into|through) (?:the |a )?(?:ice|lake|river|creek|stream|water)\b|\bwent through the ice\b/i;

/**
 * A symptom in a setting that explains it (#101): vomiting and a headache at
 * 9,000 ft never reached "go down" on the phone, and "should we just sleep it
 * off" got the head-injury card. The setting can come messages before the
 * symptom ("camping at 10500 ft tonight" ... "my buddy has a headache").
 */
const HIGH = /\b(?:[89]|1\d)[,.]?\d{3}\s*(?:ft|feet|foot|')\b|\b(?:[89]|1\d)k\s*(?:ft|feet)?\b|\b(?:2[5-9]|3\d|4\d)\d{2}\s*(?:m|meters|metres)\b|\bhigh altitude\b|\baltitude\b/i;
const ALTITUDE_SIGN = /\bheadache\b|\bhead (?:is )?(?:pounding|killing)\b|\bthrowing up\b|\bthrew up\b|\bvomit\w*|\bnause\w*|\bdizzy\b|\bshort of breath\b|\bcan'?t (?:catch|get) (?:my|his|her|their) breath\b|\bout of it\b|\bconfused\b|\bstumbling\b/i;
const HOT = /\b1[0-2]\d\s*(?:degrees|°|f\b|out\b|outside\b|today\b|in the shade\b)|\b(?:over|above|past) 100\b|\b(?:so|really|super|crazy|insanely|brutally) hot\b|\bdesert\b|\bheat wave\b|\bscorching\b|\bbaking\b/i;
const HEAT_SIGN = /\bdizzy\b|\bheadache\b|\bnause\w*|\bcramps?\b|\bsweating (?:a ton|a lot|buckets|like crazy)\b|\bstopped sweating\b|\bfaint\w*|\blight ?headed\b|\bthrowing up\b|\bthrew up\b|\bvomit\w*/i;
/** The setting said in one message and the sign in the same or a later one. */
const inSetting = (setting: RegExp, sign: RegExp) => (ms: readonly string[]): boolean => {
  const first = ms.findIndex((m) => setting.test(m));
  return first >= 0 && ms.slice(first).some((m) => sign.test(m));
};

/** Low blood sugar (#101): a diabetic, then shaky or sweaty or strange. "he's diabetic btw" ... "and sweaty, and he's not making much sense" opened the heat card. */
const DIABETIC = /\bdiabet\w*|\btype (?:1|one|2|two)\b|\binsulin\b|\bblood sugar\b/i;
const LOW_SUGAR_SIGN = /\bshak(?:y|ing)\b|\bsweat(?:y|ing)\b|\bconfused\b|\bacting (?:really |kind of |kinda )?(?:strange|weird|odd|off|funny)\b|\bnot making (?:much |any )?sense\b|\bout of it\b|\bpale\b|\bdizzy\b/i;
/** Heavy bleeding (#101): the tourniquet stays on. "If bleeding has stopped, remove the tourniquet immediately" (model-written, sealed long set). */
const HEAVY_BLEEDING = /\btourniquet\b|\bblood (?:is )?(?:everywhere|spurting|pouring|gushing|pumping)\b|\bbleeding (?:a lot|badly|heavily|like crazy)\b|\bwon'?t stop bleeding\b|\bblood won'?t stop\b|\bsoak(?:ed|ing) (?:through|thru)\b/i;

/**
 * Lost (#101): "i think i took a wrong fork", "we lost the trail", "i think im
 * lost" got "Got it" or a decline with the lost card folded. Being lost is
 * what the lost card is for; "found the trail" closes it (record.ts).
 */
const LOST = /\b(?:i'?m|i am|we'?re|we are|im|i think i'?m|i think im|think we'?re|pretty sure i'?m|pretty sure we'?re|getting)\s+(?:totally |completely |kind of |kinda |a bit )?lost\b|\blost the (?:trail|path|way)\b|\b(?:took|take) a wrong (?:turn|fork|trail|way)\b|\bwrong (?:fork|turn) (?:back|a while|hours|an hour)\b|\bcan'?t find the (?:trail|path|way back)\b|\bnothing looks familiar\b|\bno idea where (?:we|i) (?:are|am)\b|\bdon'?t know where (?:we|i) (?:are|am)\b/i;

export const CONDITIONS: readonly Condition[] = [
  // Snakebite: "Don't put ice on it", "Don't put a tourniquet on the limb",
  // "Don't cut the bite open or try to suck out the venom", and the limb
  // stays "slightly below the level of the heart".
  { id: 'snakebite', label: 'snakebite', card: 'Snakebite', said: snakebiteSaid,
    forbidden: /\bice\b|\b(?:cold|cool) (?:compress|pack)|\btourniquet|\bsuck|\bcut (?:into|open|the bite)|\belevat|\braise (?:it|the (?:leg|arm|limb|ankle|foot|calf))|\bRICE\b/i },
  // Burns: "Don't use ice or ice water", "Don't put butter, grease, ointments
  // or home remedies on a burn"; a blistering burn is covered, not opened.
  { id: 'burn', label: 'burn', card: 'Burns', said: (ms) => ms.some((m) => BURN.test(m)),
    // Any opening of a blister counts, whatever the answer calls it: "drain
    // them with a sterile needle", of the "bubbles" on a burned arm
    // (confirmation chat set).
    forbidden: /\bice\b|\bbutter\b|\bgrease\b|\bointments?\b|\btoothpaste\b|\b(?:pop|popping|drain|draining|puncture|puncturing|lance|lancing|burst|bursting|prick|pricking)\b|\bneedle\b/i },
  // Frostbite: "Don't rub or massage it", "Don't hold it near a fire to thaw it."
  { id: 'frostbite', label: 'frostbite', card: 'Frostbite and frostnip', said: (ms) => ms.some((m) => FROSTBITE.test(m)),
    forbidden: /\b(?:rub|massag)\w*|\b(?:by|near|over|next to|in front of) (?:a|the) fire\b/i },
  { id: 'lost', label: 'being lost', card: 'Lost: should I stay or keep moving?', said: (ms) => ms.some((m) => LOST.test(m)), situation: true },
  // Altitude illness: "go down to lower altitude right away", "Don't wait at
  // the same height". No forbidden advice: what goes wrong is missing the card.
  { id: 'altitude', label: 'altitude', card: 'Altitude illness', said: inSetting(HIGH, ALTITUDE_SIGN), explains: true },
  // Heat illness in heat: "Don't give alcohol or caffeine."
  { id: 'heat', label: 'heat', card: 'Heat exhaustion and heat stroke', said: inSetting(HOT, HEAT_SIGN),
    forbidden: /\balcohol\b|\bcaffeine\b/i, explains: true },
  // Low blood sugar: "If they are unconscious or can't swallow, give nothing by mouth."
  { id: 'low-sugar', label: 'low blood sugar', card: 'Low blood sugar', said: inSetting(DIABETIC, LOW_SUGAR_SIGN), explains: true },
  // Heavy bleeding: "Don't loosen or remove a tourniquet once it's on."
  { id: 'bleeding', label: 'bleeding', card: 'Heavy bleeding from a wound', said: (ms) => ms.some((m) => HEAVY_BLEEDING.test(m)),
    forbidden: /\b(?:remove|loosen|take off|release|undo|untie)\w*\b[^.]*\btourniquet\b|\btourniquet\b[^.]*\b(?:remove|loosen|take it off|release)\w*/i },
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
  // Seizure: "Keep them from getting hurt while it happens". After cold
  // exposure, shaking is shivering: "i still can't stop shaking" on a cold
  // night opened the seizure card (phone, 2026-09-30). The hypothermia card
  // leads, the seizure card a tap away ("No, something else").
  'Seizure': ['hypothermia'],
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
