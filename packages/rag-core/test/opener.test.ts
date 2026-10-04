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
  assert.equal(checkOpener('Ouch. That sounds painful.', m('splinter')), null);
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
