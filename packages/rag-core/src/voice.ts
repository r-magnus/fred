/**
 * Fred's side of the conversation around his fixed replies (#172,
 * reports/Fred conversation quality.md).
 *
 * About nine replies in ten are fixed text: a field card, the small-talk
 * reply, a safety reply or a decline. The model-written opener (opener.ts)
 * only reaches the rest, so a chat read as a string of lookups, and Fred
 * repeated a reply word for word in 38% of chats. Everything here is fixed
 * wording picked by rules from the hiker's own messages, with no model call:
 * it costs no time and cannot bring in a fact.
 *
 * The rules the opener learned the hard way hold here too: no advice, no
 * judgment of risk, no promise of how things turn out, no sympathy or
 * anything that reads as "yes" after a yes/no question, and a person or body
 * part is named only when the hiker's words say whose it is.
 */
import { kindOf, PROBLEM, WORRY } from './opener.ts';
import { CHAT_REPLY, CHAT_REPLY_WITH_OFFER } from './prompt.ts';
import { namedIn, saysResolved } from './record.ts';
import { dangerSign } from './triage.ts';

const BODY = 'legs?|arms?|hands?|fingers?|fingertips|thumbs?|wrists?|ankles?|knees?|foot|feet|toes?|heels?|shins?|calf|calves|thighs?|back|neck|head|face|eyes?|chest|stomach|belly|hips?|shoulders?|elbows?|palms?|ears?|nose|lips?|paws?';
/** "my wrist", "her left ankle", "my son's elbow", "the dog's paw": a body part and whose it is. */
const PART = new RegExp(String.raw`(?:\b(my|his|her|their|our)|(?:\b(my|our|the)\s+)?\b([a-z]+)'s)\s+(?:(?:left|right|other|lower|upper|big|little)\s+)?(${BODY})\b`, 'gi');
/** The part is said to be all right, or not the one. */
const PART_FINE = /\b(?:is|are|feels?|seems?|looks?)\s+(?:totally\s+|completely\s+)?(?:fine|ok|okay|good|better|alright|all right)\b|\bnot (?:my|his|her|their)\b/i;
/** An injury said without one of the opener's problem words: "took the skin off", "landed on". */
const HURT = /\b(?:fell|slipped|tripped|cut|sliced|gashed|bit|sprained|rolled|banged|smacked|bumped|skin off|crashed|landed on|tore|jammed|pinched|crushed|stabbed|scratched|swell\w*|wrecked)\b/i;
/** Words that by themselves say someone is unwell or in pain: enough for sympathy with nobody named. */
const AILING = /\b(?:hurt\w*|ach(?:e|es|ing)|sore|pain\w*|sick|diarrhea|threw up|throwing up|vomit\w*|nause\w*|bitten|stung|scraped|burn(?:ed|t)|blister\w*|splinter|itch\w*|swollen|swelling|bleeding|cramp\w*|headache|dizzy|throbbing|bruised|sunburn\w*|rash|killing me|miserable)\b/i;
/** "doesn't hurt", "no swelling": the word just before turns it around. */
const NEGATED_BEFORE = /\b(?:no|not|never|without|isn'?t|aren'?t|doesn'?t|don'?t|didn'?t|won'?t)\s+(?:\w+\s+)?$/i;

function says(re: RegExp, text: string): boolean {
  for (const m of text.matchAll(new RegExp(re.source, 'gi'))) {
    if (!NEGATED_BEFORE.test(text.slice(Math.max(0, m.index - 24), m.index))) return true;
  }
  return false;
}

const possessive = (name: string): string => (name.endsWith('s') ? `${name}'` : `${name}'s`);

/**
 * The hurt body part as Fred would say it back ("your mom's wrist", "your
 * ankle", "his elbow"), or null when the message names none, more than one,
 * or does not say whose. "put her hand out, now her wrist is swollen": the
 * part in the clause that says what is wrong.
 */
