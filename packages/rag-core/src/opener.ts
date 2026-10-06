/**
 * A friendly opening line (#130): one short sentence before the answer that
 * shows Fred heard the hiker and names what they asked about ("Happy to help
 * you hang a hammock between trees.").
 *
 * Model-written from the hiker's own words only: it never sees the passages,
 * and the answer after it is exactly what Fred would give without it. The
 * model is small and will drift into advice or reassurance, so the line is
 * kept only if fixed rules find none of that; on any doubt there is no
 * opener, which costs nothing but warmth.
 */
import type { InferenceBackend } from './backends.ts';

export const OPENER_SYSTEM = `You are Fred, a kind, calm friend on the trail. The hiker just said something. Write ONE short sentence (under 15 words) that shows you heard them: it must name what THEY are talking about, in their own words. Another part of Fred gives the actual answer right after your sentence.
Match what they said:
- They ask how to do something, what something is, or for tips: offer to help with that exact thing.
- Something is hurting, broken or going wrong: say you're sorry about that exact thing.
- They are scared, worried or upset: calm them, naming what worries them.
- They ask whether something is okay or safe, or whether they can or should do something: thank them for asking about it, and never hint at the answer.
Say "oh no" or "sorry" only when something is hurting, broken or going wrong, never for a plain question.
Rules: do not answer the question. Give no advice, steps, facts, numbers or warnings. Never say whether something is safe, serious, fine or normal. Never promise how things will turn out. Do not ask a question. Don't start with "Hmm".
When the message is followed by (start with "..."), begin your sentence with exactly those words.
Examples:
"how do i make a fishing hook" (start with "Happy to help") -> Happy to help you make a fishing hook.
"how do i make a fishing hook" (start with "Sure, let's") -> Sure, let's work out how to make a fishing hook.
"how do i make a fishing hook" (start with "Good question") -> Good question about making a fishing hook.
"what are those tall purple flowers" (start with "Happy to help") -> Happy to help you work out what those tall purple flowers are.
"what are those tall purple flowers" (start with "Sure, let's") -> Sure, let's figure out what those tall purple flowers are.
"what are those tall purple flowers" (start with "Good question") -> Good question about those tall purple flowers.
"any tips for cooking on a campfire" (start with "Sure, let's") -> Sure, let's look at cooking on a campfire.
"is it ok to camp near a stream" (start with "Glad you asked") -> Glad you asked about camping near a stream.
"is it ok to camp near a stream" (start with "Good question") -> Good question about camping near a stream.
"can i burn pine cones in the fire" (start with "Glad you asked") -> Glad you asked about burning pine cones.
"should we cross the snowfield this late" (start with "Good question") -> Good question about crossing the snowfield.
"ugh i forgot my rain jacket" -> Oh no, sorry about the rain jacket.
"my toes are numb and it's freezing out" -> Oh no, numb toes in the cold are no fun.
"i think i walked through stinging nettles" -> Ouch, stinging nettles are nasty, sorry you're dealing with that.
"my back is killing me from this pack" -> Ouch, sorry your back is hurting from the pack.
"the trail is flooded and we can't get through" -> Ugh, a flooded trail is frustrating.
"i'm lost and kind of panicking" -> Take a deep breath, being lost is scary, we'll work through it together.
"we finally reached the lake!" -> Well done on reaching the lake!`;

/** How much of the conversation the opener sees: the hiker's last messages. */
const EARLIER = 2;

/** Words that tell the hiker to do something, or point them somewhere. */
const ADVICE = /\b(?:you should|you'?ll want|you need|you must|you can|you could|you might|try|make sure|be sure|remember|don'?t|do not|never|always|avoid|keep|stay|apply|call|seek|drink|eat|use|check|head (?:back|out|down)|turn back|let'?s(?! (?:figure|sort|work|look at|get through|see what we can do|take care of (?:it|this)|take (?:it|this) one step at a time|look at this together))|(?<!let'?s )take(?! a (?:deep )?breath| a moment| care of (?:it|this)| (?:it|this) one step at a time)|best|important|recommend|get help|wash|rest|cover|remove|pull|treat|carry|bring|wait|go (?:back|see|to))\b/i;

