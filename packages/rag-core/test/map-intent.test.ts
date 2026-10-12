import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { wantsMap, wantsSignal } from '../src/map-intent.ts';

test('lost, where-am-I and no-signal messages open the map', () => {
  for (const m of [
    "I'm lost",
    "I think I'm lost. I don't know which way the trail is.",
    'we are totally lost',
    'i got lost on the way back',
    'I lost the trail',
    'where am i?',
    'Where are we right now',
    "I don't know where I am",
    'no idea where we are',
    "can't find the trailhead",
    'which way is the road',
    'I have no signal, what should I do?',
    "I don't have any service",
    'where can I get cell signal?',
  ]) assert.ok(wantsMap(m), m);
});

test('ordinary questions do not', () => {
  for (const m of [
    'I lost my knife',
    'I lost a lot of blood',
    'lost my appetite after the hike',
    'where am I likely to find morels?',
    'how do I find north without a compass?',
    'What plants and animals are near me?',
    'My friend is lost in thought',
  ]) assert.ok(!wantsMap(m), m);
});

test('signal messages are told apart from lost ones (#77)', () => {
  for (const m of [
    'I have no service, what do I do?',
    'I have no signal, what should I do?',
    "I don't have any service",
    'I lost signal an hour ago',
    'where can I get cell signal?',
    'where should we go to find reception?',
    'where can I call from?',
    'Where can we make a call?',
    'how far is the nearest signal?',
    'which way do I go to get reception?',
    'what direction is the closest cell coverage',
    'is there cell coverage around here?',
    'I need to call 911 but I have no bars',
    "I can't call 911",
    'my phone has no signal and my friend is hurt',
  ]) {
    assert.ok(wantsSignal(m), m);
    assert.ok(wantsMap(m), m);
  }
  for (const m of [
    "I'm lost",
    'where am i?',
    "can't find the trailhead",
    'how far can a signal fire be seen?',
    'which way should I point the signal mirror?',
    'how do I signal a helicopter?',
    'what is the nearest water source?',
    'which way is the road',
    "I can't call my dog back",
    'is there a ranger service near Yosemite?',
    'where can I find water?',
    'are there bears around here?',
  ]) assert.ok(!wantsSignal(m), m);
});

// Every eval question: the rule may fire only on questions about being lost or
// finding signal, listed here by id so a new match is looked at, not waved through.
test('across the eval sets it fires only where expected', () => {
  const EXPECTED = new Set(['br-lost-01', 'sv-lost-01', 'sv-signal-01', 'hs-staymove-01', 'neg-location-01', 'br-stress-01', 'az-lostburn-01']);
  const dir = 'tools/eval/data';
  const fired: string[] = [];
  for (const f of readdirSync(dir).filter((x) => /^(graded|holdout)-.*\.json$/.test(x))) {
    const data = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')) as unknown;
    if (!Array.isArray(data)) continue;
    for (const q of data as { id: string; question: string }[]) if (wantsMap(q.question)) fired.push(q.id);
  }
  assert.deepEqual(fired.filter((id) => !EXPECTED.has(id)), []);
});
