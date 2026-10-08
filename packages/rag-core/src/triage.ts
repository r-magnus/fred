/**
 * Danger signs, and whether a message asks something (#98 round 2,
 * docs/plan-understand-2.md steps 3 and 4).
 *
 * Every professional triage system reaches "emergency" through a positive
 * danger sign, never because no protocol matched (research-conversation-
 * safety.md). Round 1 showed the safety net ("call emergency services") for
 * downhill knee pain, a burn blister and "is it safe to touch cholla", because
 * the model called them NOW and nothing matched. The get-help-now reply now
 * needs a danger sign in the hiker's words.
 *
 * The signs are the wilderness "go fast" list (WMS, NOLS) as the field cards
 * word them in their get-help lines: breathing, waking, bleeding that won't
 * stop, confusion, chest pain, stroke signs, a swelling throat, heat stroke,
 * a snakebite, seizures, cold water, a big animal close by. Written as phrases a hiker types.
 */
import { conditionsIn, soakedWithBlood } from './conditions.ts';

const SIGNS: readonly RegExp[] = [
  // Breathing (cpr, choking, anaphylaxis).
  /\b(?:not|isn'?t|is not|aren'?t|stopped|quit|no longer|barely) breathing\b|\bcan'?t (?:breathe|breath)\b|\b(?:trouble|struggling|hard|difficulty) (?:to )?breath(?:e|ing)?\b|\bgasping\b|\bchoking\b|\bcan'?t (?:talk|speak|make a sound)\b/i,
  // Waking and responding (unresponsive, head-injury, seizure).
  /\b(?:won'?t|will not|can'?t|cannot) (?:wake|be woken|respond)\b|\bnot (?:waking|responding|responsive|moving)\b|\bunresponsive\b|\bunconscious\b|\bpassed out\b|\bknocked out\b|\bseizure\b|\bjerking\b|\bconvuls/i,
  // Bleeding that won't stop (bleeding-severe, bleeding-soaked). Blood soaking
  // through a dressing is read apart (soakedWithBlood): wet boots are not it.
  /\bblood (?:is )?(?:everywhere|spurting|pouring|gushing|pumping|pushing|keeps|won'?t stop)\b|\bbleeding (?:a lot|badly|bad|heavily|won'?t stop|wont stop|like crazy)\b|\bwon'?t stop bleeding\b|\bkeeps? (?:pouring|gushing|spurting|pushing) out\b/i,
  // Confusion and changed behaviour (head-injury, heat-illness, hypothermia, altitude, low-blood-sugar).
  /\bconfus(?:ed|ion)\b|\bnot making (?:any )?sense\b|\bdoesn'?t (?:know|recognize) (?:where|who)\b|\bslurr(?:ing|ed|y)\b|\bstumbling\b|\bdisoriented\b|\bdelirious\b|\bout of it\b/i,
  // Heart and stroke (heart-stroke).
  /\bchest (?:pain|hurts|feels (?:heavy|tight)|is (?:heavy|tight)|pressure)\b|\bheart attack\b|\bstroke\b|\b(?:face|mouth|smile) (?:is )?droop|\bone side of (?:his|her|their|my) (?:face|body)\b|\btalking funny\b/i,
  // Allergy (anaphylaxis).
  /\b(?:lips|tongue|throat|mouth|face|eyes) (?:is |are )?(?:swelling|swollen|puffing|puffed|closing|tight)\b|\bthroat (?:feels |is )?(?:tight|closing)\b|\bhard to swallow\b|\banaphyla/i,
  // Heat stroke (heat-illness).
  /\bheat ?stroke\b|\bstopped sweating\b|\b(?:skin is |skin'?s )?hot and dry\b/i,
  // Cold water and severe cold (hypothermia).
  /\bstopped shivering\b|\bwent through the ice\b|\bdrown/i,
  // Water rising around them, swept away, fire closing in, trapped on a ledge
  // (#115, #100: these lost the get-help-now reply on round 1's sealed set).
  /\b(?:water|river|creek|flood)\b[^.?!]{0,30}\b(?:rising|coming up|getting higher|surrounding)\b|\b(?:swept|washed) (?:away|downstream|off (?:his|her|my|their) feet)\b|\b(?:wild)?(?:fire|flames|smoke)\b[^.?!]{0,40}\b(?:coming (?:at|toward|towards|our way|up|down|over)|heading (?:our way|for us|toward|towards)|moving (?:toward|towards)|spreading (?:toward|towards)|getting (?:closer|close)|closing in|all around|surrounding|cut (?:us )?off|toward(?:s)? (?:us|our|me|camp))\b|\btrapped by (?:the )?(?:fire|flames|water|flood)\b|\b(?:stuck|stranded|trapped|cliffed out) on (?:a|the|this) (?:ledge|cliff)\b|\bcliffed out\b|\bcan'?t (?:climb|get) (?:up or down|down or up|off (?:the|this) (?:ledge|cliff))\b/i,
  // A bone through the skin (fracture), a stab or a gunshot, lightning.
  /\bbone (?:is )?(?:sticking|poking) (?:out|through)\b|\bstabbed\b|\bimpaled\b|\bshot\b(?! of)|\bstruck by lightning\b|\blightning (?:hit|struck)\b/i,
];

/**
 * "collapsed" is a danger sign for a person, not a tent: "the tent collapsed
 * in the wind" is not an emergency.
 */
const COLLAPSED = /\bcollaps(?:ed|es|ing)\b|\bkeeled over\b/i;
const THINGS = /\b(?:tent|tarp|shelter|bridge|snow ?cave|roof|wall|chair|table|stove|pole)s?\b/i;

/**
 * A big animal close by, charging, attacking ("a mountain lion just jumped my
 * friend", wildlife set, #117) or getting into camp (bear-encounter): read
 * across the thread, because "something big is sniffing around the tent" and
 * "its a bear" arrive as two messages.
 */
const ANIMAL = /\b(?:bears?|grizzl(?:y|ies)|mountain lions?|cougars?|pumas?|moose|bison|buffalo|wolf|wolves)\b/i;
const CLOSE = /\b(?:charg(?:e|es|ed|ing)|attack(?:s|ed|ing)?|jump(?:ed|s|ing)|pounc(?:e|ed|es|ing)|maul(?:ed|ing|s)?|grab(?:bed|s|bing)|bitten|clawed|knocked (?:him|her|me|them) down|coming (?:at|toward|towards|straight)|stalking|following|staring|snuffl(?:e|es|ed|ing)|outside|in front of|right (?:there|here|next to)|outside (?:the|our|my) tent|in (?:our|the) camp|into (?:our|the) camp|getting into|sniffing|rustling|close|near)\b/i;

/**
 * Drowsiness or vomiting after a knock to the head (head-injury card:
 * "drowsiness", "nausea or vomiting"; WMS: a changed mental state after a head
 * injury means getting out fast). Read across the thread: "my boy fell off a
 * big rock and smacked his head" / "he can barely keep his eyes open".
 */
const HEAD = /\b(?:hit|smacked|bumped|banged|cracked|knocked) (?:his|her|my|their|the) head\b|\bhead (?:injury|wound|knock)\b|\bconcuss/i;
const DROWSY = /\bsleepy\b|\bdrowsy\b|\b(?:keep|keeping) (?:his|her|their|my) eyes open\b|\bstay awake\b|\bvomit|\bthrowing up\b|\bthrew up\b/i;

/** A snakebite is urgent by itself: "Get medical help right away" (snakebite card). */

/** True when the hiker's messages (the current thread, oldest first) show a danger sign. */
export function dangerSign(messages: readonly string[]): boolean {
  if (messages.some((m) => SIGNS.some((s) => s.test(m)) || (COLLAPSED.test(m) && !THINGS.test(m)) || soakedWithBlood(m))) return true;
  const all = messages.join(' / ');
  if (ANIMAL.test(all) && CLOSE.test(all)) return true;
  if (HEAD.test(all) && DROWSY.test(all)) return true;
  return conditionsIn(messages).some((c) => c.id === 'snakebite');
}

/**
 * A message that asks something is never small talk. The start of the message
 * or of a clause ("ok she's feeling better. unrelated but what's this plant"),
 * a question mark, or a request for help. Round 1's understanding step called
 * "how much water" and "should i follow it down" CHAT, and Fred said "Got it".
 */
const ASKS = /\?|(?:^|[.,;!]\s*|\b(?:but|so|and|ok|okay|also|then|unrelated|btw)\s+)(?:how|what|what'?s|whats|where|when|why|which|who|can|could|is|are|do|does|did|should|shall|will|would|any|anything|tips?|help)\b|\b(?:should|can|could|do|shall) (?:i|we|you)\b|\bis (?:it|this|that) (?:ok|okay|safe|bad|normal)\b|\bwhat (?:helps|now|next)\b|\bany (?:tips|tricks|ideas|advice)\b/i;

export function asksSomething(message: string): boolean {
  return ASKS.test(message);
}

/**
 * Asking whether something unnamed is safe to eat: "these little red berries
 * look tasty" / "can i eat them". Answered from a species page, the model
 * said red baneberry "can be eaten" (sealed chat set, #98 round 2). The field
 * card's rule is the answer: only eat what you can positively identify.
 */
const EAT = /\b(?:eat|edible|eatable)\b/i;
/**
 * The thing to eat is unnamed: "eat them", "are these edible", or generic
 * berries, mushrooms or wild plants. A stray "it" is not enough: "did people
 * ever eat California brome, or is it just cattle feed?" names its plant
 * (tuning set, ff-forage-03).
 */
const UNNAMED = /\beat (?:these|this|them|those|that|it|one|some)\b|\b(?:are|is) (?:these|this|those|they|it|that) (?:\w+ )?(?:edible|safe to eat|ok to eat|okay to eat|good to eat)\b|(?:^|\s)(?:wild )?(?:berr(?:y|ies)|mushrooms?|fungus|fungi|wild plants?)\b/i;
export function asksToEatUnknown(message: string): boolean {
  return EAT.test(message) && UNNAMED.test(message) && asksSomething(message);
}

/**
 * The same, across the thread (#101): "my daughter wants to pick berries" /
 * "are these blue ones safe", or "she already ate a couple". The plant was
 * said up to three messages back ("lots of berries" / "the purple ones look
 * good" / "are those safe" / "my kid already tried one"); the question or the
 * eating is in this one.
 */
const FORAGE = /\b(?:berr(?:y|ies)|mushrooms?|fungus|fungi|wild plants?|seeds|nuts|fruit)\b/i;
const EAT_OR_SAFE = /\b(?:eat|ate|eaten|edible|tried (?:one|some|a few|it)|tasted|swallowed|snack on|safe)\b/i;
export function eatingUnknownInThread(message: string, earlier: readonly string[]): boolean {
  return EAT_OR_SAFE.test(message) && !FORAGE.test(message) && earlier.slice(-3).some((m) => FORAGE.test(m)) && !/\b(?:my|our|the) (?:dog|cat|pet|horse)\b/i.test(message);
}

/**
 * A pet is the one hurt or sick. Veterinary care is outside Fred's scope, and
 * the human cards are wrong for an animal: "a snake struck my dog" was
 * answered with the human snakebite steps and "his face is swelling" with the
 * anaphylaxis card (sealed chat set). "my dog and i are lost" is not about
 * the dog's health and does not count.
 */
const PET = '(?:my|our|the)\\s+(?:dog|cat|puppy|kitten|horse|pony|pet|mule|donkey|goat)s?';
const HARM = '(?:bit|bitten|struck|stung|attacked|swelling|swollen|bleeding|limping|ate|eaten|drank|hurt|injured|sick|vomit\\w*|poison\\w*|throwing up|collapsed|has (?:a )?(?:ticks?|burrs?|thorns?|splinters?|fleas|foxtails?)|panting|overheat\\w*)';
const PET_PATIENT = new RegExp(`\\b${HARM}\\b[^.?!]{0,30}\\b${PET}\\b|\\b${PET}\\b(?:'s)?[^.?!]{0,40}\\b(?:${HARM}|face|paw|leg|mouth|nose)\\b`, 'i');
const PERSON = /\b(?:i|i'm|me|my (?!dog|cat|puppy|kitten|horse|pony|pet|mule|donkey|goat)\w+|friend|buddy|wife|husband|son|daughter|kid|child|dad|mom|he's my|someone|person|guy)\b/i;
const PRONOUN = /\b(?:he|she|it|his|her|its|him)\b/i;
/**
 * A person is hurt too: "a raccoon ... attacked my dog and then bit me on the
 * leg" is a person's rabies exposure, and declining it as a pet question left
 * them with nothing (health set, #51). Fred answers for the person.
 */
const PERSON_HURT = new RegExp(`\\b${HARM}\\s+(?:me|us|my (?!dog|cat|puppy|kitten|horse|pony|pet|mule|donkey|goat)\\w+)\\b|\\b(?:i|i'm|i've|we|we've)\\s+(?:was |were |got |been |am |are )?(?:${HARM})\\b`, 'i');
export function petIsPatient(message: string, previous?: string): boolean {
  if (PERSON_HURT.test(message)) return false;
  if (PET_PATIENT.test(message)) return true;
  return previous !== undefined && PET_PATIENT.test(previous) && pointsBackAtPet(message);
}
/** A person is hurt in this message, whatever else it says. */
export function personIsHurt(message: string): boolean {
  return PERSON_HURT.test(message);
}
/** "its bleeding a fair bit" after a message about a pet: a pronoun, and no person. */
export function pointsBackAtPet(message: string): boolean {
  return PRONOUN.test(message) && !PERSON.test(message) && !PERSON_HURT.test(message);
}

/**
 * Stuck on terrain: a ledge, a cliff, unable to go up or down (#126). The
 * signalling card answers it (stay put, signal with whistle, light or bright
 * clothing): no free-to-use source covers being cliffed out, and the general
 * safety net says only to call for help.
 */
const STUCK = /\b(?:stuck|stranded|trapped|cliffed out) on (?:a|the|this) (?:ledge|cliff)\b|\bcliffed out\b|\bcan'?t (?:climb|get) (?:up or down|down or up|off (?:the|this) (?:ledge|cliff))\b/i;
export function stuckOnTerrain(messages: readonly string[]): boolean {
  return messages.some((m) => STUCK.test(m));
}
