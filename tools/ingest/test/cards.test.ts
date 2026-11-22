import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardsLicense, cardText, validateCards, WHO_BEC_SOURCE, type FieldCard } from '../src/cards.ts';

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

test('cards that quote WHO BEC make the card pack nonCommercial; without WHO quotes it is not (#214)', () => {
  const who = card({ id: 'seizure', sources: [{ source: WHO_BEC_SOURCE, page: 100, quote: 'q' }] });
  assert.equal(cardsLicense([card({}), who]).nonCommercial, true);
  assert.equal(cardsLicense([card({})]).nonCommercial, false);
  assert.equal(cardsLicense([card({})]).id, cardsLicense([who]).id);
});

test('an unsourced line the card already says is not read out again (#268)', () => {
  const c = card({
    steps: ['Go to the place with the least to burn: bare ground, rock, a road.'],
    dont: ["Don't light any fire, even to signal."],
    unsourced: [
      { text: "Don't light any fire, even to signal.", why: 'w' },
      { text: 'bare ground, rock, a road', why: 'w' },
      { text: 'A line only the note has.', why: 'w' },
    ],
  });
  const text = cardText(c);
  assert.equal(text.split("Don't light any fire").length - 1, 1);
  assert.equal(text.split('bare ground, rock, a road').length - 1, 1);
  assert.match(text, /\nA line only the note has\.$/);
});
