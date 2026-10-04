/**
 * A friendly opening line (#130): one short sentence before the answer that
 * shows Fred heard the hiker ("Numb toes in the cold are no fun at all.").
 *
 * Model-written from the hiker's own words only: it never sees the passages,
 * and the answer after it is exactly what Fred would give without it. The
 * model is small and will drift into advice or reassurance, so the line is
 * kept only if fixed rules find none of that; on any doubt there is no
 * opener, which costs nothing but warmth.
 */
import type { InferenceBackend } from './backends.ts';

export const OPENER_SYSTEM = `You are Fred, a kind, calm friend on the trail. Write ONE short sentence (under 15 words) that puts the hiker at ease. Another part of Fred gives the actual answer right after your sentence.
Be friendly and encouraging: comfort how they feel, never promise how things will turn out. Don't start with "Hmm".
Rules: do not answer the question. Give no advice, steps, facts, numbers or warnings. Never say whether something is safe, serious, fine or normal. Do not ask a question.
Examples:
"i'm lost and kind of panicking" -> Take a deep breath, we'll work through this together.
"ugh i forgot my rain jacket" -> Hey, these things happen, it's okay.
"my toes are numb and it's freezing out" -> Oh no, cold toes are miserable, let's sort this out.
"how do i keep bugs out of my tent" -> Good thinking to plan ahead for the bugs.
"is it ok to camp near a stream" -> Glad you asked before setting up.`;

/** How much of the conversation the opener sees: the hiker's last messages. */
const EARLIER = 2;

/** Words that tell the hiker to do something, or point them somewhere. */
const ADVICE = /\b(?:you should|you'?ll want|you need|you must|you can|you could|you might|try|make sure|be sure|remember|don'?t|do not|never|always|avoid|keep|stay|apply|call|seek|drink|eat|use|check|head (?:back|out|down)|turn back|let'?s(?! (?:figure|sort|work|get through|see what we can do|take care of (?:it|this)|take (?:it|this) one step at a time|look at this together))|(?<!let'?s )take(?! a (?:deep )?breath| a moment| care of (?:it|this)| (?:it|this) one step at a time)|best|important|recommend|get help|wash|rest|cover|remove|pull|treat|carry|bring|wait|go (?:back|see|to))\b/i;

/** Reassurance, judgment of risk, and guesses about what it is. */
const JUDGES = /\b(?:worr(?:y|ies)|it'?ll be|everyone|everybody|you'?ll be|you'?re (?:going to|gonna) be|fine|safe(?:ly|r)?|unsafe|danger(?:ous)?|deadly|risk(?:y|s)?|serious(?:ly)?|harmless|normal|common|rare|probably|likely|maybe|might|may|could be|nothing to|no big deal|minor|severe|mild|poison(?:ous)?|venom(?:ous)?|toxic|infect\w*|allerg\w*|emergency|urgent|heal\w*|recover\w*|go away|pass soon|trouble|could mean|means|sign(?:s)? of|tasty|delicious|yum\w*|refreshing|clean|pure)\b/i;

/** A yes/no or is-it-all-right question: "is it ok to drink from this pond". */
const ASKS_YES_NO = /^\s*(?:is|are|can|could|should|shall|do|does|did|will|would|am|may|might)\b|\b(?:is (?:it|this|that)|can (?:i|we|you|he|she|they)|should (?:i|we|he|she|they)|(?:ok(?:ay)?|safe|fine|alright|normal|bad) (?:to|if|for|that))\b/i;

/** Words that could read as permission or "it's fine". */
const AFFIRMS = /\b(?:ok(?:ay)?|alright|right|good|great|sure|yes|nice|happen\w*|fun|enjoy|love|awesome|exciting|wonderful|amazing|beautiful|lovely|smart)\b/i;

/** A count or amount is a claim, spelled out or not. */
const NUMBER_WORDS = /\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|dozen|half)\b/i;

