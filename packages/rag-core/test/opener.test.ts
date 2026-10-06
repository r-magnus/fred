import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkOpener } from '../src/opener.ts';

const m = (s: string) => [s];

test('keeps a warm line that only acknowledges (#130)', () => {
  assert.equal(checkOpener('That sounds like a rough morning on the trail.', m('diarrhea all morning')), 'That sounds like a rough morning on the trail.');
  assert.equal(checkOpener(' Numb toes in the cold are no fun at all', m("my toes are numb and it's so cold")), 'Numb toes in the cold are no fun at all.');
  assert.equal(checkOpener('"A blister on the heel is no fun at all!"', m('a blister on my heel')), 'A blister on the heel is no fun at all!');
  // No word for how it feels: dropped, however harmless.
  assert.equal(checkOpener('Blisters can really slow a day down!', m('a blister on my heel')), null);
});

test('drops advice, however it is put', () => {
  for (const s of ['Try to keep your feet dry.', "Don't panic, help is coming.", 'You should rest for a bit.', 'Make sure the water is boiled first.', 'Best to turn back now.']) {
    assert.equal(checkOpener(s, m('feet wet')), null, s);
  }
});

test('drops reassurance and any judgment of risk', () => {
  for (const s of ["Don't worry, you'll be fine.", 'That is probably nothing serious.', 'Those berries look tasty!', 'Mountain springs are usually clean.', 'A bee sting is pretty common out here.']) {
    assert.equal(checkOpener(s, m('stung by a bee')), null, s);
  }
});

test('drops a condition the hiker did not name, keeps one they did', () => {
  assert.equal(checkOpener('Sounds like a nasty sprain on that ankle.', m('i rolled my ankle')), null);
  assert.equal(checkOpener('Dehydration on a hot day is miserable.', m('i feel dizzy and hot')), null);
  assert.equal(checkOpener('A blister with miles to go is miserable.', m("i've got a blister and miles to go")), 'A blister with miles to go is miserable.');
});

test('drops numbers, questions, more than one sentence, and talk about Fred', () => {
  assert.equal(checkOpener('Five miles on a blister is a lot.', m('blister')), null);
  assert.equal(checkOpener('Ten hours of rain is a lot.', m('rain')), null);
  assert.equal(checkOpener('3 days of rain is a lot.', m('rain')), null);
  assert.equal(checkOpener('Ouch, how did that happen?', m('splinter')), null);
  // Only the first sentence is kept, then checked on its own.
  assert.equal(checkOpener('Ouch. That sounds painful.', m('splinter')), null);
  assert.equal(checkOpener("Oh no, a dropped filter is frustrating. Let's go find it.", m('i dropped my filter')), 'Oh no, a dropped filter is frustrating.');
  assert.equal(checkOpener("I'm not a doctor, but that sounds rough.", m('knee')), null);
  assert.equal(checkOpener('Ok.', m('hi')), null);
});

test('drops warnings and claims to see things (#130)', () => {
  assert.equal(checkOpener('A dead headlamp could mean trouble getting back.', m('my headlamp died')), null);
  assert.equal(checkOpener('Looking at the map, I can see the trails.', m('how do i read a topo map')), null);
  assert.equal(checkOpener('Itchy skin is a sign of poison oak.', m('itchy arm')), null);
});

test('only the hiker\'s words and a fixed vocabulary: no new facts (#130)', () => {
  const cases: [string, string][] = [
    ['Food at camp should be stored in a cool, dry place.', 'how should i store food at camp'],
    ['Leaves with a rough texture and a white or yellowish sap.', 'what does poison oak look like'],
    ['Frustrated by the lost trail, we need to find another way forward.', 'my friend is panicking after we lost the trail'],
    ["A bee sting can be a bit of a bother, but it's usually not too bad.", 'i got stung by a bee on my arm'],
    ['Green scum on a lake can be harmful to swim in.', 'the lake has green scum on it, is it ok to swim'],
    ['Whales howling at night can be unsettling.', 'we heard wolves howling last night'],
    ['Your knee hurts on the way down.', 'my knee hurts on the way down'],
  ];
  for (const [line, said] of cases) assert.equal(checkOpener(line, m(said)), null, line);
  assert.equal(checkOpener('Wolves howling at night can be unsettling.', m('we heard wolves howling last night')), 'Wolves howling at night can be unsettling.');
  assert.equal(checkOpener('Soaked and freezing feet are no fun at all.', m('my feet are soaked and freezing')), 'Soaked and freezing feet are no fun at all.');
});

