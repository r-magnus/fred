import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockingCondition, conditionsIn, latestCondition, violatedCondition } from '../src/conditions.ts';
import { asksSomething, asksToEatUnknown, dangerSign, dangerStands, eatingUnknownInThread, petIsPatient } from '../src/triage.ts';
import { asksSpecifically } from '../src/pipeline.ts';

const ids = (ms: string[]): string[] => conditionsIn(ms).map((c) => c.id);

test('a snakebite is read across messages', () => {
  assert.deepEqual(ids(['how do i tell if a snake is venomous', 'my friend just got bit by one']), ['snakebite']);
  assert.deepEqual(ids(['just saw a rattlesnake on the trail', 'it got my buddy on the ankle']), ['snakebite']);
  assert.deepEqual(ids(['a snake struck my buddy']), ['snakebite']);
});

test('a snake with no bite, or another biter, is not a snakebite', () => {
  assert.deepEqual(ids(['how do i tell if a snake is venomous']), []);
  assert.deepEqual(ids(['saw a snake earlier', 'a mosquito bit me']), []);
});

test('a fall is from height or down a slope, not into water', () => {
  assert.deepEqual(ids(['my dad slipped and tumbled down a rocky slope']), ['fall']);
  assert.deepEqual(ids(['my friend fell off a ledge']), ['fall']);
  assert.deepEqual(ids(['my friend fell in the lake and cant stop shaking']), ['hypothermia']);
});

test('the sprain card must not follow a snakebite; the shock card must not follow a fall', () => {
  const snake = conditionsIn(['my friend got bit by a snake']);
  assert.equal(blockingCondition('Twisted or sprained ankle, or a strained muscle', snake)?.id, 'snakebite');
  assert.equal(blockingCondition('Snakebite', snake), undefined);
  assert.equal(blockingCondition('Shock after an injury', conditionsIn(['he fell off a ledge']))?.id, 'fall');
});

test('danger signs', () => {
  for (const m of ["we pulled him out but he isnt breathing", 'one side of her face is drooping', 'he\'s shaky sweaty and confused',
    'blood keeps pushing out', 'my lips are swelling and my throat feels tight', 'my friend stopped sweating and is acting weird',
    'she collapsed on the trail']) assert.ok(dangerSign([m]), m);
  assert.ok(dangerSign(['something big is sniffing around the tent', 'its a bear']));
  assert.ok(dangerSign(['a snake struck my buddy']));
});

test('not danger signs', () => {
  for (const m of ['my knee is killing me going downhill', 'should i pop it', 'is it safe to touch cholla', 'the tent collapsed in the wind',
    'got pretty sunburned today', 'we saw a bear across the valley this morning']) assert.ok(!dangerSign([m]), m);
});

test('a message that asks something', () => {
  for (const m of ['how much water', 'should i follow it down', "ok she's feeling better. unrelated but what's this plant with yellow flowers everywhere",
    'is it safe to touch cholla', 'any tips', 'what helps']) assert.ok(asksSomething(m), m);
  for (const m of ["we're about 2 miles from the car", 'ok found the trail thank god', 'phone at 15%', 'the view up here is amazing']) assert.ok(!asksSomething(m), m);
});

test('a model-written answer that gives advice the condition card forbids is caught; saying not to is fine', () => {
  const snake = conditionsIn(['my friend got bit by a snake']);
  assert.equal(violatedCondition('1. Do not wrap the ankle tightly with ice.\n2. Apply cold compresses intermittently to reduce swelling.', snake)?.id, 'snakebite');
  assert.equal(violatedCondition('1. Do not wrap it tight with ice.\n2. Keep him still and get help.', snake), undefined);
  const burn = conditionsIn(['seared my forearm on the camp stove']);
  assert.equal(violatedCondition('If the blister is larger than a nickel, drain it with a sterile object.', burn)?.id, 'burn');
  assert.equal(violatedCondition('Do not pop the blister. Cover it with a clean dressing.', burn), undefined);
});

test('asking whether something unnamed is safe to eat', () => {
  assert.ok(asksToEatUnknown('can i eat them'));
  assert.ok(asksToEatUnknown('are these berries edible'));
  assert.ok(!asksToEatUnknown('how do i cook rice on a stove'));
  assert.ok(!asksToEatUnknown('my kid ate some berries'));
});

