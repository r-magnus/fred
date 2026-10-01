/**
 * What does the hiker want? (docs/results-intent-probe.md)
 *
 * Search finds the topic well: for casual messages the right field card is
 * usually ranked first. What it cannot tell is intent. "He's choking and
 * can't make a sound" and "I thought I burned myself but it's okay" score the
 * same (about 0.19), so a score bar either refuses the emergency or answers
 * the small talk. This asks the model one short question instead.
 *
 * The four kinds:
 *   now       something is happening to someone right now
 *   question  asking what to do about a small, current problem
 *   prevent   asking how to avoid something
 *   chat      telling, not asking; or something past or already resolved
 *
 * The examples below are written for this prompt and share no wording with
 * the probe or held-out sets.
 */
import type { InferenceBackend } from './backends.ts';

export type Intent = 'now' | 'question' | 'prevent' | 'chat';

const SYSTEM = `You sort messages a hiker sends to a first-aid and survival helper. Reply with exactly one word:
NOW - something bad is happening to someone right now and they need help.
QUESTION - they ask for anything: how to do something, what something is, what to do about a problem, or they say they don't know how to do something.
PREVENT - they ask how to avoid or prepare for something.
CHAT - they are only telling you something and need nothing, or it already happened and is fine.

Examples:
"my sister cut her wrist on glass and there's blood everywhere" -> NOW
"dad just keeled over and isn't breathing" -> NOW
"a jellyfish got me, my leg is on fire and I feel sick" -> NOW
"my lips are cracked from the wind, anything I can put on them?" -> QUESTION
"got a splinter in my palm, how do I get it out?" -> QUESTION
"what do wild onions look like?" -> QUESTION
"I don't know how to set up this tarp, I have rope and two trees" -> QUESTION
"how do I keep mosquitoes away at camp?" -> PREVENT
"what should I bring for a hike above the tree line?" -> PREVENT
"we saw a moose this morning, amazing" -> CHAT
"I scraped my elbow on Monday but it's healed" -> CHAT
"the sunset from the ridge was incredible" -> CHAT`;

const WORDS: Record<string, Intent> = { NOW: 'now', QUESTION: 'question', PREVENT: 'prevent', CHAT: 'chat' };

/** Read the model's one word. Anything unreadable counts as a question: open the card. */
export function readIntent(text: string): Intent {
  const w = text.trim().toUpperCase().match(/NOW|QUESTION|PREVENT|CHAT/)?.[0];
  return w === undefined ? 'question' : WORDS[w]!;
}

/**
 * Prevention is asked in a few set ways, and the model would not say PREVENT
 * for any of them: all six practice prevention questions came back QUESTION,
 * and a stronger instruction did not help (it made chat worse instead). A word
 * rule catches them and skips the model call.
 */
const PREVENTION = /\b(?:avoid|prevent(?:ion|ing)?|stay safe|keep (?:\w+ ){0,3}(?:off|away|from)|tips? (?:to|for|on)|(?:should|do) I (?:bring|pack|carry)|what to (?:bring|pack|carry))\b/i;

/**
 * A message that asks something is never small talk, whatever the model says:
 * on the tuning set it called "how can I find north without a compass?" and
 * "what does poison oak look like?" CHAT.
 */
const ASKS = /\?|^\s*(?:how|what|where|when|why|which|who|can|could|is|are|do|does|should|will|would|any)\b/i;

export async function classifyIntent(message: string, backend: InferenceBackend, signal?: AbortSignal): Promise<Intent> {
  if (PREVENTION.test(message)) return 'prevent';
  const intent = await askModel(message, backend, signal);
  return intent === 'chat' && ASKS.test(message) ? 'question' : intent;
}

async function askModel(message: string, backend: InferenceBackend, signal?: AbortSignal): Promise<Intent> {
  let out = '';
  for await (const tok of backend.generate(
    { system: SYSTEM, user: `"${message}" ->` },
    signal ? { maxTokens: 4, temperature: 0, signal, lane: 'intent' } : { maxTokens: 4, temperature: 0, lane: 'intent' },
  )) {
    out += tok;
    if (/NOW|QUESTION|PREVENT|CHAT/i.test(out)) break;
  }
  return readIntent(out);
}
