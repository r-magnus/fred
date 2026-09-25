import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardText, validateCards, type FieldCard } from '../src/cards.ts';

const PASSAGES = [
  { source: 'ATP 3-50.21 Survival 2018', page: 25, text: 'Once you apply the dressing, do not remove it, even when the\ndressing becomes blood soaked.' },
];

function card(over: Partial<FieldCard>): FieldCard {
  return {
    id: 'c', title: 'T', domain: 'first-aid-physical', medical: true, askedAs: ['q'], summary: 's',
    steps: ['one'], dont: [], getHelp: '', reviewerNote: '',
    sources: [{ source: 'ATP 3-50.21 Survival 2018', page: 25, quote: 'do not remove it, even when the dressing becomes blood soaked' }],
    ...over,
  };
}

test('a quote present in its source passes, across a line break', () => {
  assert.deepEqual(validateCards([card({})], PASSAGES), []);
});

test('an invented quote is refused', () => {
  const bad = card({ sources: [{ source: 'ATP 3-50.21 Survival 2018', page: 25, quote: 'remove the soaked dressing and replace it' }] });
  assert.match(validateCards([bad], PASSAGES)[0]!.problem, /not found/);
});

test('a real quote cited to the wrong page is refused', () => {
  const bad = card({ sources: [{ source: 'ATP 3-50.21 Survival 2018', page: 90, quote: 'do not remove it' }] });
  assert.match(validateCards([bad], PASSAGES)[0]!.problem, /not near p\.90/);
});

test('a card with no steps or sources is refused', () => {
  const problems = validateCards([card({ steps: [], sources: [] })], PASSAGES).map((p) => p.problem);
  assert.ok(problems.includes('no steps') && problems.includes('no sources'));
});

test('card text keeps the don\'t as a word', () => {
  assert.match(cardText(card({ dont: ["Don't take off the dressing."] })), /Don't take off the dressing\./);
});
