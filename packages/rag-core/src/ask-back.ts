/**
 * #286: a question back in place of a dead-end decline. When the search finds
 * nothing close enough to answer, Fred asks "Did you mean one of these?" with
 * a few questions he can answer, one tap each, instead of only "That one
 * isn't in my guides".
 *
 * The model writes the choices from the hiker's words and the titles of the
 * nearest passages; it never sees the passages and writes no advice. Each
 * choice is kept only if fixed rules pass it (a short question, on the
 * hiker's subject, no numbers) and a search for it, on its own, would be
 * answered: a tap never leads to another dead end. A tapped choice is asked
 * like a typed message, through every check an answer passes. On any doubt
 * there is no question back and the decline stays as it was.
 */
import type { InferenceBackend } from './backends.ts';

export const ASK_BACK_SYSTEM = `You help Fred, an offline trail guide, when he has no answer to what a hiker said. Fred will ask "Did you mean one of these?" Write the choices: up to 3 short questions the hiker may have meant, that Fred's guides can answer.
Rules:
- Each choice is a whole question in the hiker's voice, 4 to 12 words, about the SAME subject the hiker named, using their words for it.
- Each choice must be about one of the GUIDE TOPICS listed. Skip a topic that has nothing to do with what the hiker said.
- Do not answer, give advice, facts or numbers. No brand names, prices, doses or weather forecasts.
- If no topic fits what the hiker said, write exactly: NONE
Write the choices on one line, separated by " | ".
Examples:
Hiker: "can i keep hiking if i have the runs" GUIDE TOPICS: Stay healthy on a hike; Treatment of diarrhea; Blisters -> How do I treat diarrhea on the trail? | How do I stay healthy on a long hike?
Hiker: "how do i tell a black bear from a brown bear" GUIDE TOPICS: Bear safety; Storing food from bears; A bear close by, charging or attacking -> What should I do if I see a bear? | How do I store food away from bears?
Hiker: "my knees kill me going downhill" GUIDE TOPICS: Sports injuries; Knee bandage; Sprained ankle or wrist -> How do I treat a sore knee on the trail? | How do I wrap a knee?
Hiker: "what's the best stock to buy" GUIDE TOPICS: Lost: should I stay or keep moving?; Bandaging -> NONE`;

/**
 * A choice must be at least this close in meaning (search vectors, cosine) to
 * the hiker's message, or to their message before it, to stay on their
 * subject. Set from the first trials: under 0.55 came "how do I treat
 * blisters" for the runs, a loop knot for belaying a lead climber, natural
 * cord for stitching a cut; from 0.55 to 0.6, removing a tick for cactus
 * spines in a forearm and "what should I do if I see a bear?" for leaving a
 * cooler in the car. From 0.6 up: staying healthy on a hike with the runs,
 * relieving chafing, stiff neck and shoulders from a pack.
 */
export const ASK_BACK_SUBJECT_FLOOR = 0.6;

/**
 * A choice this close to the message only says it again: "how do I know if
 * there will be thunderstorms in Yosemite this weekend" (0.92) was a
 * forecast the decline was right to refuse, asked in other words.
 */
export const ASK_BACK_SAME_CEILING = 0.92;

/** What Fred asks above the choices, in place of the decline's hint. */
export const ASK_BACK_QUESTION = 'Did you mean one of these?';

/** The most choices shown, and the most guide topics the model is shown. */
export const ASK_BACK_CHOICES = 3;
const TOPICS = 6;

/**
 * A choice that asks whether something is safe, edible or all right. The
 * model picks its subject, and in other words it slips past the checks the
 * hiker's own question met: "birds eat salmonberries, are they OK for
 * people too?" was drafted as "how do I know if salmonberries are safe to
 * feed?", which was answered "generally considered safe" (first trial).
 * "How do I identify edible wild plants?" asks how, and opens the card.
 */
