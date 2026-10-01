/**
 * The conversation record (#101, docs/plan-conversation-memory.md step 1).
 *
 * Round 2 kept a list of conditions said in the last ten messages and never let
 * one go: "a snake struck my buddy" / "ok the rangers carried him out" / "now i
 * twisted my own ankle" still read as a snakebite, and the sprain card was
 * held back for the hiker's own ankle. The record keeps, by fixed rules and no
 * model call, who each condition belongs to and whether it is over, and the
 * card Fred last showed, so that a follow-up with nothing of its own stays on
 * it ("what do i do" after the anaphylaxis card fell back to the stings card,
 * phone, 2026-09-30).
 */
import { CONDITIONS, type Condition } from './conditions.ts';

/** Who a message is about: the hiker, someone named, someone by pronoun, or not said. */
export type Who = { readonly kind: 'self' } | { readonly kind: 'named'; readonly name: string } | { readonly kind: 'pronoun' } | { readonly kind: 'unknown' };

export interface RecordedCondition {
  readonly condition: Condition;
  readonly who: Who;
  /** Index of the message that set it. */
  readonly at: number;
  readonly resolved: boolean;
}

export interface ConversationRecord {
  readonly conditions: readonly RecordedCondition[];
}

const PEOPLE = '(?:dad|father|mom|mother|wife|husband|partner|son|daughter|kid|kids|child|boy|girl|baby|brother|sister|friend|buddy|uncle|aunt|grandma|grandpa|roommate|cousin|girlfriend|boyfriend|fiance|fiancee|niece|nephew|youngest|oldest)';
const NAMED = new RegExp(`\\bmy ${PEOPLE}\\b|\\bour ${PEOPLE}\\b`, 'i');
const SELF = /\bmy own\b|\b(?:i|i've|i'm)\s+(?:just\s+)?(?:twisted|rolled|sprained|cut|sliced|burned|burnt|scalded|got|hurt|slipped|fell|broke|banged|hit|stepped|have|feel|am)\b|\bmy (?:leg|legs|arm|arms|hand|hands|finger|fingers|fingertips|thumb|wrist|ankle|ankles|knee|knees|foot|feet|toe|toes|calf|thigh|back|neck|head|face|eye|eyes|chest|stomach|belly|hip|shoulder|lips|skin)\b|\bme\b/i;
const PRONOUN = /\b(?:he|she|him|her|his|hers|he's|she's|they|them|their)\b/i;

/** Who a message is about, from its own words. */
export function whoIn(message: string): Who {
  const named = NAMED.exec(message);
  if (named !== null) return { kind: 'named', name: named[0].toLowerCase().replace(/^our /, 'my ') };
  if (SELF.test(message)) return { kind: 'self' };
  if (PRONOUN.test(message)) return { kind: 'pronoun' };
  return { kind: 'unknown' };
}

/**
 * The hiker saying a condition is over. Only their own words, and only these:
 * a resolution is never inferred. "he seems better now" after low blood sugar
 * is over; "it left" after a bear. A body part that is fine is not: "he says
 * his neck is fine" after a fall is exactly what the spine card says not to
 * trust.
 */
const RESOLVED = /\b(?:he|she|they|i|we|everyone|everybody)(?:'s|’s|'m|'re| is| are| was| seems| looks| feels| am)?\s+(?:now\s+|much\s+|a lot\s+)?(?:feeling\s+|doing\s+)?(?:fine|ok|okay|better|good|alright|all right)\b|\bfine now\b|\b(?:rangers?|paramedics|ems|medics|rescuers?|search and rescue|sar|the helicopter|an ambulance)\s+(?:have|has|took|carried|got|flew|picked up|took over)\b|\b(?:carried|flew|took)\s+(?:him|her|them)\s+(?:out|away|to)\b|\bit (?:left|went away|ran off|wandered off)\b|\bit'?s gone\b|\bbleeding (?:has )?stopped\b|\ball patched up\b|\bfound (?:the|our|my) (?:trail|way|path|car)\b|\bback (?:on the trail|at the car|at camp)\b/i;

/** The hiker says something is over ("he is fine now", "found the trail"). */
export function saysResolved(message: string): boolean {
  return RESOLVED.test(message);
}

/**
 * Build the record from the hiker's messages, oldest first (the current one
 * last). A condition belongs to whoever the message that set it is about; a
 * pronoun or nothing means the last person named. A resolution closes the
 * latest open condition of whoever it is about.
 */
export function buildRecord(messages: readonly string[]): ConversationRecord {
  const out: RecordedCondition[] = [];
  let lastNamed: Who = { kind: 'unknown' };
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    let who = whoIn(m);
    if (who.kind === 'named' || who.kind === 'self') lastNamed = who;
    else if (who.kind === 'pronoun' && lastNamed.kind === 'named') who = lastNamed;
    const before = new Set(CONDITIONS.filter((c) => c.said(messages.slice(0, i))).map((c) => c.id));
    for (const c of CONDITIONS.filter((x) => x.said(messages.slice(0, i + 1)) && !before.has(x.id))) {
      out.push({ condition: c, who: who.kind === 'unknown' ? lastNamed : who, at: i, resolved: false });
    }
    if (RESOLVED.test(m) && i > 0) {
      // The latest open condition of whoever this is about; or the latest one.
      for (let j = out.length - 1; j >= 0; j--) {
        const r = out[j]!;
        if (r.resolved || r.at === i) continue;
        if (who.kind === 'unknown' || who.kind === 'pronoun' || samePerson(r.who, who)) {
          out[j] = { ...r, resolved: true };
          break;
        }
      }
    }
  }
  return { conditions: out };
}

function samePerson(a: Who, b: Who): boolean {
  if (a.kind === 'named' && b.kind === 'named') return a.name === b.name;
  return a.kind === b.kind;
}

/**
 * The conditions that bear on this message: open, and about the same person.
 * A message about the hiker themself ("now i twisted my own ankle") is not
 * about a friend's snakebite; a pronoun or nothing could be anyone, so every
 * open condition counts, as before.
 */
export function conditionsFor(record: ConversationRecord, message: string): Condition[] {
  const who = whoIn(message);
  return record.conditions
    .filter((r) => !r.resolved)
    .filter((r) => {
      if (who.kind === 'unknown' || who.kind === 'pronoun') return true;
      if (r.who.kind === 'unknown') return true;
      return samePerson(r.who, who);
    })
    .map((r) => r.condition)
    .filter((c, i, all) => all.findIndex((x) => x.id === c.id) === i);
}

/** The latest open condition that bears on this message, and whether this message set it. */
export function latestFor(record: ConversationRecord, message: string, index: number): { condition: Condition; inLast: boolean } | undefined {
  const ids = new Set(conditionsFor(record, message).map((c) => c.id));
  const open = record.conditions.filter((r) => !r.resolved && ids.has(r.condition.id));
  const last = open.at(-1);
  return last === undefined ? undefined : { condition: last.condition, inLast: last.at === index };
}
