/**
 * Whether a message asks where the hiker is, or where signal is: the messages
 * the app answers with a map as well as with words (US-05, US-06).
 *
 * A phrase rule rather than the intent model. The model read "I think I'm
 * lost. I don't know which way the trail is." as small talk on the breadth
 * set (docs/results-breadth.md), and a map that fails to appear for a lost
 * hiker is the one mistake this feature exists to prevent. The phrases are
 * few and fixed, so a rule catches them all, and it is tested against every
 * question in the eval sets so ordinary questions do not open a map.
 *
 * The map is added beside Fred's reply, never instead of it: "I'm lost" still
 * gets the lost card.
 */
const LOST: readonly RegExp[] = [
  // "I'm lost", "we're totally lost", "I think I got lost", "getting lost"
  /\b(?:i'?m|i am|we'?re|we are|been|got|get|getting|gotten)\s+(?:\w+\s+)?lost\b(?!\s+(?:my|our|his|her|their|the|a|an)\b)/i,
  /\blost\s+(?:the|my|our)\s+(?:trail|way|path|bearings|route)\b/i,
  // "where am I?", "where are we right now?" (not "where am I likely to find morels")
  /\bwhere\s+(?:am\s+i|are\s+we)(?:\s+(?:right\s+)?now|\s+exactly)?\s*[?.!]*\s*$/i,
  /\b(?:don'?t|do not|can'?t|cannot|no idea)\s+(?:\w+\s+)?(?:know|tell|figure out)?\s*where\s+(?:i\s+am|we\s+are|i'?m|we'?re)\b/i,
  /\b(?:can'?t|cannot|couldn'?t|can not)\s+find\s+(?:the|my|our)\s+(?:way|trail|path|car|camp|campsite|trailhead|road)\b/i,
  /\bwhich\s+way\s+(?:is|to)\s+(?:the\s+)?(?:trail|trailhead|road|car|camp|town|parking)\b/i,
];

/**
 * A message about phone signal: having none, where to find some, how far or
 * which way it is, where a call can be made from (#77). These get the
 * distance and direction to the nearest reported coverage in Fred's reply,
 * as well as the map.
 *
 * "Signal" alone also means a signal fire or mirror, so the bare word counts
 * only as a thing to have or find ("a signal", "nearest signal"), never as
 * something to do or build.
 */
const SIGNAL = String.raw`(?:(?:cell|phone|mobile)\s+)?(?:signal(?!\s+(?:fire|mirror|flare|whistle|panel|flag))|reception|coverage|bars)|(?:cell|phone|mobile)\s+service`;
const WANTS_SIGNAL: readonly RegExp[] = [
  /\blost\s+(?:the\s+|my\s+)?(?:signal|service|reception)\b/i,
  // "no service", "I don't have any bars"
  /\b(?:no|zero|without|don'?t have(?:\s+any)?|have no)\s+(?:cell\s+|phone\s+)?(?:signal|service|reception|bars)\b/i,
  // "where can I get signal?", "where should we go to find reception?"
  new RegExp(String.raw`\bwhere\s+(?:can|could|do|would|should)\s+(?:i|we)\s+(?:(?:go|walk|hike|head|drive)\s+(?:to\s+)?)?(?:get|find|pick up|have)\s+(?:(?:a|any|some|better)\s+)*(?:${SIGNAL}|service)\b`, 'i'),
  // "where can I call from?", "where can we make a call?"
  /\bwhere\s+(?:can|could|do|would|should)\s+(?:i|we)\s+(?:go\s+to\s+)?(?:make\s+a\s+(?:phone\s+)?call|(?:call|phone|text)\s+(?:from|out|for\s+help|911|someone))\b/i,
  // "how far is the nearest signal?", "which way do I go to get reception?"
  new RegExp(String.raw`\b(?:how\s+far|which\s+way|what\s+direction|nearest|closest)\b[^.?!]{0,40}?\b(?:a|any|some|the|get|find|have|for|to|nearest|closest|better|cell|phone|mobile)\s+(?:${SIGNAL})\b`, 'i'),
  // "is there cell coverage around here?"
  new RegExp(String.raw`\b(?:is|are)\s+there\s+(?:any\s+)?(?:${SIGNAL})\b`, 'i'),
  // "I can't call 911", "can't get a text out"
  /\b(?:can'?t|cannot|can not|couldn'?t|unable to)\s+(?:call\s+(?:911|out|for\s+help|anyone|anybody|for\s+rescue)|get\s+(?:a\s+)?(?:call|text)\s+(?:out|through)|get\s+(?:(?:a|any)\s+)?(?:signal|service|reception|bars))\b/i,
];

export function wantsSignal(message: string): boolean {
  return WANTS_SIGNAL.some((r) => r.test(message));
}

export function wantsMap(message: string): boolean {
  return LOST.some((r) => r.test(message)) || wantsSignal(message);
}