test('comfort without permission or promises (#130, round 3)', () => {
  const ok = (line: string, said: string) => assert.equal(checkOpener(line, m(said)), line.endsWith('.') || line.endsWith('!') ? line : `${line}.`, line);
  const no = (line: string, said: string) => assert.equal(checkOpener(line, m(said)), null, line);
  ok("Hey, a forgotten rain jacket happens, it's okay.", 'i forgot my rain jacket');
  ok("Take a deep breath, being lost is scary, we'll work through it together.", "i'm lost and freaking out");
  ok('Glad you asked about drinking from the pond.', 'is it ok to drink from this pond if i boil it');
  // "okay" never opens onto what is okay.
  no("It's okay to swim in this river.", 'can i swim in this river');
  // Asked whether it is all right: nothing that sounds like yes.
  no('Hey, these things happen.', 'is it normal to feel this out of breath up here');
  no('Good thinking, the strawberries look great.', 'is it fine to eat these wild strawberries');
  // Promises and normalising still go.
  no("You'll be fine, it happens to everyone.", 'my stomach is cramping');
  no("Let's keep walking together.", 'should we keep walking');
  no('Take the ibuprofen and breathe.', 'can i take ibuprofen');
  ok("Oh no, scraped skin is no fun, let's take care of it together.", 'i scraped my knee on some rocks');
  no("Oh no, darkness is scary, let's find another way.", 'my headlamp died, how do i get back');
  no("Oh no, cold nights are miserable, let's find a way to stay warm.", 'it is so cold tonight i cant sleep');
});

test('the line is about what the hiker just said (#130, round 4)', () => {
  const ok = (line: string, said: string) => assert.equal(checkOpener(line, m(said)), line, line);
  const no = (line: string, said: string) => assert.equal(checkOpener(line, m(said)), null, line);
  // Ryan: "these things happen, it's okay" makes no sense for a rope question.
  no("Hey, these things happen, it's okay.", 'how do i make rope from plant fibers');
  no("Take a deep breath, we'll work through this together.", 'how do i make rope from plant fibers');
  ok('Happy to help you make rope from plant fibers.', 'how do i make rope from plant fibers');
  // The prompt's own examples, copied onto another message.
  no('Oh no, numb toes in the cold are no fun.', 'my calves keep cramping up on the climb');
  no('Glad you asked about camping near a stream.', 'is it safe to pet the deer');
  // After an offer to help, the hiker's own verb is not advice; a new one is.
  ok('Happy to help you keep your phone battery going on a long trip.', 'how do i keep my phone battery going on a long trip');
  no('Happy to help you avoid the bears.', 'first time camping in bear country, any tips');
  // Sympathy is for a problem, not a question, and hints at "no" after "can i".
  no('Oh no, sorry about the white berries.', 'can i eat these little white berries');
  no('Oh no, sorry about the hike being too far in a day.', 'how far is too far to hike in a day');
  no('Oh no, those black birds with red wings are fascinating.', 'those black birds with red wings are everywhere today');
  ok('Glad you asked about eating those little white berries.', 'can i eat these little white berries');
  // An offer to help with it reads as a yes.
  no('Happy to help you cook those mushrooms.', 'these mushrooms look like chanterelles, can i cook them');
  ok('Happy to help you figure out which way is north from the stars.', 'how can i tell which way is north from the stars');
  // The message handed back is not an opener.
  no('So tired, we still have a long way to go.', 'so tired, we still have a long way to go');
  // A plant's name is not a judgment when the hiker said it.
  ok('Ouch, poison oak on your arm is no fun.', 'i got poison oak on my arm i think');
  no('Ouch, poison oak on your arm is no fun.', 'i got a rash on my arm i think');
});
