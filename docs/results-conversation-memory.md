# Conversation memory, responsiveness and accuracy over long chats: results (#101)

2026-09-30. Plan: `plan-conversation-memory.md`. Runs and blind grades:
`conversation-memory/`.

**Short version: Fred now keeps a small record of the conversation (who is
hurt, what happened and whether it is over, the setting, the card it just
showed) and uses it to answer updates and follow-ups instead of saying "Got
it" or "I don't have reliable information". On new long chats (10-18
messages) the share of turns Fred gets right rises from 66% to 82% on the
sealed set (83% on the final code) and from 73% to 82% on a confirmation set nothing was tuned on,
with no unsafe answer left on either. On the phone, deciding what to do takes
2.3 s instead of 3.8 s, and the first words of a reply come at 3.6 s instead
of 4.4 s (median), while 21 of 35 replies are answers instead of 14.**

## What was built

- **The record** (`record.ts`), rebuilt from the hiker's messages on every
  turn by fixed rules, no model call:
  - **Who:** each condition belongs to whoever the message that set it is
    about ("my wife", "my buddy", the hiker). A friend's snakebite no longer
    holds back the sprain card for the hiker's own ankle; the hiker's burn is
    not carried to a wife's cut.
  - **Over or not:** "he seems better now", "the rangers carried him out",
    "found the trail", "it's fine now" close a condition; a body part being
    fine ("he says his neck is fine") does not.
  - **Facts and settings that explain a symptom:** altitude ("10500 ft" ...
    "headache"), heat ("105 out" ... "dizzy"), a diabetic ("he's diabetic" ...
    "shaky, sweaty, not making sense"). Their card leads over a card that only
    shares the symptom's words.
  - **New conditions:** being lost, heavy bleeding (the check catches "remove
    the tourniquet"), and frostbite said as "pale" or "can't feel my fingers"
    (the check catches "warm them by the fire").
  - **What Fred just showed:** the app passes the card of its last reply; a
    follow-up with nothing of its own ("what do i do", "should i take her
    ring off", "its swelling pretty bad") stays on it.
- **Statements are answered:** a message stating an injury or symptom ("he's
  sweating a ton", "his wrist looks bent", "i'm pressing but it's soaking
  through") opens the card its search leads with instead of "Got it"; plain
  acknowledgements ("thanks", "ok good to know") still get "Got it".
- **Limits on carrying context:** a follow-up gets a condition's card only
  when it names the body, the wound or the care, never for a medicine or a
  procedure ("what blood type can I give them"), and being lost is not a body
  condition. The seizure card does not follow cold exposure (shaking is
  shivering).
- **Speed on the phone:** the intent check and the understanding step run in
  small contexts of their own (`GenerateOptions.lane`), so their fixed prompts
  stay read between messages; model-written answers inside a condition stream
  unless a forbidden-advice check needs the whole text.
- `ask-phone.sh` stops the app before filling its inbox (it lost the first
  question of a run twice).

## Results

Final graded runs on b28839c; the last commit (1953ef8: a situation is not what a body question is about; a message's own condition card goes in the model's context) was checked decision-only against them (one long-chat decision moves, the conversation set matches round 2 but for the shelter card). Same packs as the phone, `INTENT=1`, answers generated, graded blind (A/B
shuffled, key opened after grading; replies identical to one already graded
carry its grade). Before = round 2 (#98, a4455cd), run from a worktree.

### Long chats (graded per turn; worst turn per chat)

| | Sealed (12 chats, 133 graded turns) | Confirmation (8 chats, 33) |
|---|---|---|
| Turns right | 66% → **83%** | 73% → **82%** |
| Turns that should be answered, answered well | 19 → **34** of 48 | 8 → **10** of 14 |
| Chats with an unsafe answer | 4 → **0** | 1 → **0** |
| Chats right on every turn | 0 → 1 | 2 → 3 |
| Chats broken | 0 | 0 |

Identical with and without a state. Whole chats rarely pass: one wrong turn
in 10-18 fails the chat, so turns are the useful measure here.

**How the sets were used:** the sealed set was graded once on the first
record code (turns 66% → 73%), and prompted the second round of fixes (facts
that explain symptoms, statements answered, the tourniquet and fire checks,
other people's cards, eating across the thread). The confirmation set was
written and committed before those fixes ran on anything sealed; it is the
clean measure. A last fix (medicine follow-ups, lost not a body condition)
came from the conversation tuning set.

The four unsafe answers round 2 gave on the sealed set, all gone:
- "my wife just cut her finger opening a can" and "how do i clean it out"
  after the hiker's burn: the burns card (twice);
- "cant feel my fingertips and theyre pale" / "can i warm them by the fire":
  "Yes, you can warm yourself by the fire";
- "my dog has a tick": the human tick card;
- "ok it stopped" after a tourniquet: "remove the tourniquet immediately".

### Everything else (decision only, California; against round 2)

| Set | Changed | What changed |
|---|---|---|
| Tuning (104) | 0 | |
| Held-out (40) | 0 | |
| Breadth (57) | 2 | a burned palm and "I think I'm lost" open their cards instead of a decline or "Got it" |
| Colloquial (36) | 1 | "sliced my thumb whittling a stick" opens the cuts card |
| Everyday (40) | 1 | "my feet are always soaked and wrinkly" opens the immersion-foot card |
| Conversations (53) | 1 | "all I've got is a tarp and some cord, and it's getting dark and cold" opens the shelter card |
| Round 1's sealed set (45) | 1 | "i can't find the trail anymore" opens the lost card |

No out-of-scope question is answered that round 2 declined. Two regressions
seen on the conversation set along the way (the lost card for a heel blister;
the bleeding card for "what blood type can I give them") were fixed by the
last two commits.

### On the phone

Nothing Phone (3), three long practice chats (35 messages), round 2's app
against this one, same messages:

| Median | Round 2 | #101 |
|---|---:|---:|
| Deciding what to do | 3.8 s | **2.3 s** |
| Model calls in that | 2.5 s | **0.8 s** |
| Turning text into vectors | 0.7 s | 1.4 s |
| First words of any reply | 4.4 s | **3.6 s** |
| First words of a model-written answer | 17.5 s | 14.4 s |
| Replies that are answers | 14 of 35 | **21 of 35** |

The slowest reply rose (20.5 s to 27.7 s): a model-written answer held back
while "lost" was active. Fixed after the measurement (answers stream unless a
forbidden-advice check needs the whole text); not re-timed on the phone.

## Still open

- **Model-written answers are still slow** (14 s to first words). The
  passages are most of the prompt; fewer or shorter passages trade accuracy and
  need their own measurement.
- **Embedding time doubled** (0.7 → 1.4 s median): the thread and own-words
  searches run more often. The phone also creates a fresh embedding context
  per text (a llama.rn workaround); a library update may remove that cost.
- From the long chats: "how long can it stay on" (a tourniquet) gets the
  soaked-dressing card; "should we raise his legs" after an axe wound gets the
  bleeding card, not shock; a wife's cut after the hiker's burn now gets the
  watch reply instead of the cut card; "what kind of tent should i buy" is
  answered (out of scope, as in round 2).
- #100's hazards (lightning, a ledge) and bear-country food storage are
  unchanged.

## Grader caveat

One grader, Claude, who wrote the change, blind to which reply was which.
