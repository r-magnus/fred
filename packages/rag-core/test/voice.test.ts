import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatReply, declineReply, hurtPart, leadLine } from '../src/voice.ts';
import { CHAT_REPLY } from '../src/prompt.ts';

test('names the hurt body part and whose it is, from the hiker\'s words (#172)', () => {
  assert.equal(hurtPart('my mom slipped on the wet boardwalk and put her hand out, now her wrist is swollen and she wont let me touch it'), "your mom's wrist");
  assert.equal(hurtPart('i rolled my ankle on a root'), 'your ankle');
  assert.equal(hurtPart("my son's elbow is all scraped up"), "your son's elbow");
  // A pronoun reaches back to the last person named.
  assert.equal(hurtPart('her ankle is really swollen now', ['my sister tripped on the stairs']), "your sister's ankle");
  // Nobody named: the hiker's own pronoun.
  assert.equal(hurtPart('he cut his hand on the can lid'), 'his hand');
  assert.equal(hurtPart("the dog's paw is bleeding"), "the dog's paw");
});

test('names no part when it cannot tell which, or whose', () => {
  // Two hurt parts, or several in one breath.
  assert.equal(hurtPart('my son came off his bike on the fire road and took the skin off his elbow and palm'), null);
  assert.equal(hurtPart('my shoulders and neck are so stiff from this pack i can barely turn my head'), null);
  assert.equal(hurtPart('my knee hurts and my ankle is swollen'), null);
  // Said to be fine.
  assert.equal(hurtPart('my wrist is fine'), null);
  // "the leg" is nobody's.
  assert.equal(hurtPart('a snake bit him on the leg, help me'), null);
  assert.equal(hurtPart('how do i make rope from plant fibers'), null);
});

test('a problem is met with its own words, a plain question with a friendly start', () => {
  assert.equal(leadLine('my mom slipped and now her wrist is swollen', [], 'calm'), "Sorry about your mom's wrist.");
  assert.equal(leadLine('my buddy got stung a bunch of times', [], 'calm'), 'Sorry to hear about your buddy.');
  assert.equal(leadLine('ugh my stomach has been cramping all day', [], 'calm'), 'Sorry about your stomach.');
  assert.equal(leadLine("i've had diarrhea all morning", [], 'calm'), "Sorry you're dealing with that.");
  assert.equal(leadLine('how do i start a fire with damp wood', [], 'calm'), 'Happy to help.');
  // A statement that is no problem gets no line.
  assert.equal(leadLine('we made camp by the lake', [], 'calm'), null);
  assert.equal(leadLine("can't wait to get to the summit", [], 'calm'), null);
  assert.equal(leadLine("can't feel my fingertips and they've gone kind of waxy", [], 'calm'), 'Sorry about your fingertips.');
});

test('never sympathy or an offer after a yes/no question: it would hint at the answer', () => {
  for (const q of ['can i pop the blister on my heel', 'is it ok to drink from this pond if i boil it', 'should i take her ring off']) {
    const line = leadLine(q, [], 'calm');
    if (q.startsWith('is it')) assert.notEqual(line, null);
    assert.ok(line === null || line === 'Glad you asked.' || line === 'Thanks for asking.', `${q}: ${line}`);
  }
});

test('no line carries advice, a judgment of risk or a promise', () => {
  const messages = [
    'my mom slipped and now her wrist is swollen', 'my buddy got stung a bunch of times', "i've had diarrhea all morning",
    'how do i start a fire with damp wood', 'is it safe to eat these berries', "i'm scared of the storm tonight",
    'he cut his hand on the can lid', 'my feet are covered in blisters',
  ];
  const bad = /\b(?:you should|you'll be|fine|safe|normal|don't worry|nothing to|probably|serious|try|make sure|yes|no problem)\b/i;
  for (const m of messages) {
    for (const urgent of ['calm', 'now', 'danger'] as const) {
      for (const h of [[], ['hello'], ['hello', 'thanks']]) {
        const line = leadLine(m, h, urgent);
        if (line !== null) assert.ok(!bad.test(line), `${m}: ${line}`);
      }
    }
  }
});

test('in an emergency the line is presence only, and comes once', () => {
  assert.equal(leadLine('he is not breathing', [], 'danger'), "I'm here with you.");
  // The danger sign two messages back already had its line.
  assert.equal(leadLine('ok i started cpr', ['my dad collapsed and he is not breathing'], 'danger'), null);
});