/** Reassurance, judgment of risk, and guesses about what it is. */
const JUDGES = /\b(?:worr(?:y|ies)|it'?ll be|everyone|everybody|you'?ll be|you'?re (?:going to|gonna) be|fine|safe(?:ly|r)?|unsafe|danger(?:ous)?|deadly|risk(?:y|s)?|serious(?:ly)?|harmless|normal|common|rare|probably|likely|maybe|might|may|could be|nothing to|no big deal|minor|severe|mild|poison(?:ous)?|venom(?:ous)?|toxic|infect\w*|allerg\w*|emergency|urgent|heal\w*|recover\w*|go away|pass soon|not good|no good|trouble|could mean|means|sign(?:s)? of|tasty|delicious|yum\w*|refreshing|clean|pure)\b/i;

/** A yes/no or is-it-all-right question: "is it ok to drink from this pond". */
const ASKS_YES_NO = /^\s*(?:is|are|can|could|should|shall|do|does|did|will|would|am|may|might)\b|(?<!\b(?:what|how|where|when|which|who|why)\s)\b(?:is (?:it|this|that)|can (?:i|we|you|he|she|they)|should (?:i|we|he|she|they)|(?:ok(?:ay)?|safe|fine|alright|normal|bad) (?:to|if|for|that))\b/i;

/** Words that could read as permission or "it's fine". */
const AFFIRMS = /\b(?:ok(?:ay)?|alright|right|good|great|sure|yes|nice|happen\w*|fun|enjoy|love|awesome|exciting|wonderful|amazing|beautiful|lovely|smart|well done|congrat\w*)\b/i;

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
make makes making for get gets getting have has had just still both one's way handle deal through around off over before about now how being not going goes`.split(/\s+/));
const FEELING = new Set(`fun tough rough hard uncomfortable annoying painful miserable frustrating stressful scary frightening
unsettling nerve-wracking tiring exhausting draining long tricky exciting amazing wonderful great awesome beautiful lovely
fascinating interesting rewarding nice ouch oh ugh yikes wow nasty unpleasant bother bummer sorry glad love enjoy
congratulations congrats well done no happy big achievement reach reaching`.split(/\s+/));
/** Comfort about how it feels and what to do next together, not about how it ends. */
const COMFORT = new Set(`hey happen happens happened take deep breath breathe together we'll let's sort figure work
through asking ask asked thinking smart plan planning ahead okay ok alright right thing step steps one here glad good
see do care look handle help helping hear question about what they dealing
prepare ready fix start started learn choose pick sure i'm with`.split(/\s+/));
/** The comfort words that by themselves make a line warm. */
const WARM = new Set(['happy', 'hey', 'happen', 'happens', 'happened', 'breath', 'breathe', 'together', 'glad', 'okay', 'ok', 'alright', 'thinking', 'smart']);
const SETTING = new Set(`day days hike hikes hiking trail trails trip night nights morning afternoon evening time spot moment
walk climb outdoors camp camping weather part start adventure out watch week hours miles summit top mountain woods
heat hot cold chill rain wet wind snow sun dark storm gear pack boots shoes tent
legs feet body hands arms knees back nose throat skin head hurt hurting hurts ache aching aches mood`.split(/\s+/));

/** "dogs" for "dog", "eating" for "eat", "hiking" for "hike", "stopped" for "stop". */
function formOf(w: string, h: string): boolean {
  if (h.length < 3 || GLUE.has(h)) return false;
  const last = h[h.length - 1]!;
  return [`${h}s`, `${h}es`, `${h}ed`, `${h}d`, `${h}ing`, `${h}${last}ing`, `${h}${last}ed`, `${h.slice(0, -1)}ing`, `${h.slice(0, -1)}ies`].includes(w);
}

function known(word: string, said: readonly string[]): boolean {
  const w = word.replace(/^'+|'+$/g, '');
  if (w === '' || GLUE.has(w) || FEELING.has(w) || COMFORT.has(w) || SETTING.has(w)) return true;
  // Forms of an allowed word: "hikes", "watching", "tired".
  const base = w.replace(/(?:ing|ed|es|s)$/, '');
  if (base.length >= 3 && [...GLUE, ...FEELING, ...COMFORT, ...SETTING].some((k) => k.startsWith(base))) return true;
  // The hiker's own words, in any form: "cramping" for "cramps", "arguments"
  // for "arguing".
  const stem = w.slice(0, 4);
  return said.some((h) => h === w || (w.length >= 4 && h.startsWith(stem)) || formOf(w, h));
}

/** Words too plain to show what a message is about. */
const PLAIN = new Set(`how what why when where which who does did should shall may might any some not don't can't won't
tips best good way ways thing things know need want keep going get got getting make made doing done much many more most
safe okay fine bad kind sort lot lots really always never every think thinks`.split(/\s+/));

/** The hiker's words that say what the message is about: "rope", "plant", "fibers". */
function topicWords(message: string): string[] {
  return message.toLowerCase().split(/[^a-z']+/).filter((w) => w.length >= 3 && !GLUE.has(w) && !PLAIN.has(w));
}

/** Sympathy: right for a problem, wrong for a plain question, and a hint at "no" after "can i eat these". */
const SYMPATHY = /\b(?:oh no|ouch|ugh|yikes|sorry|bummer)\b/i;
/** Praise and delight, which sympathy cannot sit beside ("Oh no, those birds are fascinating"). */
const DELIGHT = /\b(?:fascinating|interesting|amazing|wonderful|awesome|beautiful|lovely|exciting|well done|congrat\w*|great|nice)\b/i;
/** A plain question: it opens with a question word. */
const ASKS = /^\s*(?:how|what|what's|where|which|why|when|who|any)\b/i;

/** A plant the hiker named, whose name would otherwise read as a judgment. */
const NAMED_PLANT = /\bpoison (?:oak|ivy|sumac)\b/gi;

/**
 * The line if it passes, or why it fails. One sentence of 3-18 words about
 * what the hiker just said; no digits, no question, no advice, no judgment of
 * risk, no talk about Fred, and no condition the hiker hasn't named.
 */
export function explainOpener(raw: string, messages: readonly string[]): { line: string | null; why?: string } {
  const no = (why: string): { line: null; why: string } => ({ line: null, why });
  // Only the first sentence is shown: the phone stops there (a stop string),
  // and the desktop, which ignores stop strings, is cut the same way here.
  const first = raw.trim().replace(/^(?:->|Fred:)\s*/i, '').split(/(?<=[.!])\s+/)[0] ?? '';
  const line = first.replace(/^["“']|["”']$/g, '').trim();
  if (line === '' || /[\n?\d]/.test(line) || NUMBER_WORDS.test(line)) return no('empty, a question or a number');
  const words = line.split(/\s+/).length;
  if (words < 3 || words > 18) return no('length');
  const said = messages.join(' ').toLowerCase();
  // "Poison oak" is a name when the hiker said it, not a judgment.
  const judged = line.replace(NAMED_PLANT, (m) => (said.includes(m.toLowerCase()) ? '' : m));
  const saidWords = said.split(/[^a-z']+/).filter((w) => w !== '');
  // "Happy to help you keep your phone battery going": after an offer to
  // help, the hiker's own verb is their request, not Fred's advice.
  const offer = /^(?:happy to help|sure, let's (?:work|figure) out|good question)\b/i.test(line);
  const mine = line.replace(new RegExp(ADVICE.source, 'gi'), (m) => (offer && saidWords.includes(m.toLowerCase().split(' ').pop()!) ? '' : m));
  for (const [name, re] of [['advice', ADVICE], ['judgment', JUDGES], ['about Fred', SELF]] as const) {
    const m = re.exec(name === 'judgment' ? judged : name === 'advice' ? mine : line);
    // "Everyone" is the hiker's group when the hiker said so.
    if (m !== null && name === 'judgment' && /^every(?:one|body)$/i.test(m[0]) && said.includes(m[0].toLowerCase())) continue;
    if (m !== null) return no(`${name}: ${m[0]}`);
  }
  // Every word is the hiker's or from the fixed vocabulary, and at least one
  // says how it feels: a bare echo ("your knee hurts on the way down") is dropped.
  const words2 = line.toLowerCase().split(/[^a-z'-]+/).filter((w) => w !== '');
  const unknown = words2.find((w) => !known(w, saidWords));
  if (unknown !== undefined) return no(`word: ${unknown}`);
  if (!offer && !words2.some((w) => (FEELING.has(w) && w !== 'no') || WARM.has(w))) return no('no warm word');
  // The hiker's message handed back says nothing ("So tired, we still have a long way to go.").
  if (words2.every((w) => saidWords.includes(w))) return no('only an echo');
  // It names what this message is about: "Hey, these things happen, it's
  // okay." said nothing to "how do i make rope from plant fibers".
  const topic = topicWords(messages[messages.length - 1] ?? '');
  if (!words2.some((w) => topic.some((t) => t === w || (w.length >= 4 && t.startsWith(w.slice(0, 4))) || formOf(w, t)))) return no('not about the message');
  const latest = messages[messages.length - 1] ?? '';
  if (SYMPATHY.test(line) && (ASKS.test(latest) || ASKS_YES_NO.test(latest))) return no('sympathy for a question');
  // "Happy to help you cook those mushrooms" answers "can i cook them".
  if (/^(?:happy to help|sure)\b/i.test(line) && ASKS_YES_NO.test(latest)) return no('an offer reads as yes');
  if (SYMPATHY.test(line) && DELIGHT.test(line)) return no('sympathy with delight');
  // "Okay" closes a phrase ("it's okay."), never "okay to swim".
  if (/\b(?:ok(?:ay)?|alright)\b(?!\s*(?:[.!,;:\u2013\u2014-]|$))/i.test(line)) return no('okay to');
  // Asked whether something is all right, the opener must not sound like a yes.
  // "Good question about eating snow" praises the asking, not the eating.
  const yes = AFFIRMS.exec(line.replace(/^good question\b/i, ''));
  if (ASKS_YES_NO.test(messages[messages.length - 1] ?? '') && yes !== null) return no(`reads as yes: ${yes[0]}`);
  for (const m of line.matchAll(CONDITIONS)) {
    if (!said.includes(m[0].toLowerCase().slice(0, 5))) return no(`condition: ${m[0]}`);
  }
  return { line: /[.!]$/.test(line) ? line : `${line}.` };
}

/** The line if it passes, or null. */
export function checkOpener(raw: string, messages: readonly string[]): string | null {
  return explainOpener(raw, messages).line;
}

/** How a plain question's opener may begin, and a yes/no question's. */
const STARTS_QUESTION = ['Happy to help', "Sure, let's", 'Good question'];
const STARTS_YES_NO = ['Glad you asked', 'Good question'];
function hashOf(message: string): number {
  let h = 2166136261;
  for (const c of message.trim().toLowerCase()) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
function startsFor(message: string): readonly string[] | null {
  return ASKS_YES_NO.test(message) ? STARTS_YES_NO : ASKS.test(message) ? STARTS_QUESTION : null;
}

/**
 * The words a question's opener begins with, or null for a message that is
 * not a plain question (a problem, a worry: the model picks its own). A model
 * this small writes every how-to opener in the one shape its examples favour
 * ("Happy to help you..."), so the first words are picked here, from the
 * message, and never the ones the message before it would have got.
 */
export function openerStart(message: string, earlier: readonly string[]): string | null {
  const starts = startsFor(message);
  if (starts === null) return null;
  const mine = hashOf(message) % starts.length;
  const last = earlier[earlier.length - 1];
  const before = last === undefined ? null : startsFor(last);
  const taken = before === null ? null : before[hashOf(last!) % before.length];
  return starts[mine] === taken ? starts[(mine + 1) % starts.length]! : starts[mine]!;
}

/** The user turn: the hiker's last messages, this one, and for a question its first words. */
export function openerUser(message: string, history: readonly string[]): string {
  const earlier = history.filter((h) => h.trim() !== '').slice(-EARLIER);
  const before = earlier.length === 0 ? '' : `Earlier the hiker said: ${earlier.map((h) => `"${h}"`).join(' ')}\n`;
  const start = openerStart(message, earlier);
  return `${before}"${message}"${start === null ? '' : ` (start with "${start}")`} ->`;
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
