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

export const OPENER_SYSTEM = `You are Fred, a warm, calm hiking companion. Write ONE short sentence (under 15 words) that shows you heard the hiker: respond to how they are doing, or show interest in what they asked. Another part of Fred gives the actual answer right after your sentence.
Rules: do not answer the question. Give no advice, steps, facts, numbers, warnings or predictions. Never say whether something is safe, serious, fine or normal. Do not ask a question.
Use the hiker's own words for what is going on, and say how it feels: tough, no fun, uncomfortable, frustrating, exciting, great.
Examples:
"how do i keep bugs out of my tent" -> Bugs in the tent can make for a long night.
"my toes are numb and it's freezing out" -> Numb toes in the cold are no fun at all.
"what's the difference between a hawk and a falcon" -> Birds of prey are great to watch on a hike.
"we're running late and my partner is exhausted" -> That sounds like a long, tiring day.
"just finished my first twenty mile day" -> That's a big day, well done!`;

/** How much of the conversation the opener sees: the hiker's last messages. */
const EARLIER = 2;

/** Words that tell the hiker to do something, or point them somewhere. */
const ADVICE = /\b(?:you should|you'?ll want|you need|you must|you can|you could|you might|try|make sure|be sure|remember|don'?t|do not|never|always|avoid|keep|stay|apply|call|seek|drink|eat|use|check|head (?:back|out|down)|turn back|let'?s|best|important|recommend|get help|wash|rest|cover|remove|pull|treat|carry|bring|wait|go (?:back|see|to))\b/i;

/** Reassurance, judgment of risk, and guesses about what it is. */
const JUDGES = /\b(?:worr(?:y|ies)|it'?s ok(?:ay)?|it'?ll be|you'?ll be|you'?re (?:going to|gonna) be|fine|safe(?:ly|r)?|unsafe|danger(?:ous)?|deadly|risk(?:y|s)?|serious(?:ly)?|harmless|normal|common|rare|probably|likely|maybe|might|may|could be|nothing to|no big deal|minor|severe|mild|poison(?:ous)?|venom(?:ous)?|toxic|infect\w*|allerg\w*|emergency|urgent|heal\w*|recover\w*|go away|pass soon|trouble|could mean|means|sign(?:s)? of|tasty|delicious|yum\w*|refreshing|clean|pure)\b/i;

/** A count or amount is a claim, spelled out or not. */
const NUMBER_WORDS = /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand|dozen|half)\b/i;

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
make makes making for get gets getting have has had just still both one's way handle deal through around off over`.split(/\s+/));
const FEELING = new Set(`fun tough rough hard uncomfortable annoying painful miserable frustrating stressful scary frightening
unsettling nerve-wracking tiring exhausting draining long tricky exciting amazing wonderful great awesome beautiful lovely
fascinating interesting rewarding nice ouch oh ugh yikes wow nasty unpleasant bother bummer sorry glad love enjoy
congratulations congrats well done no`.split(/\s+/));
const SETTING = new Set(`day days hike hikes hiking trail trails trip night nights morning afternoon evening time spot moment
walk climb outdoors camp camping weather part start adventure out watch week hours miles summit top mountain woods
heat hot cold chill rain wet wind snow sun dark storm gear pack boots shoes tent
legs feet body hands arms knees back nose throat skin head`.split(/\s+/));

function known(word: string, said: readonly string[]): boolean {
  const w = word.replace(/^'+|'+$/g, '');
  if (w === '' || GLUE.has(w) || FEELING.has(w) || SETTING.has(w)) return true;
  // Forms of an allowed word: "hikes", "watching", "tired".
  const base = w.replace(/(?:ing|ed|es|s)$/, '');
  if (base.length >= 3 && [...GLUE, ...FEELING, ...SETTING].some((k) => k.startsWith(base))) return true;
  // The hiker's own words, in any form: "cramping" for "cramps", "soaked".
  const stem = w.slice(0, Math.min(5, w.length));
  return said.some((h) => h === w || (stem.length >= 4 && h.startsWith(stem)));
}

/**
 * The line if it passes, or null. One sentence of 3-18 words; no digits, no
 * question, no advice, no judgment of risk, no talk about Fred, and no
 * condition the hiker hasn't named.
 */
export function checkOpener(raw: string, messages: readonly string[]): string | null {
  const line = raw.trim().replace(/^(?:->|Fred:)\s*/i, '').replace(/^["“']|["”']$/g, '').trim();
  if (line === '' || /[\n?\d]/.test(line) || NUMBER_WORDS.test(line)) return null;
  // One sentence: no sentence end before the last character.
  if (/[.!](?=\s+\S)/.test(line)) return null;
  const words = line.split(/\s+/).length;
  if (words < 3 || words > 18) return null;
  if (ADVICE.test(line) || JUDGES.test(line) || SELF.test(line)) return null;
  // Every word is the hiker's or from the fixed vocabulary, and at least one
  // says how it feels: a bare echo ("your knee hurts on the way down") is dropped.
  const said = messages.join(' ').toLowerCase();
  const saidWords = said.split(/[^a-z']+/).filter((w) => w !== '');
  const words2 = line.toLowerCase().split(/[^a-z'-]+/).filter((w) => w !== '');
  if (!words2.every((w) => known(w, saidWords))) return null;
  if (!words2.some((w) => FEELING.has(w) && w !== 'no')) return null;
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