/** Fred talking about itself rather than the hiker. */
const SELF = /\bI (?:can'?t|cannot|don'?t have|am not|'m not|(?:can )?see)\b|\blooking at\b|\bdoctor\b|\bAI\b|\bassistant\b|\bsources?\b|\bguides?\b/i;

/** Names a condition: allowed only when the hiker named it first. */
const CONDITIONS = /\b(?:sprain\w*|strain\w*|fractur\w*|broken|break|heat ?(?:exhaustion|stroke)|hypotherm\w*|hyperthermi\w*|dehydrat\w*|altitude sickness|concuss\w*|frostbit\w*|frostnip|trench foot|giardia\w*|lyme|rabi\w*|shock|stroke|heart attack|hyponatrem\w*|food poisoning|flu|virus|bacteri\w*|tendon\w*|tendinitis|ligament\w*|sunstroke|blister\w*|sunburn\w*|rash)\b/gi;

/**
 * The only words an opener may use besides the hiker's own (#130). A blocklist
 * could not keep up: on the first sealed run, lines that named no banned word
 * still said "food at camp should be stored in a cool, dry place" and gave
 * poison oak "a white or yellowish sap". A line built from the hiker's words
 * and this vocabulary can react, but cannot bring in a fact.
 */
const GLUE = new Set(`a an the that this these those it its it's that's there's what's is are was were be been can could would will
sound sounds sounding like feel feels felt feeling seem seems so such really very quite pretty bit little of to on in at for with
from and or but your you you're you've we we're our us my i i'm me all after when while out there here up down back
make makes making for get gets getting have has had just still both one's way handle deal through around off over before about now`.split(/\s+/));
const FEELING = new Set(`fun tough rough hard uncomfortable annoying painful miserable frustrating stressful scary frightening
unsettling nerve-wracking tiring exhausting draining long tricky exciting amazing wonderful great awesome beautiful lovely
fascinating interesting rewarding nice ouch oh ugh yikes wow nasty unpleasant bother bummer sorry glad love enjoy
congratulations congrats well done no`.split(/\s+/));
/** Comfort about how it feels and what to do next together, not about how it ends. */
const COMFORT = new Set(`hey happen happens happened take deep breath breathe together we'll let's sort figure work
through asking ask asked thinking smart plan planning ahead okay ok alright right thing step steps one here glad good
see do care look handle`.split(/\s+/));
/** The comfort words that by themselves make a line warm. */
const WARM = new Set(['hey', 'happen', 'happens', 'happened', 'breath', 'breathe', 'together', 'glad', 'okay', 'ok', 'alright', 'thinking', 'smart']);
const SETTING = new Set(`day days hike hikes hiking trail trails trip night nights morning afternoon evening time spot moment
walk climb outdoors camp camping weather part start adventure out watch week hours miles summit top mountain woods
heat hot cold chill rain wet wind snow sun dark storm gear pack boots shoes tent
legs feet body hands arms knees back nose throat skin head`.split(/\s+/));

function known(word: string, said: readonly string[]): boolean {
  const w = word.replace(/^'+|'+$/g, '');
  if (w === '' || GLUE.has(w) || FEELING.has(w) || COMFORT.has(w) || SETTING.has(w)) return true;
  // Forms of an allowed word: "hikes", "watching", "tired".
  const base = w.replace(/(?:ing|ed|es|s)$/, '');
  if (base.length >= 3 && [...GLUE, ...FEELING, ...COMFORT, ...SETTING].some((k) => k.startsWith(base))) return true;
  // The hiker's own words, in any form: "cramping" for "cramps", "arguments"
  // for "arguing".
  const stem = w.slice(0, 4);
  return said.some((h) => h === w || (w.length >= 4 && h.startsWith(stem)));
}

/**
 * The line if it passes, or null. One sentence of 3-18 words; no digits, no
 * question, no advice, no judgment of risk, no talk about Fred, and no
 * condition the hiker hasn't named.
 */
export function checkOpener(raw: string, messages: readonly string[]): string | null {
  // Only the first sentence is shown: the phone stops there (a stop string),
  // and the desktop, which ignores stop strings, is cut the same way here.
  const first = raw.trim().replace(/^(?:->|Fred:)\s*/i, '').split(/(?<=[.!])\s+/)[0] ?? '';
  const line = first.replace(/^["“']|["”']$/g, '').trim();
  if (line === '' || /[\n?\d]/.test(line) || NUMBER_WORDS.test(line)) return null;
  const words = line.split(/\s+/).length;
  if (words < 3 || words > 18) return null;
  if (ADVICE.test(line) || JUDGES.test(line) || SELF.test(line)) return null;
  // Every word is the hiker's or from the fixed vocabulary, and at least one
  // says how it feels: a bare echo ("your knee hurts on the way down") is dropped.
  const said = messages.join(' ').toLowerCase();
  const saidWords = said.split(/[^a-z']+/).filter((w) => w !== '');
  const words2 = line.toLowerCase().split(/[^a-z'-]+/).filter((w) => w !== '');
  if (!words2.every((w) => known(w, saidWords))) return null;
  if (!words2.some((w) => (FEELING.has(w) && w !== 'no') || WARM.has(w))) return null;
  // "Okay" closes a phrase ("it's okay."), never "okay to swim".
  if (/\b(?:ok(?:ay)?|alright)\b(?!\s*(?:[.!,;:\u2013\u2014-]|$))/i.test(line)) return null;
  // Asked whether something is all right, the opener must not sound like a yes.
  if (ASKS_YES_NO.test(messages[messages.length - 1] ?? '') && AFFIRMS.test(line)) return null;
  for (const m of line.matchAll(CONDITIONS)) {
    if (!said.includes(m[0].toLowerCase().slice(0, 5))) return null;
  }
  return /[.!]$/.test(line) ? line : `${line}.`;
}

/** The user turn: the hiker's last messages, then this one. */
export function openerUser(message: string, history: readonly string[]): string {
  const earlier = history.filter((h) => h.trim() !== '').slice(-EARLIER);
  const before = earlier.length === 0 ? '' : `Earlier the hiker said: ${earlier.map((h) => `"${h}"`).join(' ')}\n`;
  return `${before}"${message}" ->`;
}

/** The opening line for this message, or null when the model's line fails the check. */
export async function makeOpener(
  message: string,
  history: readonly string[],
  backend: InferenceBackend,
  signal?: AbortSignal,
): Promise<string | null> {
  const earlier = history.filter((h) => h.trim() !== '').slice(-EARLIER);
  let out = '';
  for await (const tok of backend.generate(
    { system: OPENER_SYSTEM, user: openerUser(message, history) },
    { maxTokens: 30, temperature: 0, stop: ['\n', '.', '!'], lane: 'opener', ...(signal === undefined ? {} : { signal }) },
  )) out += tok;
  // Stopped at the first sentence end, which the stop string leaves off.
  return checkOpener(out, [...earlier, message]);
}
