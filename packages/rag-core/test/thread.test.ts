import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addsToThread } from '../src/pipeline.ts';

const chat = (request: string) => ({ kind: 'chat', reply: '', offer: null, diagnostics: { understood: { intent: 'chat', request, used: false } } }) as never;
const opts = (question: string) => ({ previous: { question, topScore: 0.5 }, intent: true });

test('#228: a follow-up that adds a condition is asked as the restated request', () => {
  assert.equal(addsToThread(chat("what to bring on a day hike when it's supposed to rain a lot"), "it's supposed to rain a lot", opts('what should i bring on a day hike')),
    "what to bring on a day hike when it's supposed to rain a lot");
});

test('#228: thanks and a report that it worked stay small talk', () => {
  assert.equal(addsToThread(chat('how to start a campfire'), 'haha nice, the fire is going now', opts('any tips for getting a campfire lit')), undefined);
  assert.equal(addsToThread(chat('what to bring on a day hike'), 'thanks, that helps', opts('what should i bring on a day hike')), undefined);
});

test('#228: part of an earlier word is not new', () => {
  assert.equal(addsToThread(chat('getting a campfire lit, the fire'), 'the fire', opts('any tips for getting a campfire lit')), undefined);
});
