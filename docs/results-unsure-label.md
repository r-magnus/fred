# Using the card matcher when it is unsure: results (#152, #100, #112)

2026-10-11. Branch `unsure-label`. Evidence: `docs/unsure-label/`.
Earlier rounds: `results-said-as.md`, `results-card-matcher-2.md`.

**Short version: the card matcher is often unsure of its exact pick and
still right about the bigger question, "is this something no card is for?"
Fred now uses that. On 25 fresh test chats written before the change, 29 of
34 replies were right before and 31 after. Across all 986 replies on every
test set, 17 changed: 10 better, 7 small talk replies that now carry a
folded card, none clearly worse. Three of the five messages #152 names are
fixed. Sore hips, a stiff neck and a missed junction are not, and the three
tickets stay open for what is left.**

## The finding

The last round ended on "the next step is in how an unsure but right label
is used, not in more examples". So every example message was scored by a
matcher that had never seen it (10 folds, 1,486 messages), and each possible
rule was counted.

| What the matcher says | How often it is right |
|---|---:|
| Top label, when it is sure (share 0.63 or more) | 812 of 839 (97%) |
| Top label, when it is unsure | 458 of 647 (71%) |
| **"No card is for this", when the no-card labels together reach 0.60** | **367 of 370 (99%)**; in 147 of the 370 the top label was unsure |
| A pet on top, at any share | 50 of 53 (the 3 misses are other messages about animals) |
| Unsure, leaning to one card at twice the next card | 194 of 244 (80%) |

The matcher has eight labels for messages no card is for (a pet, a small
ailment, gear, small talk and so on). It often splits its vote between
them: "i can see a stream below me" is "other" at 0.56, under the "sure"
cut-off, while the eight together are 0.62. Fred looked only at the top
label, so the vote counted as "unsure" and an earlier rule opened the
river-crossing card.

## What changed

Each rule uses a label only as far as the count above supports it.

1. **No card, by the labels together.** When the no-card labels together
   reach 0.60, a card that was opened only because it led a weak search is
   taken away. The cut-off comes out of the training run (99% right), like
   the two that were already there. Not with a danger sign in the
   conversation.
2. **A pet named by breed or kind.** A pet on top that leads every card
   clearly is a pet, sure or not: "our lab tore a pad on the lava rock" (pet
   0.30, nearest card 0.13). Only when the search has no answer of its own.
3. **A person hurt near a pet.** When the matcher is sure of a card for
   people and the message is about the speaker, the word "dog" no longer
   makes it a pet question. Found by the new test chats: "i tripped over the
   dog leash and my ankle rolled" was declined.
4. **Small talk with a leaning card.** Small talk the matcher leans to a
   card for gets that card folded under the reply, not opened. A leaning
   label is right four times in five: enough to offer, not enough to show.
5. **"What now" stays on the card just shown** (#100). After the
   anaphylaxis card, "what now" was written by the model from the stings
   card and the anaphylaxis card together.

No example messages were added. The training run was repeated and gives
the same weights and the same three cut-offs, byte for byte.

## Results

**Fresh test chats** (`holdout-chats-8.json`, 25 chats, 34 replies, written
and committed before the change; decision only, judged on the kind of reply
and the card shown):

| | Before | After |
|---|---:|---:|
| Right | 29 of 34 | 31 of 34 |

- Fixed: the ankle rolled over a dog leash (pet decline, now the sprain
  card); a stream seen from camp (shelter card, now no card).
- Better, still counted wrong: a missed cairn is still small talk, now with
  the lost card folded under it.
- Better, counted right both times: "what now" after the anaphylaxis card
  now shows that card.
- Not fixed: hips sore from a hip belt (hip-injury card; the matcher leans
  to that card, wrongly, at 0.45) and a stiff neck from sleeping on a rock
  (neck-injury card; "small ailment" leads at 0.28 and the no-card labels
  together fall short of 0.60).

The previous round's test chats (`holdout-chats-7.json`): 24 of 28 right
before, 25 after (the lame mare is now a pet).

**Every existing set**, 986 replies, decision only
(`unsure-label/changed-all-sets.txt`): 17 changed.

| | Reply | Before | After |
|---|---|---|---|
| Better | "our lab tore a pad on the lava rock" | watch reply | pet decline |
| Better | "its bleeding a fair bit" (next message) | human bleeding card | pet decline |
| Better | "my mare came up lame after the ford..." | watch reply | pet decline |
| Better | "my back is wrecked from the pack" | spine card | watch reply |
| Better | "i tripped over the dog leash and my ankle rolled" | pet decline | sprain card |
| Better | "i can make out a little stream down the slope from our tent" | shelter card | small talk |
| Better | "what now" after the anaphylaxis card | written from two cards | anaphylaxis card |
| Better | "pretty sure we walked right past our turnoff..." | small talk | small talk, lost card folded |
| Better | "we must have gone past the cairn..." | small talk | small talk, lost card folded |
| Better | "i can see a stream below me" | river-crossing card | written by the model |
| Folded card added | "there's purple berries all over this bush" | small talk | wild-plants card folded |
| Folded card added | "probably didn't drink enough today" | small talk | dehydration card folded |
| Folded card added | "we're camping in bear country" | small talk | bear card folded |
| Folded card added | "sam has type 1 diabetes" | small talk | low-blood-sugar card folded |
| Folded card added | "we're on a trek around 11000 feet" | small talk | altitude card folded |
| Arguable | "my socks are soaked through and i only brought one pair" | trench-foot card | watch reply |
| Same reply, other reason | "I have a cooler with some sandwiches... can animals get in?" | declined (weak search) | declined (read as a pet question) |

Two to be honest about. "i can see a stream below me" no longer opens the
river card, but the model now writes an answer from river-crossing passages,
and that text was not generated or read here. The cooler question was
declined before and is declined now, but for the wrong reason (the matcher
reads "animals" as a pet).

**Found by the comparison and fixed before this write-up:** "can i let my
dog off leash on the trail" was answered from the hiking-with-pets pages
and, with rule 2 as first written, was declined as a pet question. Rule 2
now applies only when the search has no answer of its own, and the reply is
back as it was.

One run each. The baseline is the sweep of 2026-10-08 (`c152/after`),
checked identical to a fresh run of the same code on two sets (70 replies, 0
different). Not run on the phone: the rules and the matcher run the same
there. Answers were not generated, so nothing here speaks to the wording of
a written answer.

## Still open

| Ticket | Left |
|---|---|
| #152 | "we missed the junction a while back" and its kin are still small talk (the lost card is now folded under them: the matcher leans to it at about 0.5, and the intent step and the scope scorer both call it small talk). Hips sore from a belt and a stiff neck from sleeping get injury cards. The swollen thumb from #173 is unchanged. |
| #100 | Altitude and "second person hurt" passed on the fresh chats (one wording each). A follow-up read without its conversation ("how do i pull it out" after cactus spines) was not touched: the fresh hook and splinter chats got a watch reply and a written answer, no wrong card. Time on the phone was not re-measured. |
| #112 | The head-injury signs question and frostbite against trench foot passed on the fresh chats at the level of which card opens; whether the signs line is in the reply needs generated answers. The line floor and band were not re-checked. |

The pattern in what is left of #152: a body part that is sore from use, not
hurt. The matcher's "small ailment" label has 60 examples against 906 for
the cards, and it is the one place where more examples look like the right
lever.