const ASKS_IF_SAFE = /\bsafe to\b|\b(?:is|are|know if|tell if)\b[^?]*\b(?:safe|edible|ok(?:ay)?|all right|poisonous|toxic|harmful)\b/i;

/** A choice that gives a fact or an instruction instead of asking. */
const NOT_A_QUESTION_WORDS = /\b(?:\d+|you should|make sure|always|never|brand|price|cost|dose|dosage|mg|forecast)\b/i;

/** Readable topic names from passage sections: "Hiking > Stay healthy" -> "Stay healthy (Hiking)". */
export function topicName(section: string): string | undefined {
  const parts = section.split('>').map((p) => p.replace(/[[\]()]/g, '').replace(/\s+/g, ' ').trim()).filter((p) => p !== '');
  const last = parts.at(-1);
  if (last === undefined || !/[a-z]/i.test(last) || last.length < 4) return undefined;
  // ALL-CAPS manual headings read as shouting to a small model; lower them.
  const tidy = (s: string): string => (s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s);
  return parts.length > 1 ? `${tidy(last)} (${tidy(parts[0]!)})` : tidy(last);
}

/** The distinct topic names of the nearest passages, best first. */
export function topicsOf(sections: readonly string[]): string[] {
  const out: string[] = [];
  for (const s of sections) {
    const t = topicName(s);
    if (t !== undefined && !out.includes(t)) out.push(t);
    if (out.length >= TOPICS) break;
  }
  return out;
}

/**
 * The model's choices that pass the fixed rules, in its order. Whether each
 * stays on the hiker's subject is checked after, by meaning (pipeline.ts):
 * "the runs" shares no word with "diarrhea".
 */
export function readChoices(raw: string, message: string, history: readonly string[]): string[] {
  // The small model often repeats the prompt line first ("Hiker: ... ->"):
  // only what follows its last arrow is the reply.
  const arrow = raw.lastIndexOf('->');
  const line = (arrow < 0 ? raw : raw.slice(arrow + 2)).replace(/\s*\n\s*/g, ' ').trim();
  if (line === '' || /^none\b/i.test(line)) return [];
  const asked = message.trim().toLowerCase().replace(/[?.!]+$/, '');
  const out: string[] = [];
  for (const part of line.split('|')) {
    const c0 = part.trim().replace(/^["'\-\d.)\s]+|["']+$/g, '').trim();
    // Only a question the model finished: one cut off at the token limit
    // ("What can I use to soothe a sun") has no question mark.
    if (!c0.endsWith('?') || /\b(?:guide topics|hiker)\b|->|NONE/i.test(c0)) continue;
    let c = c0;
    c = c.charAt(0).toUpperCase() + c.slice(1);
    const words = c.split(/\s+/).length;
    if (words < 3 || words > 14) continue;
    if (NOT_A_QUESTION_WORDS.test(c) || ASKS_IF_SAFE.test(c)) continue;
    if (c.toLowerCase().replace(/[?.!]+$/, '') === asked) continue;
    if (out.some((o) => o.toLowerCase() === c.toLowerCase())) continue;
    out.push(c);
  }
  return out;
}

/** The model's choices for a declined message, before each is checked by a search. */
export async function draftChoices(
  message: string,
  history: readonly string[],
  sections: readonly string[],
  backend: InferenceBackend,
  signal?: AbortSignal,
): Promise<string[]> {
  const topics = topicsOf(sections);
  if (topics.length === 0) return [];
  const earlier = history.slice(-2).map((m) => `"${m.replace(/"/g, "'")}"`);
  const user = `${earlier.length === 0 ? '' : `Earlier: ${earlier.join(' / ')}\n`}Hiker: "${message.replace(/"/g, "'")}" GUIDE TOPICS: ${topics.join('; ')} ->`;
  let out = '';
  for await (const tok of backend.generate(
    { system: ASK_BACK_SYSTEM, user },
    { maxTokens: 110, temperature: 0, stop: ['\n'], ...(signal === undefined ? {} : { signal }) },
  )) out += tok;
  return readChoices(out, message, history);
}
