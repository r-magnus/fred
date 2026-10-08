# Which card is this message about? A matcher trained on examples: results

2026-10-07. Tickets #152, #93, #145. Runs, grades and the list of changed
replies: `said-as/`.

**Short version: when a message scores low in the search, which field card
comes first is close to chance, and the rules that open a card for an
emergency opened the wrong one (the shock card for a seizure, the sprain card
for a scraped shin). A small trained matcher now reads the message's search
vector and says which card it is about, or that it is a pet's, a medicine
question or something no card is for. Across 847 replies in 19 sets, 31
change: about 20 clearly better, 1 slightly worse, none unsafe. On 48 fresh
messages written before the fix ran on them, replies with the right kind and
the right card go from 21 to 31, none worse. It fixes the class it targets
but is often not sure enough to act; 17 of the 48 are still wrong.**

## What was wrong

| Message | What Fred did | Cause |
|---|---|---|
| my friend just collapsed and is jerking all over (#93) | shock card (0.174; seizure 0.125) | the card that leads a weak search is opened for an emergency |
| my daughter went down on the gravel and her shin is all torn up | sprain card (0.118) | same |
| my friend tripped and landed on her wrist | shock card | same |
| we need to drink from this stream | river-crossing card | same |
| our lab tore a pad on the lava rock / its bleeding a fair bit | human bleeding card | the pet rule is a word list ("dog", "cat"...) |
| how many naproxen is too many | back-injury card | the medicine rule is a word list |
| how should i dress for a cold hike (#145) | "cotton or linen" | routed to first aid by "cold" and "freezing"; the tips page on cold-weather clothing (0.479) was never searched, and the routed search cleared the gate at 0.301 with a survival-manual passage that opens on hot-weather clothing |
| my boots are soaked through, how do i dry them (#145) | read as a danger sign, bleeding card given to the model | "soaked through" meant blood through a dressing |

"i'm nervous about crossing the river tomorrow" (#145) was already fixed on
the desktop by the scope scorer (#149).

## What changed

1. **The matcher** (`packages/rag-core/src/said-as.ts`). One row of weights
   per label over the search vector the message already has: no model call,
   55 KB shipped in the app. Labels are the 43 cards and eight kinds of
   message no card is for (pet, medicine or procedure, small ailment, gear,
   weather and wildlife, small talk, out of scope, a follow-up fragment).
   Trained (`tools/eval/src/train-said-as.ts`) on 1,034 example messages in
   `corpora/cards/said-as.tsv`: 544 written for it, 490 the scope scorer's
   training messages given a label. The run fails on a near copy of any eval
   message.
   - Nearest-example matching was tried first and rejected: 69% right on
     examples left out, and at any threshold a quarter of its card calls
     were wrong. The trained matcher: 80% (825 of 1,034).
   - Two thresholds, set from examples the model never saw, by no test set:
     **sure 0.71** (220 of 226 card calls right) and **leans 0.45** (370 of
     406).
2. **What it may do.** It never decides whether Fred answers.
   - A card opened under the gate (because it led the message's own search,
     or a trigger phrase named it) is swapped for the card the matcher is
     sure of, or leans to with at least twice the share; and dropped when
     the matcher is sure the message is something no card is for, or gives
     the card under 0.05. Never dropped on an unsure call when the
     conversation has a danger sign, or for a follow-up fragment.
   - Where the scope scorer already gives a second chance, the card the
     matcher is sure of opens first.
   - A pet or a medicine question is known by the word list or the matcher,
     and a pet carries to the next message ("its oozing blood").
3. **Everyday questions search the tips packs too** when routing left them
   out, kept when a tip leads by 0.05 over the routed search. Not for an
   emergency.
4. **"Soaked through" is a danger sign only for blood**: not when the
   message is about gear or weather and names no blood or wound.
5. The medicine word list gained common names and the shape "how many X is
   too many".

## Results

Decision sweep of every set, today's main against this branch (California,
intent on, scope scorer on, `~/fred-packs-g-all`), every changed reply read.
`said-as/changed-decisions.txt`.

**31 of 847 replies change. The held-out set: none of 40, so A-KR2 stays
73.8%.**

Better, the right card for the wrong one: seizure (was shock), scraped shin
(sprain), wrist (shock), drinking from a stream (river crossing), white waxy
toes (trench foot), a friend who fell in the lake and "do i massage his arms
and legs" (shock, frostbite), "no idea where the trail went" (finding north).
A card where there was "Got it", a decline or the watch reply: three burns,
two lost-trail statements, "haven't peed all day and my head is pounding".
The naproxen question is declined.

Nine replies change through the tips search, answers generated and read
(`said-as/everyday-runs-{off,on}.jsonl`): four better (cold-hike clothing now
"avoid cotton"; feeding deer and keeping bugs off answered instead of
declined; water for a day hike), four level, one slightly worse (a heel
blister loses "don't puncture a small one"). None unsafe; boiling water up
high still says three minutes.

Two replies got worse on the first sweep and were fixed by rule: the CPR
card for "can't tell if he's breathing" (the unresponsive card starts with
checking), and a burn follow-up that lost its card.

## On messages nobody had run (2026-10-07)

`holdout-chats-4.json` (33 chats, 38 messages) was committed before the
matcher ran on any of them. A message counts when the kind of reply fits and
no wrong card is shown.

| | Before | After |
|---|---:|---:|
| Set 4, first run (38) | 18 | **25** |
| Set 5 (10) | 3 | **6** |

None worse in either. Fixed: a seizure, a scraped elbow, a pointer and a
border collie taken as pets (with the follow-up), wet gear no longer given
the bleeding card, a talus fall, a slipped knife, a hand on the grill.

The first run of set 4 showed a gap: cards opened by trigger phrases skipped
the matcher, and the fall rule read "slid off the stove", "slipped on the
boardwalk" and "fell over" as falls (neck-and-back card, three messages).
Those cards now go through the same check. Set 4 re-run: 27 of 38, but that
is not clean evidence, so `holdout-chats-5.json` (real falls, and fall words
where something else happened) was committed before that change ran on it.

**Still wrong (17 of 48):** the matcher right but not sure enough (a hatchet
cut 0.50, hot coffee 0.20, soup 0.44, a seizure said as "shuddering", an
unresponsive wife 0.34, yellowjackets 0.11); a card above the gate, where
the matcher has no say (pale toes get trench foot at 0.363, chest tightness
on a climb gets altitude); a stiff neck from a pack and one pair of wet
socks get a card; a mare is not taken as a pet; "the dog pulled and i fell
in the creek" is declined because of the word "dog"; "can i take three
aleve" is answered by the model after the understanding step.

## On the phone (2026-10-07)

Nothing Phone (3), field-test build of this branch, the 12 packs unchanged.
Twelve chats with the matcher on, five again with it off
(`said-as/phone-chats-{on,off}.txt`). Every reply is the kind the desktop
gave.

| Message | Matcher off | Matcher on |
|---|---|---|
| my friend just collapsed and is jerking all over | shock card, 3.8 s | **seizure card**, 3.6 s |
| ...her shin is all torn up | sprain card, 5.5 s | **cuts card**, 5.7 s |
| our pointer ran through barbed wire... / its oozing blood | watch reply, then the soaked-bandage card | **declined as a pet's**, both |
| grabbed the hot skillet handle and my palm is red / how long... | watch reply, twice | **burns card**, twice |
| my back is wrecked from the pack / how many naproxen is too many | spine card, then declined | the same (the word list now knows naproxen) |

With it on only: the wrist gets the broken-bone card (6.1 s), "we need to
drink from this stream" the water card (4.4 s), hot water over a wrist the
burns card (3.7 s); the lunch-by-the-creek remark stays small talk. #145:
the cold-hike answer says "Avoid cotton clothing" (written from the tips
pages, 14.9 s, first words 2.6 s); soaked boots get drying advice, not an
emergency (12.4 s); the nervous hiker gets river-crossing steps (15.9 s).
The matcher adds no measurable time: card replies took 3.6-6.4 s with it on
and 3.4-5.5 s with it off.

## Open

- "my back is wrecked from the pack" still gets the neck-and-back card.

- More examples per card is the lever for confidence: most cards have 8-15.
- The survival manual's cold-injuries passage still opens with the
  hot-weather clothing sentence (a chunk that straddles two sections).
- Cards above the gate are not checked by the matcher.
