/**
 * Understand a message in its conversation (#98, docs/plan-understand.md).
 *
 * Search reads one message. "help" after "i'm lost and scared" is searched as
 * "help" and declined, and "uhh dude there's a bear in front of me" shares no
 * words with a manual. This asks the model once, with the last few messages,
 * for the intent and a plain search request that fills in what the last
 * message leaves out.
 *
 * The request is searched with and never answered from, and what it finds is
 * kept only if it also matches the hiker's own words (pipeline.ts). Phase 3's
 * rewrite, which lacked both limits and ran on every weak question, let 14
 * out-of-scope questions through (docs/results-phase3.md step 4).
 *
 * The examples are written for this prompt and share no wording with the
 * sealed set (tools/eval/data/holdout-understand.json).
 */
import type { InferenceBackend } from './backends.ts';
import type { Intent } from './intent.ts';

export interface Understood {
  /**
   * 'out': not about the hiker's own safety, first aid or survival outdoors.
   * Undefined when the model wrote a word of its own: Qwen3-1.7B answered
   * "DIPPING | thumb sliced open while whittling, dripping everywhere" and
   * "THROAT | closing up after eating a trail snack" with good requests and
   * made-up words. The caller then asks the intent check about the request.
   */
  readonly intent: Intent | 'out' | undefined;
  /** What to search for, in plain words. Empty for OUT. */
  readonly request: string;
}

/** At most this many earlier messages are shown, oldest first. */
export const UNDERSTAND_HISTORY = 3;

/**
 * Words that point back at something said before: "it keeps pouring out",
 * "he's acting confused", "what about for a kid?", "what now".
 */
const POINTS_BACK = /\b(?:it|its|it's|that|this|those|these|he|he's|she|she's|him|her|his|they|they're|them|their|there|same)\b|^\s*(?:and|also|but|so|then|now|ok|okay|what about|what if)\b|\bwhat (?:now|next)\b|\bhelp\b|\bwhat (?:do|should|can) (?:i|we) do\b/i;

/**
 * A message leans on the ones before it when it is very short or points back.
 * Five words was too many: "sliced my thumb open whittling" is five.
 */
export function leansBack(message: string): boolean {
  return message.trim().split(/\s+/).length <= 3 || POINTS_BACK.test(message);
}

/**
 * The earlier messages that belong to this one's topic, oldest first.
 *
 * On the phone every message of the last half hour came along, and the model
 * held on to the first topic: after "someone isn't breathing", both "no idea
 * where we are anymore and i'm freaking out" and "sliced my thumb open
 * whittling" were restated as "person not breathing" and answered with the CPR
 * card, and the old question, being among the hiker's own words, passed the
 * check meant to stop that (2026-09-30 phone check, #98). A full statement
 * starts its own topic, so the thread runs back only while each message leans
 * on the one before, and stops at the message that started it.
 */
export function currentThread(message: string, history: readonly string[]): string[] {
  const earlier = history.filter((h) => h.trim() !== '');
  if (!leansBack(message)) return [];
  const thread: string[] = [];
  for (let i = earlier.length - 1; i >= 0 && thread.length < UNDERSTAND_HISTORY; i--) {
    thread.unshift(earlier[i]!);
    if (!leansBack(earlier[i]!)) break;
  }
  return thread;
}

const SYSTEM = `You help a first-aid and survival helper for hikers understand what a hiker needs. You get the hiker's recent messages, oldest first. Understand the LAST message; the earlier ones fill in what it leaves out.

Reply with one line: a WORD, then " | ", then a short plain search request saying what the hiker needs. The request keeps the hiker's key words (body parts, symptoms, animals, places) and uses the earlier messages to fill in what the last one leaves out. Do not add advice. Do not invent details that were not said.

WORD is one of:
NOW - something bad is happening to someone right now.
QUESTION - they ask how to do something, or what to do about a problem.
PREVENT - they ask how to avoid or prepare for something.
CHAT - they only tell you something and need nothing.
OUT - not about a person's safety, first aid or survival outdoors: care of pets or other animals, cars, money, school, laws or permits, climbing technique, medicine doses, or anything else.

Examples:
Messages: "we got separated from the group" / "no bars on my phone, what should i do"
QUESTION | separated from the group with no phone signal, how to get found
Messages: "my wife slipped on the scree" / "her wrist is bent the wrong way"
NOW | wrist bent out of shape after a fall, possible broken bone, what to do
Messages: "whoa a moose is walking straight at us"
NOW | moose coming close, what to do right now
Messages: "the kids are shivering in the tent" / "one of them is really sleepy now"
NOW | child very cold and drowsy, hypothermia, what to do
Messages: "how do i cook rice on a camp stove" / "and way up high?"
QUESTION | cooking rice on a camp stove at high altitude
Messages: "our horse threw a shoe" / "how do we fix it"
OUT | horse lost a shoe
Messages: "what's the most aspirin i can take"
OUT | medicine dose
Messages: "hiked 12 miles today" / "legs are toast but worth it"
CHAT | tired after a long hike`;

const WORDS: Record<string, Understood['intent']> = { NOW: 'now', QUESTION: 'question', PREVENT: 'prevent', CHAT: 'chat', OUT: 'out' };

/**
 * Read "WORD | request". Asked for the request first, the model copied the
 * hiker's words rather than saying what they need ("no idea where we are
 * anymore and i'm freaking out" instead of "lost direction and panicked"), and
 * the search got no better. Word first, it sometimes puts a key word in the
 * word slot ("THROAT | closing up after eating a trail snack"), which the
 * prompt's "keep the key words" is there for. Undefined when there is no
 * request to search: the caller keeps today's path.
 */
export function readUnderstood(text: string): Understood | undefined {
  const line = text.trim().split('\n')[0]!.trim();
  const bar = line.indexOf('|');
  const word = bar < 0 ? (/^\W*(NOW|QUESTION|PREVENT|CHAT|OUT)\b/i.exec(line)?.[1] ?? '').toUpperCase() : line.slice(0, bar).replace(/\W/g, '').toUpperCase();
  const rest = bar < 0 ? line.replace(/^\W*(NOW|QUESTION|PREVENT|CHAT|OUT)\b/i, '') : line.slice(bar + 1);
  const request = rest.replace(/^[\W]+|["'\s]+$/g, '').trim();
  const intent = WORDS[word];
  if (intent === 'out') return { intent, request: '' };
  // A word of its own is usually the key word ("THROAT"): keep it in the search.
  const full = intent === undefined && word !== '' ? `${word.toLowerCase()} ${request}`.trim() : request;
  return full === '' ? undefined : { intent, request: full };
}

export async function understandMessage(
  message: string,
  history: readonly string[],
  backend: InferenceBackend,
  signal?: AbortSignal,
): Promise<Understood | undefined> {
  const shown = [...history.slice(-UNDERSTAND_HISTORY), message].map((m) => `"${m.replace(/"/g, "'")}"`).join(' / ');
  let out = '';
  for await (const tok of backend.generate(
    { system: SYSTEM, user: `Messages: ${shown}` },
    signal ? { maxTokens: 40, temperature: 0, signal, stop: ['\n'] } : { maxTokens: 40, temperature: 0, stop: ['\n'] },
  )) out += tok;
  return readUnderstood(out);
}
