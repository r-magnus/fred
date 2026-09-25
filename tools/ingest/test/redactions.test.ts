import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asRewrites, SURVIVAL_REDACTIONS, survivingRedactions } from '../src/redactions.ts';

// Verbatim from core-survival 1.3.0 chunk text, line wraps included.
const BERRIES = '- Plants with a milky sap; this is an indicator of a poisonous plant.\n4-50. Examples of poisonous bulbs include tulips and death camas. Also -\n- Avoid white and yellow berries for they are frequently poisonous. About one-half of all red berries\nare poisonous. Blue or black berries are generally safe for consumption.\n- Consider plants with shiny leaves as poisonous.\n- The following are generally considered safe to eat:\n- Aggregated fruits and berries (for example, thimbleberry, raspberry, salmonberry, and blackberry)\nare always edible.\n- Single fruits on a stem.';
const STEPS = 'which plant caused the problem. Once a plant has been selected to be tested, proceed as follows:\n- Step 1. If there are any unpleasant odors such as a moldy or musty smell coming from the plant,\nstop testing and disregard as a possible edible plant option. Also, if the plant gives off an "almond"\nscent, disregard it as a possible edible plant option.\n- Step 2. Crush or break part of the plant to determine the color of its sap. If the sap is clear, proceed\nto the next step.';

function apply(text: string): string {
  return asRewrites(SURVIVAL_REDACTIONS).reduce((t, [re, rep]) => t.replace(re, rep), text);
}

test('berry colour rules are removed and the warnings around them kept', () => {
  const out = apply(BERRIES);
  assert.doesNotMatch(out, /Blue or black berries/);
  assert.doesNotMatch(out, /always edible/);
  assert.match(out, /milky sap/);
  assert.match(out, /shiny leaves as poisonous/);
});

test('the taste test is replaced by a labelled Fred note', () => {
  const out = apply(STEPS);
  assert.doesNotMatch(out, /Step 1\.|Step 2\./);
  assert.match(out, /Fred note: the manual's step-by-step taste test is left out/);
});

test('every redaction has a reason', () => {
  for (const r of SURVIVAL_REDACTIONS) assert.ok(r.why.trim().length > 10, r.text);
});

test('survivingRedactions flags a removed passage that is still present', () => {
  assert.deepEqual(survivingRedactions(SURVIVAL_REDACTIONS, [apply(BERRIES), apply(STEPS)]), []);
  assert.equal(survivingRedactions(SURVIVAL_REDACTIONS, [BERRIES]).length > 0, true);
});

test('patterns match curly quotes too', () => {
  const curly = STEPS.replace('"almond"', '“almond”');
  assert.doesNotMatch(apply(curly), /almond/);
});