export function hurtPart(message: string, history: readonly string[] = []): string | null {
  const clauses = message.split(/[,.;!?]|\b(?:but|now|then)\b/i);
  const found: { part: string; owner: string; hurt: boolean; state: boolean }[] = [];
  for (const clause of clauses) {
    // "my shoulders and neck are so stiff i can barely turn my head" got
    // "Sorry about your head.": with several parts in one clause, none is named.
    const mentioned = new Set((clause.toLowerCase().match(new RegExp(String.raw`\b(?:${BODY})\b`, 'g')) ?? []));
    for (const m of clause.matchAll(PART)) {
      if (PART_FINE.test(clause) || mentioned.size > 1) continue;
      const [, det, ownerDet, ownerWord, part] = m;
      let owner: string | null = null;
      if (det !== undefined) {
        const d = det.toLowerCase();
        if (d === 'my' || d === 'our') owner = 'your';
        else {
          // "her wrist": the one person this message names, or the last one named.
          const here = namedIn(message);
          const named = here.length > 0 ? here : namedIn([...history].reverse().find((h) => namedIn(h).length > 0) ?? '');
          owner = named.length === 1 ? possessive(named[0]!.replace(/^my /, 'your ')) : d;
        }
      } else if (ownerDet !== undefined && ownerWord !== undefined) {
        owner = possessive(`${ownerDet.toLowerCase() === 'the' ? 'the' : 'your'} ${ownerWord.toLowerCase()}`);
      }
      if (owner === null) continue;
      found.push({ part: part!.toLowerCase(), owner, hurt: says(PROBLEM, clause) || says(HURT, clause), state: says(PROBLEM, clause) });
    }
  }
  const distinct = (xs: typeof found): typeof found => xs.filter((x, i) => xs.findIndex((y) => y.part === x.part && y.owner === x.owner) === i);
  // "slipped and put her hand out, now her wrist is swollen": what is wrong
  // now (swollen) counts over what happened (slipped).
  const now = distinct(found.filter((f) => f.state));
  const hurt = now.length === 1 ? now : distinct(found.filter((f) => f.hurt));
  const pick = hurt.length === 1 ? hurt[0]! : hurt.length === 0 && distinct(found).length === 1 ? found[0]! : null;
  return pick === null ? null : `${pick.owner} ${pick.part}`;
}

