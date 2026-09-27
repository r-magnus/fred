import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripTreatmentSteps, WHO_BEC_TREATMENT_STEPS } from '../src/provider-only.ts';

const strip = (t: string) => stripTreatmentSteps(t, WHO_BEC_TREATMENT_STEPS);

// WHO BEC p.33, as extracted (#61).
const SEIZURE = `The goal in managing seizures/convulsions is to
prevent hypoxia and injury.
- Protect the seizing person from falls and from
any hard or sharp objects nearby.
- Do not place anything in the mouth of a person
with active seizure except to suction airway.
[See SKILLS]
- Give oxygen. [See SKILLS]
- Check blood glucose. Give glucose if
<3.5 mmol/L. [See SKILLS]
- Treat with a benzodiazepine [See SKILLS] and
monitor closely for slowing or difficult breathing.
- Place patient in recovery position if there is no
trauma suspected. [See SKILLS]
- If the patient is pregnant, or recently gave birth,
give magnesium sulphate. [See SKILLS]`;

test('drug, oxygen and glucose steps leave; the care a hiker can give stays', () => {
  const r = strip(SEIZURE);
  assert.equal(r.removed.length, 4);
  for (const gone of ['oxygen', 'blood glucose', 'benzodiazepine', 'magnesium']) {
    assert.ok(!r.text.toLowerCase().includes(gone), `${gone} should be gone`);
  }
  for (const kept of ['Protect the seizing person', 'Do not place anything in the mouth', 'recovery position', 'The goal in managing']) {
    assert.ok(r.text.includes(kept), `${kept} should stay`);
  }
});

test('sugar by mouth for a conscious person is lay care and stays', () => {
  const r = strip('- If the person can speak and swallow, give oral glucose.\n- If the person cannot speak or is unconscious, give IV glucose if possible.');
  assert.ok(r.text.includes('give oral glucose'));
  assert.ok(!r.text.includes('IV glucose'));
});

test('bare words are not instructions', () => {
  // "oxygen-carrying blood" explains shock; nothing here tells anyone to give anything.
  const t = '- Poor perfusion is the failure to deliver enough oxygen-carrying blood to the vital organs.';
  assert.equal(strip(t).removed.length, 0);
});

test('a flattened table row loses only its treatment sentence', () => {
  const row = '- Burns disrupt the skin barrier and can lead to severe infection and fluid loss. Cover the burn with a clean dressing. Give IV fluids according to burn size. Keep the person warm, since burns make it hard to hold body heat.';
  const r = strip(row);
  assert.deepEqual(r.removed, ['Give IV fluids according to burn size.']);
  assert.ok(r.text.includes('Burns disrupt the skin barrier'));
  assert.ok(r.text.includes('Keep the person warm'));
});
