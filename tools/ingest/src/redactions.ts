/**
 * Passages removed from a manual at ingest, each with the reason.
 *
 * The field cards deliberately leave some manual heuristics out: they read as
 * permission to eat an unidentified plant. But the manual passages were still in
 * the survival pack, so search could hand them to the model beside the card that
 * omits them (docs/results-phase1.md §10, Ryan's wild-plants review). Removing
 * them here is the only place that closes that route.
 *
 * Kept deliberately short, and every entry states why. It is a list of things
 * Fred must not surface, not a way to edit the manual's advice to taste. A
 * removal leaves a labelled "Fred note" where the model might otherwise infer
 * the missing procedure.
 *
 * Patterns match across the PDF's hard line wraps: every space in `text`
 * matches any run of whitespace.
 */
export interface Redaction {
  readonly text: string;
  readonly replacement: string;
  readonly why: string;
}

const FRED_NOTE_TASTE_TEST =
  "(Fred note: the manual's step-by-step taste test is left out here. It takes more than 24 hours for each part of a plant and is only a last resort for long-term survival, not a way to check a plant is safe.)";

export const SURVIVAL_REDACTIONS: readonly Redaction[] = [
  {
    text: '- Avoid white and yellow berries for they are frequently poisonous. About one-half of all red berries are poisonous. Blue or black berries are generally safe for consumption.',
    replacement: '',
    why: 'Berry colour is not an identification. "Blue or black berries are generally safe" reads as permission to eat an unidentified berry.',
  },
  {
    text: '- The following are generally considered safe to eat:',
    replacement: '',
    why: 'Header of the list below; meaningless without it.',
  },
  {
    text: '- Aggregated fruits and berries (for example, thimbleberry, raspberry, salmonberry, and blackberry) are always edible.',
    replacement: '',
    why: '"Always edible" is too absolute for a safety-critical answer, and lookalikes exist.',
  },
  {
    text: '- Single fruits on a stem.',
    replacement: '',
    why: 'A shape rule offered as an edibility rule.',
  },
  {
    text: 'Once a plant has been selected to be tested, proceed as follows:',
    replacement: FRED_NOTE_TASTE_TEST,
    why: 'Introduces the step-by-step taste test removed below.',
  },
  {
    text: '- Step 1. If there are any unpleasant odors such as a moldy or musty smell coming from the plant, stop testing and disregard as a possible edible plant option. Also, if the plant gives off an "almond" scent, disregard it as a possible edible plant option.',
    replacement: '',
    why: 'Taste-test procedure: a last-resort survival method that a hiker could mistake for a safety check.',
  },
  {
    text: '- Step 2. Crush or break part of the plant to determine the color of its sap. If the sap is clear, proceed to the next step.',
    replacement: '',
    why: 'Taste-test procedure.',
  },
  {
    text: "- Step 3. Touch the plant's sap or juice to the inner forearm. If there are no ill effects, such as a rash or burning sensation to the skin, then proceed with the rest of the steps.",
    replacement: '',
    why: 'Taste-test procedure.',
  },
  {
    text: '- Step 4. If a there was not an ill reaction when touching the inner forearm, place some of the plant juice on the outer lip for eight minutes. If a reaction occurs, stop the test.',
    replacement: '',
    why: 'Taste-test procedure.',
  },
  {
    text: '- Step 5. If still no reaction, taste a small pinch of the plant and leave it in the mouth for eight minutes. If there is an unpleasant taste, such as bitterness or a numbing sensation of the tongue or lips, stop the test. If a reaction does not occur, swallow the pinch of plant.',
    replacement: '',
    why: 'Taste-test procedure: tells the reader to eat an unidentified plant.',
  },
  {
    text: 'Note. Sometimes heavy smokers are unable to taste various poisons, such as alkaloids.',
    replacement: '',
    why: 'Part of the taste-test procedure.',
  },
  {
    text: '- Step 6. After swallowing, wait eight hours. If there is no reaction after eight hours, chew a handful of the plant, swallow, and wait an additional eight hours. If no reaction occurs after eight hours, consider the tested plant part edible.',
    replacement: '',
    why: 'Taste-test procedure: tells the reader to eat a handful of an unidentified plant.',
  },
  {
    text: '- Step 7. Eat any new or strange food with restraint until the body has become accustomed to it. The plant may be slightly toxic and harmful when eaten in large quantities.',
    replacement: '',
    why: 'Taste-test procedure.',
  },
];

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A global regex matching `text` across any whitespace, including line wraps,
 * and either straight or curly quotes: rewrites run before the quotes are
 * straightened.
 */
export function redactionPattern(text: string): RegExp {
  const word = (w: string): string => escape(w).replace(/"/g, '["\u201c\u201d]').replace(/'/g, "['\u2018\u2019]");
  return new RegExp(text.trim().split(/\s+/).map(word).join('\\s+'), 'g');
}

/** As clean-rule rewrites: [pattern, replacement]. */
export function asRewrites(list: readonly Redaction[]): [RegExp, string][] {
  return list.map((r) => [redactionPattern(r.text), r.replacement]);
}

/**
 * Redacted text that survived into chunks, if any. Ingest throws on a non-empty
 * result, so a change in the PDF extraction cannot silently let a removed
 * passage back in.
 */
export function survivingRedactions(list: readonly Redaction[], chunkTexts: readonly string[]): string[] {
  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const all = norm(chunkTexts.join(' '));
  return list
    .filter((r) => r.replacement === '' || !r.replacement.includes(r.text))
    .map((r) => norm(r.text))
    .filter((t) => t.split(' ').length >= 5 && all.includes(t));
}