/** A message opening with "can't", "don't", "won't" and no question mark. */
const STATES_CANNOT = /^\s*(?:can'?t|cannot|don'?t|won'?t|isn'?t|aren'?t|didn'?t|doesn'?t|couldn'?t|wouldn'?t)\b[^?]*$/i;

const LONG_PAST = /\b(?:healed|(?:years?|months?|weeks?) ago|last (?:year|summer|winter|spring|fall|month)|back in|used to|once had|when i was)\b/i;

type LeadKind = 'urgent' | 'problem' | 'worry' | 'question';
interface Lead { readonly kind: LeadKind; readonly key: string; readonly text: string }

const pick = <T>(xs: readonly T[], n: number): T => xs[n % xs.length]!;

/** Presence, not a promise: an emergency's first words are still what to do. */
const URGENT = ["I'm here with you.", "Okay. I'm with you.", "I'm right here."] as const;
const WORRIED = ["Okay. Let's take this one step at a time.", "I hear you. I'm right here."] as const;
const QUESTION = ['Happy to help.', "Sure, let's take a look.", 'Good question.'] as const;
/** Never an offer or praise after "can i..." or "is it ok...": it reads as yes. */
const YES_NO = ['Glad you asked.', 'Thanks for asking.'] as const;

/**
 * How serious the moment is. 'danger': a danger sign in the thread. 'now': the
 * message was read as needing help now, with no danger sign ("got a blister
 * now" is read that way, and "I'm here with you." before a blister card was
 * off-key on the first run of the chat sets).
 */
export type Moment = 'danger' | 'now' | 'calm';

/** An animal or a hazard bearing down: "black bear running straight at us" has no problem word in it. */
const THREAT = /\b(?:bears?|cougars?|mountain lions?|moose|wolf|wolves|coyotes?|snakes?|rattlers?|rattlesnakes?|charging|attack\w*|growl\w*|lightning|wildfire|avalanche|flash flood)\b/i;

/** Something has gone wrong somewhere in these messages. */
const troubled = (messages: readonly string[]): boolean => messages.some((m) => says(PROBLEM, m) || says(HURT, m) || WORRY.test(m) || THREAT.test(m));

/** What one message would be met with, before the rules about repeating. */
function candidate(message: string, history: readonly string[], moment: Moment): Lead | null {
  const n = history.length;
  if (moment === 'danger') return { kind: 'urgent', key: 'urgent', text: pick(URGENT, n) };
  // "can't feel my fingertips" opens like a yes/no question and is a statement.
  const kind = STATES_CANNOT.test(message) ? null : kindOf(message);
  // A friendly start belongs to a plain question, not to one asked in the
  // middle of trouble ("do we play dead" met with "Thanks for asking.").
  if ((kind === 'yesNo' || kind === 'question') && (moment === 'now' || troubled([...history, message]))) return null;
  if (kind === 'yesNo') return { kind: 'question', key: `q${n}`, text: pick(YES_NO, n) };
  if (kind === 'question') return { kind: 'question', key: `q${n}`, text: pick(QUESTION, n) };
  if (kind === 'worry') return { kind: 'worry', key: 'worry', text: pick(WORRIED, n) };
  // A problem, or an injury said in other words; never once it is said to be
  // over, or long past ("sprained my wrist skiing back in march but it healed fine").
  if (saysResolved(message) || LONG_PAST.test(message) || !(says(PROBLEM, message) || says(HURT, message))) return null;
  const part = hurtPart(message, history);
  if (part !== null) {
    return { kind: 'problem', key: `p:${part}`, text: `Sorry about ${part}.` };
  }
  const named = namedIn(message);
  if (named.length === 1) {
    const name = named[0]!.replace(/^my /, 'your ');
    return { kind: 'problem', key: `p:${name}`, text: pick([`Sorry to hear about ${name}.`, `That's rough for ${name}.`], n) };
  }
  if (!says(AILING, message)) return null;
  return { kind: 'problem', key: 'p:', text: pick(["Sorry you're dealing with that.", 'Ugh, sorry about that.', 'That sounds rough.'], n) };
}

/**
 * The line each message of the conversation is met with, the current one
 * last. A situation is named once ("Sorry about your mom's wrist." is not
 * said again on the follow-up), the steadying line of an emergency comes
 * once, and a question's friendly start is skipped straight after another
 * line, so Fred does not open every reply the same way.
 */
function leads(messages: readonly string[], momentNow: Moment): (Lead | null)[] {
  const out: (Lead | null)[] = [];
  const said = new Set<string>();
  for (let i = 0; i < messages.length; i++) {
    const earlier = messages.slice(0, i);
    const moment = i === messages.length - 1 ? momentNow : dangerSign(messages.slice(0, i + 1)) ? 'danger' : 'calm';
    let lead = candidate(messages[i]!, earlier, moment);
    // Straight after a line, only a newly named person or body part gets another.
    const named = lead !== null && lead.kind === 'problem' && lead.key !== 'p:';
    if (lead !== null && (said.has(lead.key) || (!named && lead.kind !== 'urgent' && out[i - 1] != null))) lead = null;
    if (lead !== null) said.add(lead.key);
    out.push(lead);
  }
  return out;
}

/**
 * Fred's first line before a field card or a fixed reply, or null for none.
 * `only` limits the kinds (a decline is not met with "Happy to help.").
 */
export function leadLine(message: string, history: readonly string[], moment: Moment, only?: readonly LeadKind[]): string | null {
  const lead = leads([...history, message], moment).at(-1) ?? null;
  return lead === null || (only !== undefined && !only.includes(lead.kind)) ? null : lead.text;
}

const THANKS = /\b(?:thanks?|thank you|thx|ty|appreciate (?:it|that|you))\b/i;
const GREETING = /^\s*(?:hi|hello|hey|howdy|yo|good (?:morning|afternoon|evening))(?:\s+(?:fred|there))?[\s,!.]*$/i;
const ACK = "(?:ok(?:ay)?|k|alright|all right|got it|will do|cool|great|nice|sounds good|perfect|awesome|done)";
const ONLY_ACK = new RegExp(`^\\s*${ACK}(?:[\\s,.!]+${ACK})*[\\s.!]*$`, 'i');

/**
 * The small-talk reply (#172 option 1), in place of the one "Got it. I'm
 * right here whenever you need me..." line, which was 23% of chat replies and
 * listed what Fred does every time. Neutral on purpose: a report of something
 * done ("ok i took it off") is acknowledged, never praised, because Fred has
 * not checked it. `offered`: a field card is shown folded under the reply.
 */
export function chatReply(message: string, history: readonly string[], offered: boolean): string {
  const n = history.length;
  const lead = leadLine(message, history, 'calm', ['problem', 'worry']);
  if (offered) {
    if (lead !== null) return `${lead} In case you need it, here's what to do:`;
    return pick([CHAT_REPLY_WITH_OFFER, 'Okay. This might be what you need:', "Understood. Here's what to do if you need it:"], n);
  }
  if (GREETING.test(message)) return "Hi, I'm Fred. Ask me about first aid, finding your way, or the plants and animals around you.";
  if (saysResolved(message)) return pick(["Glad to hear it. I'm here if anything changes.", 'Good to hear. Tell me if anything changes.'], n);
  if (THANKS.test(message)) return pick(['Anytime.', "You're welcome.", "Glad to help. I'm here if you need me."], n);
  if (ONLY_ACK.test(message)) return pick(["Okay. I'm here if you need me.", 'Got it.', 'Okay.'], n);
  if (lead !== null) return `${lead} Tell me more about what's going on and I'll look for what helps.`;
  if (WORRY.test(message)) return pick(["I hear you. Tell me what's worrying you most and I'll help where I can.", "Okay. I'm right here. Ask me anything about it."], n);
  // The first thing said to Fred: say what he is for, once.
  if (n === 0) return CHAT_REPLY;
  return pick(["Got it. I'm here when you need me.", 'Okay. Just say the word if something comes up.', "Understood. I'm right here."], n);
}

export interface DeclineReply {
  /** What Fred says in place of an answer. */
  readonly text: string;
  /** The detail that would help him look again. */
  readonly hint: string;
}

/**
 * What Fred says when he has no answer (#172 option 4): what kind of thing he
 * could not answer, and what to tell him so he can look again, in place of
 * one sentence for every dead end. Never a hint at the answer: after a yes/no
 * question he says he cannot say either way.
 */
export function declineReply(message: string, history: readonly string[], outOfScope = false): DeclineReply {
  const n = history.length;
  if (outOfScope) {
    const sorry = leadLine(message, history, 'calm', ['problem', 'worry']);
    return {
      text: `${sorry === null ? '' : `${sorry} `}${pick(["That's outside what my guides cover.", "My guides don't reach that far."], n)}`,
      hint: "I'm good for first aid, finding your way, and the plants and animals around you.",
    };
  }
  // "can you recommend a restaurant" asks for something; it is not a yes/no question.
  const kind = /^\s*(?:can|could|would|will) you\b/i.test(message) ? 'question' : kindOf(message);
  if (kind === 'yesNo') {
    return {
      text: pick(["I can't say either way from my guides, and I'd rather not guess.", "My guides don't settle that one, and I'd rather not guess."], n),
      hint: "Tell me more about what's going on and I'll look again.",
    };
  }
  if (kind === 'question') {
    return {
      text: pick(["That one isn't in my guides, and I'd rather not guess.", "I don't have that in my guides, and I'd rather not guess."], n),
      hint: "Ask it another way, or tell me what's going on around it, and I'll look again.",
    };
  }
  const lead = leadLine(message, history, 'calm', ['problem', 'worry']);
  if (lead !== null) {
    return {
      text: `${lead} I don't have steps for that in my guides, and I'd rather not guess.`,
      hint: "Tell me what happened and how it looks now, and I'll look again.",
    };
  }
  return {
    text: "I don't have that in my guides, and I'd rather not guess.",
    hint: "Try asking another way, or tell me a bit more about what's going on.",
  };
}