test('a pet that is hurt is the patient; a pet along for the hike is not', () => {
  assert.ok(petIsPatient('a snake struck my dog'));
  assert.ok(petIsPatient('his face is swelling', 'a snake struck my dog'));
  assert.ok(petIsPatient('my dog is limping'));
  assert.ok(!petIsPatient('my dog and i are lost'));
  assert.ok(!petIsPatient('a raccoon that was acting strange attacked my dog and then bit me on the leg'));
  assert.ok(!petIsPatient('a snake bit my dog and i got bitten too'));
  assert.ok(petIsPatient('a raccoon attacked my dog'));
  assert.ok(petIsPatient('a snake bit him again', 'my dog is limping'));
  assert.ok(!petIsPatient('my friend got stung and his face is swelling', 'a bee stung my dog'));
});

test('a named plant is not an unnamed one', () => {
  assert.ok(!asksToEatUnknown('Did people ever eat California brome, or is it just cattle feed?'));
  assert.ok(asksToEatUnknown('I found some mushrooms. Which ones can I eat?'));
  assert.ok(asksToEatUnknown('are these safe to eat'));
});

test('drowsy after a head injury is a danger sign; sleepy alone is not', () => {
  assert.ok(dangerSign(['my boy fell off a big rock and smacked his head', 'he can barely keep his eyes open']));
  assert.ok(!dangerSign(['long day, i am sleepy']));
});

test('a burn said without the word', () => {
  assert.deepEqual(ids(['my son brushed his arm on the camp stove grate']), ['burn']);
  assert.deepEqual(ids(['splashed hot coffee all over my wrist']), ['burn']);
  assert.deepEqual(ids(['my fingertips went hard and waxy on the summit push']), ['frostbite']);
});

test('the latest condition, and whether the last message said it', () => {
  assert.equal(latestCondition(['stepped right on a rattler and it tagged my calf', 'should i prop my leg up on my pack'])?.condition.id, 'snakebite');
  assert.equal(latestCondition(['stepped right on a rattler and it tagged my calf', 'should i prop my leg up on my pack'])?.inLast, false);
  assert.equal(latestCondition(['a snake struck my buddy'])?.inLast, true);
  assert.equal(latestCondition(['how do i purify water']), undefined);
});

test('any opening of a burn blister is caught, whatever it is called', () => {
  const burn = conditionsIn(['my son brushed his arm on the camp stove grate']);
  assert.equal(violatedCondition('If the bubbles are larger than a nickel, drain them with a sterile needle.', burn)?.id, 'burn');
});

test('eating something unnamed, across the thread', () => {
  assert.ok(eatingUnknownInThread('are these blue ones safe', ['my daughter wants to pick berries']));
  assert.ok(eatingUnknownInThread('she already ate a couple', ['my daughter wants to pick berries', 'are these blue ones safe']));
  assert.ok(!eatingUnknownInThread('is it safe to cross here', ['nice day for a hike']));
});

test('a dog with a tick is a pet patient', () => {
  assert.ok(petIsPatient('my dog has a tick, how do i get it off'));
});

test('specific questions a card answers in a sentence, not how-tos', () => {
  for (const m of ['can i put ice on it', 'should we run to the car', 'how long should i ice it', 'where exactly do i put the tourniquet',
    'would butter help', 'is it worth trying to draw the poison out with my mouth', 'what should i watch for after']) assert.ok(asksSpecifically(m), m);
  for (const m of ['how do i stop the bleeding', 'what should i do', 'what now', 'a snake struck my buddy', 'my ankle is swelling',
    "can't feel my fingertips and they've gone kind of waxy", "I think I'm lost. I don't know which way the trail is."]) assert.ok(!asksSpecifically(m), m);
  for (const m of ['ok so how long should i ice it', 'Which way should we go?', 'is ice ok for it']) assert.ok(asksSpecifically(m), m);
});

