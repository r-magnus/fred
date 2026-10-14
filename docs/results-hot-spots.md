# Hot spots and other minor rubbing: results (#200)

2026-10-14. Evidence: `hot-spots/`. Fresh chats: `tools/eval/data/holdout-chats-9.json`.

**Short version: "my feet are covered in hot spots" no longer gets the
trench-foot card. Minor rubbing problems (hot spots, blisters, chafing, pack
straps) that the card matcher clearly calls minor are no longer treated as
emergencies, so the hiking tips are searched and Fred answers from them. On
the fresh chats 13 of 15 pass (11 before); across every set 10 replies
changed. Of the 11 generated answers checked: 6 better, 4 the same, 1 worse,
none unsafe.**

## Why it happened

An emergency (intent NOW) is searched in first aid only, so everyday tips
never answer one (#96). The intent check called hot spots NOW, the
understanding step reworded them as "what to do right now", and the search
found trench-foot passages, which talk about feet and blisters. The blister
advice was in the tips (Wikivoyage: "If you start feeling hot spots... take
care of them quickly... moleskin") and the Army survival manual ("At first
there is a red, sore area called a hotspot").

## What changed

When the card matcher's top label is "none:minor" (no card, a minor problem)
with a share of at least 0.45, there is no danger sign, and no condition is
open anywhere in the conversation, NOW is read as a question. Nothing else
changes: no new card, no model call, no new threshold for answering.

The first try had no share floor and only checked conditions about this
message. It made two replies worse: "I've had pain in my lower right belly
since yesterday. Is it appendicitis?" (minor at 0.36) lost the reply that
lists when to get help, and "it's blistering" after "my kid just burned her
hand" (0.24) lost the burns card. The 0.45 floor was set on those seen
replies: every reply the rule helped had at least 0.45 (hot spots 0.47-0.79),
the two it hurt and a cactus spine were under it. The sealed hot-spots chat in
`holdout-chats-8` (0.47) was seen in the first sweep, so it is no longer
sealed for this floor.

## Results

### Fresh chats (written before the change, `holdout-chats-9`)

| | Before | After |
|---|---:|---:|
| Chats passing | 11 of 15 | **13 of 15** |

Fixed: hot spots on both heels (the watch reply before), and hot spots after
soaked socks (the river-crossing card before). The six contrast chats keep
their cards: real trench foot, frostbite blisters, a burn blister, poison-plant
blisters, a cut foot, a sprained ankle. Still missed: "new boots chewed up my
heels, theyre raw" (watch reply, now a decline) and "the blister on my toe
tore open and the skin is hanging off" (watch reply). Both find the blister
passages just under the gate; lowering the gate was measured before and made
answers up (`results-scope-scorer.md`).

### Every other set (decision sweep against main)

10 replies changed, none between answer and help now. `hot-spots/decision-diff.txt`.

### Generated answers for the changed replies

Generated before and after, graded by Claude, who wrote the change and knew
which side was new (not blind).

| Reply | Before | After | |
|---|---|---|---|
| hot spots on both heels, ten miles left (sealed set) | watch reply | tape them, keep feet dry | better |
| starting to feel hot spots on the backs of both heels | watch reply | plasters where hot spots start, dry feet | better |
| "now my heels are getting hot spots" after soaked socks | river-crossing card | plasters, dry feet, blister plasters | better |
| blister on my heel from running down | watch reply | moleskin, drain if larger than a nickel, cover | better |
| pack straps rubbing my shoulders raw (two sets) | watch reply; a shoulder-bandage passage | take the weight on the hips, adjust the straps | better (2) |
| heel rubbed raw with a bubble; a bad blister on my heel | blister steps | blister steps | same (2) |
| rubbing spot on my little toe, do i need to stop | stop, keep it dry | the same | same |
| lower back aching from a heavy pack | watch reply | decline | same |
| my inner thighs are chafed raw from hiking | watch reply | advice for feet (dry feet, socks, plasters) | **worse** |

Two more changed from the watch reply to a decline, not generated: "downhill
is killing my knees", "my lips are sunburned and cracking". The watch reply
listed emergency signs that did not fit either.

## Still open

- Chafed thighs: the sources have nothing on chafing, and the model wrote foot
  advice from the blister tips. The check that the passages cover the question
  let it through.
- Raw heels and a torn blister, above.
- Not checked on the phone. The rule adds no model call; a question is
  searched in the tips packs as well, as every question already is.
