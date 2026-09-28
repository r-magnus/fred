import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinNeighbours, mergeText } from '../src/join.ts';

test('the shared stretch is written once, lead-in line or not', () => {
  const a = 'Steps:\n- Make one turn of the string.\n- Blow on it with long steady breaths until it bursts into flame.';
  const b = 'a bow and drill fire-starter (see figure 5-10):\nBlow on it with long steady breaths until it bursts into flame.\n- Add kindling.';
  assert.equal(mergeText(a, b), `${a}\n- Add kindling.`);
  assert.equal(mergeText('first part ends here with enough words', 'unrelated start'), 'first part ends here with enough words\nunrelated start');
});

test('neighbours join in reading order, in the place of the better-ranked one', () => {
  const rec = (packId: string, ordinal: number, text: string) =>
    ({ id: `${packId}:${ordinal}`, packId, ordinal, text, context: '', section: 's', source: 'x', page: 1, domain: 'survival' as const, licenseId: 'l', blockKind: 'prose' as const, audience: 'everyone' as const });
  const out = joinNeighbours([
    rec('core-survival', 8, 'second half of the steps, overlap here then more'),
    rec('core-firstaid', 8, 'other pack, same ordinal'),
    rec('core-survival', 7, 'first half of the steps, overlap here then more'.replace('then more', '')),
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.id, 'core-survival:8');
  assert.match(out[0]!.text, /^first half/);
  assert.equal(out[1]!.packId, 'core-firstaid');
});