test('a situation with an unnamed disease risk is searched with the disease beside it (#51)', async () => {
  const { EXPOSURE_LINKS, withExposures } = await import('../src/exposures.ts');
  const ids = (m: string): string[] => EXPOSURE_LINKS.filter((l) => l.when.test(m)).map((l) => l.id);
  assert.deepEqual(ids("a raccoon bit my kid's hand"), ['rabies']);
  assert.deepEqual(ids('a skunk scratched my arm'), ['rabies']);
  assert.deepEqual(ids('we woke up and there was a bat in the tent'), ['rabies-bat']);
  assert.deepEqual(ids('the shelter has mouse droppings everywhere'), ['hantavirus']);
  assert.deepEqual(ids('dead squirrels near camp'), ['plague']);
  assert.deepEqual(ids('the lake has green scum on it'), ['algal-bloom']);
  // Small rodents almost never carry rabies (CDC); an ankle is not an exposure.
  assert.deepEqual(ids('a squirrel bit my finger'), []);
  assert.deepEqual(ids('a chipmunk bit me'), []);
  assert.equal(withExposures('i rolled my ankle'), 'i rolled my ankle');
  assert.match(withExposures('a fox nipped my ankle'), /\(rabies exposure/);
});

test('an algal bloom guards the answer: boiling or filtering that water is replaced (#51)', async () => {
  const { exposureConditions } = await import('../src/exposures.ts');
  const { violatedCondition } = await import('../src/conditions.ts');
  const watched = exposureConditions(['the lake has green scum on it, can i filter it and drink it']);
  assert.equal(watched[0]?.id, 'algal-bloom');
  assert.equal(violatedCondition('Boil the water for 1 minute, or use purification tablets.', watched)?.id, 'algal-bloom');
  assert.equal(violatedCondition('If no toxins are detected, consider filtering the water and drink it cautiously.', watched)?.id, 'algal-bloom');
  assert.equal(violatedCondition('Check for cyanotoxins in the water.', watched)?.id, 'algal-bloom');
  assert.equal(violatedCondition('No, boiling water will not remove the toxins.', watched), undefined);
  assert.equal(violatedCondition('Find another water source.', watched), undefined);
  assert.deepEqual(exposureConditions(['how do i purify stream water']), []);
});

test('a big animal attacking is a danger sign however it is said (#117)', () => {
  assert.ok(dangerSign(["a mountain lion just jumped my friend and he's bleeding"]));
  assert.ok(dangerSign(['a cougar pounced on my brother']));
  assert.ok(dangerSign(['the moose knocked her down']));
  assert.ok(!dangerSign(['we saw a moose way across the meadow']));
});

test('"a bit" is not a bite (#117)', () => {
  assert.ok(!dangerSign(['we saw a bear a bit up the trail, far off']));
});

test('a negation counts only in the clause that gives the advice (#117)', async () => {
  const { conditionsIn, violatedCondition } = await import('../src/conditions.ts');
  const snake = conditionsIn(['a snake bit my friend']);
  assert.equal(violatedCondition('Apply ice for 20 minutes at a time, but do not leave it on longer than 20 minutes.', snake)?.id, 'snakebite');
  assert.equal(violatedCondition("Don't put ice on it.", snake), undefined);
  assert.equal(violatedCondition('Do not wrap the ankle tightly with ice, as this can cause damage.', snake), undefined);
});

test('hazards that call for help now are danger signs (#115)', () => {
  for (const m of ['the wildfire is coming toward us and we can\'t outrun it', 'the water is rising around us in the canyon', 'my friend got swept away crossing the creek', 'the fire is coming toward us',
    "we're stuck on a ledge and can't climb up or down", 'trapped by the flood']) assert.ok(dangerSign([m]), m);
  for (const m of ['how do we make sure our campfire is really out', 'the creek is high today', 'we want to hike the ledge trail']) assert.ok(!dangerSign([m]), m);
});

test('the emergency rule echoed back is a dead end, not an answer (#115)', async () => {
  const { isRefusal } = await import('../src/prompt.ts');
  assert.ok(isRefusal('If life is at risk, say to contact emergency services first.'));
  assert.ok(isRefusal("I don't have reliable information on that."));
  assert.ok(!isRefusal('If life is at risk, call for help, then start CPR.'));
});

test('a lightning strike guards against "don\'t touch them" (#115)', async () => {
  const { exposureConditions } = await import('../src/exposures.ts');
  const { violatedCondition } = await import('../src/conditions.ts');
  const watched = exposureConditions(['lightning hit right near us and my friend is on the ground not breathing']);
  assert.equal(watched[0]?.id, 'lightning-strike');
  assert.equal(violatedCondition('Do not attempt to rescue the friend unless instructed by a professional.', watched)?.id, 'lightning-strike');
  assert.equal(violatedCondition("Don't touch him until help arrives.", watched)?.id, 'lightning-strike');
  assert.equal(violatedCondition('Check his breathing and start CPR.', watched), undefined);
});

test('stuck on a ledge is recognised however it is said (#128)', async () => {
  const { stuckOnTerrain } = await import('../src/triage.ts');
  assert.ok(stuckOnTerrain(["we're stuck on a ledge and can't climb up or down"]));
  assert.ok(stuckOnTerrain(['i think we cliffed out']));
  assert.ok(!stuckOnTerrain(['we want to hike the ledge trail']));
});

test('fire or smoke coming at the hiker is a danger sign, however it is said (#130)', async () => {
  const { dangerSign } = await import('../src/triage.ts');
  for (const m of ["there's smoke and fire coming up the ridge toward us", 'the fire is heading our way', 'smoke is getting closer to camp', 'flames spreading toward the trail we are on']) assert.ok(dangerSign([m]), m);
  for (const m of ['how do i get my campfire going', 'is the smoke from the fires bad for hiking', 'we put the fire out and are heading to bed']) assert.ok(!dangerSign([m]), m);
});

test('saying something is missing marks a follow-up as a question, plain news does not (#138)', async () => {
  const { SAYS_MISSING: re } = await import('../src/pipeline.ts');
  for (const m of ["There's no manual", "we don't have a filter", 'forgot the poles', 'without a lighter', 'no instructions', "it didn't come with stakes"]) assert.ok(re.test(m), m);
  for (const m of ['ok we made it back', "ok it's off", 'ok the hives are fading', 'phone at 15%', 'ok found the trail thank god', 'ok made camp', 'no worries', 'no idea']) assert.ok(!re.test(m), m);
});

test('follow-ups: news about an open problem, acknowledgements, and what points back (#140)', async () => {
  const { ACKNOWLEDGES } = await import('../src/pipeline.ts');
  const { leansBack } = await import('../src/understand.ts');
  const { dangerSign, eatingUnknownInThread } = await import('../src/triage.ts');
  const { saysResolved } = await import('../src/record.ts');
  for (const m of ["ok it's off", 'ok made camp', 'thanks', 'got it, will do']) assert.ok(ACKNOWLEDGES.test(m), m);
  for (const m of ['a few bubbles came up on the skin', 'yep its a bear', 'someone said toothpaste helps']) assert.ok(!ACKNOWLEDGES.test(m), m);
  assert.ok(leansBack('yep its a bear, a big one near the food bags'));
  assert.ok(leansBack('its swelling pretty bad now on the outside'));
  assert.ok(dangerSign(["there's something big snuffling outside", 'yep its a bear']));
  assert.ok(eatingUnknownInThread('my kid already tried one', ['lots of berries along this trail', 'the purple ones look good', 'are those safe']));
  assert.ok(saysResolved('morning now, feeling ok'));
});

test('nothing but thanks is small talk; thanks with a question is not (#142)', async () => {
  const { ONLY_ACKNOWLEDGES } = await import('../src/pipeline.ts');
  for (const m of ['ok thanks', 'got it, will do', 'cool!', 'thank you so much', 'ok']) assert.ok(ONLY_ACKNOWLEDGES.test(m), m);
  for (const m of ["ok it's off", 'thanks, how long should i keep it cool', 'ok made camp', 'ok now what']) assert.ok(!ONLY_ACKNOWLEDGES.test(m), m);
});

test('"soaked through" is a danger sign for blood, not for wet gear (#145)', async () => {
  const { dangerSign } = await import('../src/triage.ts');
  for (const m of ["i'm pressing but it's soaking through", 'im pressing on it but its soaking through the shirt', "the shirt i'm holding on it is soaked through",
    'the bandage on her arm is soaking through', 'The bandage is soaked through now. What do I do?', 'blood soaked through my pants leg']) {
    assert.ok(dangerSign([m]), m);
    assert.deepEqual(ids([m]), ['bleeding'], m);
  }
  for (const m of ['my boots are soaked through, how do i dry them by morning', 'we got caught in the rain and everything is soaked through',
    'my jacket soaked through in about ten minutes', 'the tent floor is soaking through']) {
    assert.ok(!dangerSign([m]), m);
    assert.deepEqual(ids([m]), [], m);
  }
});

test('a danger sign stands until the hiker says it is over; an open snakebite stands anyway (#173)', () => {
  assert.ok(dangerStands(['a snake struck my buddy', 'its on his ankle'], conditionsIn(['a snake struck my buddy'])));
  assert.ok(!dangerStands(['a snake struck my buddy', 'ok the rangers carried him out', 'now ive got a blister on my heel'], []));
  assert.ok(dangerStands(['he gashed his thigh', 'we carried him out to the road but its still soaking through the shirt'], []));
  // Someone else's ankle feeling fine does not close the friend's snakebite, which the record keeps open.
  assert.ok(dangerStands(['a snake struck my buddy', 'my own ankle feels fine now', 'his arm is going numb'], conditionsIn(['a snake struck my buddy'])));
});
