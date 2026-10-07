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
const WANTS_MAP: readonly RegExp[] = [
  // "I'm lost", "we're totally lost", "I think I got lost", "getting lost"
  /\b(?:i'?m|i am|we'?re|we are|been|got|get|getting|gotten)\s+(?:\w+\s+)?lost\b(?!\s+(?:my|our|his|her|their|the|a|an)\b)/i,
  /\blost\s+(?:the|my|our)\s+(?:trail|way|path|bearings|route)\b/i,
  /\blost\s+(?:the\s+)?(?:signal|service|reception)\b/i,
  // "where am I?", "where are we right now?" (not "where am I likely to find morels")
  /\bwhere\s+(?:am\s+i|are\s+we)(?:\s+(?:right\s+)?now|\s+exactly)?\s*[?.!]*\s*$/i,
  /\b(?:don'?t|do not|can'?t|cannot|no idea)\s+(?:\w+\s+)?(?:know|tell|figure out)?\s*where\s+(?:i\s+am|we\s+are|i'?m|we'?re)\b/i,
  /\b(?:can'?t|cannot|couldn'?t|can not)\s+find\s+(?:the|my|our)\s+(?:way|trail|path|car|camp|campsite|trailhead|road)\b/i,
  /\bwhich\s+way\s+(?:is|to)\s+(?:the\s+)?(?:trail|trailhead|road|car|camp|town|parking)\b/i,
  // Signal: "no service", "where can I get signal?"
  /\b(?:no|zero|without|don'?t have(?:\s+any)?|have no)\s+(?:cell\s+|phone\s+)?(?:signal|service|reception|bars)\b/i,
  /\bwhere\s+(?:can|could|do|would)\s+(?:i|we)\s+(?:get|find|pick up)\s+(?:a\s+|any\s+|some\s+)?(?:cell\s+)?(?:signal|service|reception)\b/i,
];

export function wantsMap(message: string): boolean {
  // The iOS keyboard types "I’m" with a curly apostrophe by default, which the
  // patterns' straight ' does not match: "i’m lost" opened no map on iOS.
  const m = message.replace(/[‘’ʼ]/g, "'");
  return WANTS_MAP.some((r) => r.test(m));
}
