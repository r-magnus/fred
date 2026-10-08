/**
 * The words on an empty chat: a short greeting as the title, and what the
 * text box suggests asking about.
 *
 * The greetings are calm on purpose. Someone may open Fred hurt or
 * frightened, so none of them jokes about being lost or in trouble.
 */

/** The title of an empty chat, one chosen at random. */
export const GREETINGS = [
  'Take a deep breath.',
  'Hey, you.',
  'Life is a gift.',
  'One step at a time.',
  'Good to see you.',
  'Easy does it.',
  'Go gently.',
  'First, be still.',
  'Calm comes first.',
  'Start where you are.',
  'Look up now and then.',
  'Listen for a moment.',
  'Notice something small.',
  'Stay curious.',
  'The trail will wait.',
  'The long way is fine.',
  'Small steps still count.',
  'Rest is part of the walk.',
  'Slow is steady.',
  'Mind your footing.',
  'Breathe in the pines.',
  'Wherever you are, be there.',
  'The mountain is in no hurry.',
  'Water first, then worries.',
  'Pack light, think ahead.',
  'Ask early, not late.',
  'Leave it better than you found it.',
  'You know more than you think.',
] as const;

/**
 * "Ask about ..." in the empty text box. Each is something the packs on the
 * phone cover: first aid, survival, hazards, health, signalling, the trail
 * tips, wildlife safety and each state's plants and animals.
 */
export const TOPICS = [
  'first aid',
  'survival',
  'the plants around you',
  'the animals around you',
  'staying safe near wildlife',
  'making water safe to drink',
  'signalling for help',
  'lightning',
  'ticks',
  'burns',
  'frostbite',
  'dehydration',
  'crossing a river',
  'what to pack',
  'setting up camp',
] as const;

/** One of the list at random, and not the one shown last when there is a choice. */
export function pick<T>(from: readonly T[], not?: T): T {
  const rest = from.length > 1 && not !== undefined ? from.filter((x) => x !== not) : from;
  return rest[Math.floor(Math.random() * rest.length)]!;
}
