/**
 * The words on an empty chat: a short greeting as the title with a line under
 * it, and what the text box suggests asking about.
 *
 * The greetings are calm on purpose. Someone may open Fred hurt or
 * frightened, so none of them jokes about being lost or in trouble.
 */

/**
 * The title of an empty chat, one chosen at random, with a line under it that
 * carries the thought a little further (#209).
 */
export const GREETINGS: readonly { readonly line: string; readonly more: string }[] = [
  { line: 'Take a deep breath.', more: 'In through the nose, slowly out. Whatever comes next, you’ll think more clearly for it.' },
  { line: 'Hey, you.', more: 'Whatever brought you here, big or small, you’re welcome to ask.' },
  { line: 'Life is a gift.', more: 'Every day out here is worth looking after, starting with yourself.' },
  { line: 'One step at a time.', more: 'Big problems shrink when you only look at the next thing to do.' },
  { line: 'Good to see you.', more: 'Wherever the trail has taken you today, I’m glad you stopped by.' },
  { line: 'Easy does it.', more: 'There’s no rush. Slow, careful choices are usually the right ones out here.' },
  { line: 'Go gently.', more: 'On the trail and on yourself. Being kind to your body gets you further.' },
  { line: 'First, be still.', more: 'A minute of stillness lets you see what’s really going on before you act.' },
  { line: 'Calm comes first.', more: 'A steady head is the best tool you carry. Everything else follows from it.' },
  { line: 'Start where you are.', more: 'You don’t need it all figured out. Begin with what’s in front of you.' },
  { line: 'Look up now and then.', more: 'The view is half the reason you came. The trail will still be there.' },
  { line: 'Listen for a moment.', more: 'Wind, water, birds. The land tells you a lot if you give it a minute.' },
  { line: 'Notice something small.', more: 'A flower, a track, the shape of a leaf. Small things make a walk.' },
  { line: 'Stay curious.', more: 'Wondering what that plant is, or which way is north? Just ask.' },
  { line: 'The trail will wait.', more: 'Stopping to rest, eat or look around is never time wasted.' },
  { line: 'The long way is fine.', more: 'Getting there safely matters more than getting there fast.' },
  { line: 'Small steps still count.', more: 'Progress is progress, however slow it feels.' },
  { line: 'Rest is part of the walk.', more: 'Tired legs and a tired mind make mistakes. A break is part of the plan.' },
  { line: 'Slow is steady.', more: 'A pace you can keep all day beats one that wears you out by noon.' },
  { line: 'Mind your footing.', more: 'One careless step is how most trips go wrong. Take your time on rough ground.' },
  { line: 'Breathe in the pines.', more: 'Fresh air, quiet and no hurry. That’s what you came out here for.' },
  { line: 'Wherever you are, be there.', more: 'Everything else can wait. Right now, you’re here.' },
  { line: 'The mountain is in no hurry.', more: 'It will be there tomorrow. Turning back is always allowed.' },
  { line: 'Water first, then worries.', more: 'Thirst makes everything harder. Have a drink, then think it through.' },
  { line: 'Pack light, think ahead.', more: 'A little planning now saves a lot of trouble later.' },
  { line: 'Ask early, not late.', more: 'Small problems are easiest to fix while they’re small. Ask me anytime.' },
  { line: 'Leave it better than you found it.', more: 'Pack out what you pack in, and the next person finds it the way you did.' },
  { line: 'You know more than you think.', more: 'Trust your instincts, and check them with me when you’re unsure.' },
  { line: 'Steady hands, steady heart.', more: 'Move slowly and on purpose. Calm hands make fewer mistakes.' },
  { line: 'The sky is wide today.', more: 'Whatever’s weighing on you, there’s room out here to set it down a while.' },
  { line: 'You’re doing fine.', more: 'Out here, doing the next right thing is all anyone can do.' },
  { line: 'Every trail bends somewhere.', more: 'What’s hard right now won’t stay hard forever. Keep putting one foot down.' },
  { line: 'Good things take time.', more: 'Most things go better when you give them a little time, answers included.' },
  { line: 'Let the river teach you.', more: 'Water finds its way around rocks. There’s usually another way through.' },
  { line: 'Quiet is good company.', more: 'A little silence settles the mind. Enjoy it while it lasts.' },
  { line: 'Eat something, then decide.', more: 'Hunger clouds judgement. A snack and a sit-down make choices easier.' },
  { line: 'Trust the map, check the ground.', more: 'A plan is a guide. Look around and make sure the land agrees.' },
  { line: 'Daylight is a gift.', more: 'Use it well, and plan to be settled before it runs out.' },
  { line: 'Be kind to your feet.', more: 'They carry you every step. Stop early when something rubs.' },
  { line: 'Strong is slow and sure.', more: 'Strength out here looks like patience, not speed.' },
  { line: 'Weather changes, so can plans.', more: 'Changing course when the sky does is good sense, not giving up.' },
  { line: 'Nothing here needs rushing.', more: 'Take a moment to look around before your next move.' },
  { line: 'Sit with the view a while.', more: 'You worked to get here. Let yourself enjoy it.' },
  { line: 'Tread lightly.', more: 'Stay on the trail and give wildlife room. The land remembers.' },
  { line: 'Every hiker starts somewhere.', more: 'No question is too basic. Everyone out here was new once.' },
  { line: 'Wonder is free.', more: 'Every leaf, track and birdsong has a story. Ask me about any of them.' },
  { line: 'Let the wind slow you down.', more: 'Some days are for going far, and some are for going easy.' },
  { line: 'The way back counts too.', more: 'Save some energy for the return. The top is only halfway.' },
  { line: 'Here and now is enough.', more: 'No need to solve tomorrow today. Just this hour, this step.' },
  { line: 'Kindness travels well.', more: 'Share the trail, help where you can, and let others help you.' },
];

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