test('a situation is named once, and a question is not opened the same way every turn', () => {
  const first = 'my mom slipped and now her wrist is swollen';
  assert.equal(leadLine('her wrist is really swollen now', [first], 'calm'), null);
  // A question in the middle of trouble gets no friendly start.
  assert.equal(leadLine('how do i make a sling', [first], 'calm'), null);
  assert.equal(leadLine('do we play dead', ['black bear running straight at us'], 'calm'), null);
  // Plain questions: a start on one, none on the next, one on the third.
  const qs = ['how do i pitch a tarp', 'what knot holds a ridgeline', 'how long should the guy lines be'];
  assert.notEqual(leadLine(qs[0]!, [], 'calm'), null);
  assert.equal(leadLine(qs[1]!, qs.slice(0, 1), 'calm'), null);
  assert.notEqual(leadLine(qs[2]!, qs.slice(0, 2), 'calm'), null);
  // A blister read as "help now" is not an emergency.
  assert.equal(leadLine('got a blister now', [], 'now'), "Sorry you're dealing with that.");
  // A second symptom straight after sympathy is not met with more of it.
  assert.equal(leadLine("she's also got a headache and she's kinda pale", ["ok we're out here now and my wife's feeling dizzy"], 'calm'), null);
  // Said to be over, or long past: no sympathy.
  assert.equal(leadLine('i sprained my wrist skiing back in march but it healed fine', [], 'calm'), null);
  assert.equal(leadLine('my ankle feels better now', [], 'calm'), null);
});

test('small talk is answered by what was said, not one line for everything', () => {
  assert.equal(chatReply('hello', [], false), "Hi, I'm Fred. Ask me about first aid, finding your way, or the plants and animals around you.");
  assert.equal(chatReply('what a view', [], false), CHAT_REPLY);
  assert.equal(chatReply('thanks', ['how do i treat a blister'], false), "You're welcome.");
  assert.equal(chatReply('ok', ['how do i treat a blister', 'thanks'], false), 'Okay.');
  assert.equal(chatReply('he seems better now', ['my buddy is dizzy'], false), "Good to hear. Tell me if anything changes.");
  // What Fred does is listed once, at the start, never again.
  for (let n = 1; n < 6; n++) assert.ok(!/plants and animals/.test(chatReply('nice breeze up here', Array(n).fill('x'), false)));
});

test('a report of something done is acknowledged, never praised', () => {
  const praise = /\b(?:good|great|nice|well done|perfect|glad|smart)\b/i;
  for (const m of ['ok i took the tourniquet off', 'ok its off', 'done, i moved him', 'alright we started walking down']) {
    for (let n = 0; n < 4; n++) {
      const reply = chatReply(m, Array(n).fill('x'), false);
      assert.ok(n === 0 || !praise.test(reply), `${m}: ${reply}`);
    }
  }
});

test('two small-talk replies running are never the same', () => {
  const said = ['nice breeze up here', 'the trail is quiet today', 'lots of birds out', 'clouds are rolling in'];
  for (let i = 1; i < said.length; i++) {
    assert.notEqual(chatReply(said[i]!, said.slice(0, i), false), chatReply(said[i - 1]!, said.slice(0, i - 1), false));
  }
});

test('small talk about a problem names it, and offers the card when one matched', () => {
  assert.equal(chatReply('my knee is sore after that descent', [], true), "Sorry about your knee. In case you need it, here's what to do:");
  assert.equal(chatReply('my knee is sore after that descent', [], false), "Sorry about your knee. Tell me more about what's going on and I'll look for what helps.");
});

test('a decline says what it could not answer and what would help', () => {
  const yesNo = declineReply('can i take ibuprofen with this', []);
  assert.match(yesNo.text, /can't say either way/);
  assert.equal(declineReply('what is the best tent to buy', [], true).text, "That's outside what my guides cover.");
  assert.equal(declineReply('a bee stung my dog on the nose', [], true).text, "Sorry you're dealing with that. That's outside what my guides cover.");
  const hurt = declineReply('my knee is sore after that descent', []);
  assert.equal(hurt.text, "Sorry about your knee. I don't have steps for that in my guides, and I'd rather not guess.");
  assert.match(hurt.hint, /what happened/);
  // Nothing that reads as an answer to a yes/no question.
  assert.ok(!/\b(?:yes|no|fine|safe|ok|okay|sure)\b/i.test(`${yesNo.text} ${yesNo.hint}`));
});
