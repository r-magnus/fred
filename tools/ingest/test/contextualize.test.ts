import { test } from 'node:test';
import assert from 'node:assert/strict';
import { structuralLabel, buildContext } from '../src/contextualize.ts';
import type { DraftChunk } from '../src/chunk.ts';

const chunk = (over: Partial<DraftChunk> & { text: string }): DraftChunk => ({
  section: 'SNAKE BITES', page: 174, domain: 'first-aid-physical', blockKind: 'prose', ...over,
});

/**
 * The structural half must not depend on a 1.7B model getting it right. These
 * are the cases that have already cost us twice: the inverted "Do not -"
 * snakebite list (results-alpha.md) and the abdominal wound-packing answer
 * (results-holdout.md).
 */
test('prohibition text is labelled from the body, however it is phrased', () => {
  for (const text of [
    'Do not apply ice to the bite site.',
    "Don't cut the wound open.",
    'Never apply a tourniquet for a snakebite.',
    'Avoid giving the casualty alcohol.',
    'Some prose first.\nDo not pack hemostatic dressings into the abdomen or chest.',
  ]) {
    assert.match(structuralLabel(chunk({ text })), /AVOID/, text);
  }
});

test('prohibition is labelled from the heading even when the body lost it', () => {
  // This is the exact defect: chunking split the list from its "Do not -"
  // header, so the body reads as instructions and nothing in it says otherwise.
  const orphan = chunk({
    section: 'SNAKE BITES > Do not -',
    text: 'Make any deep cuts at the bite site.\nSuck the venom out with your mouth.',
  });
  assert.match(structuralLabel(orphan), /AVOID/);
});

test('ordinary procedures are labelled as steps, not as prohibitions', () => {
  const proc = chunk({ text: 'Place the heel of one hand on the centre of the chest.', blockKind: 'procedure' });
  assert.equal(structuralLabel(proc), 'Ordered steps to follow.');
});

test('ordinary prose gets no structural label', () => {
  assert.equal(structuralLabel(chunk({ text: 'The scalp is richly supplied with blood vessels.' })), '');
});

test('"avoid" inside a word does not trigger a prohibition label', () => {
  // \b matters: "unavoidable" and "avoidance" should not make a passage read as
  // a list of things not to do.
  assert.equal(structuralLabel(chunk({ text: 'Some blood loss is unavoidable in this injury.' })), '');
});

test('the assembled context leads with where the passage came from', () => {
  const c = buildContext(
    chunk({ text: 'Do not apply ice.' }),
    'ATP 4-02.11 First Aid',
    'Covers treatment of venomous snakebites in the field.',
  );
  assert.equal(
    c,
    'ATP 4-02.11 First Aid, SNAKE BITES. Lists actions to AVOID, not steps to follow. ' +
    'Covers treatment of venomous snakebites in the field.',
  );
});

test('a missing model summary still leaves provenance and the safety label', () => {
  const c = buildContext(chunk({ text: 'Do not apply ice.' }), 'ATP 4-02.11 First Aid', '');
  assert.equal(c, 'ATP 4-02.11 First Aid, SNAKE BITES. Lists actions to AVOID, not steps to follow.');
  assert.doesNotMatch(c, /\s{2}|\.\s*\./, 'no double spaces or double periods when a part is empty');
});
