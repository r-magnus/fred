# Two wrong follow-up replies: results (#173)

2026-10-08. Branch `follow-up-replies`. Runs: `follow-up-replies/`.

**Short version: both replies from the ticket are fixed at the cause. "can she
still carry her pack" after a swollen wrist now gets the broken-bone card
again, not a line of the spine card. "ok the rangers carried him out" after a
snakebite now gets "I'm glad help got there", not the emergency reply. Across
all 21 existing sets (895 replies) four replies changed, all intended. The
first version of the fix changed three more that it should not have; the full
comparison caught them and they are fixed too.**

## What was wrong

1. **A fall's precaution card took over the follow-up.** "my mom slipped on
   the wet boardwalk... her wrist is swollen" records a fall, and a fall's card
   is the neck-and-back one. Fred rightly answered with the broken-bone card,
   but the next message was treated as being about the fall, so it got a line
   of the spine card ("Pack rolled clothing ... on both sides of the head").
2. **Good news was read as an emergency.** A danger sign earlier in the
   conversation (a snakebite) stood for every later message, so "ok the
   rangers carried him out" was called urgent and got the get-help-now reply.

## What changed

- A follow-up to a message that said *how* someone got hurt (a fall), and
  that Fred answered with another card, is about that card. If the written
  answer would be a decline, Fred shows that card again.
- News that help has taken over, with nothing else in the message, is small
  talk with its own reply. No model call.
- A danger sign stands until the hiker says it is over. A snakebite the
  conversation record still has open stands anyway.

## Results

Test chats written before the fix: `tools/eval/data/holdout-chats-6.json`, 14
chats, 29 turns.

| | Before | After |
|---|---:|---:|
| Test-chat replies that miss what was expected | 2 of 29 | 1 of 29 |
| Spine-card line after a wrist, knee or palm injury | 2 | 0 |
| A card, a written answer or the emergency reply once help had taken over | 5 | 0 |
| Replies changed on the 21 existing sets | | 4 of 895 |

The four changes on existing sets:

| Hiker's follow-up | Before | After |
|---|---|---|
| "can she still carry her pack" (swollen wrist) | spine card | broken-bone card |
| "ok the rangers carried him out" (snakebite) | emergency reply | "I'm glad help got there. I'm here if you need me." |
| "he can barely keep his eyes open" (hit head in a fall) | spine card | head-injury card |
| "can he just take a nap" (same chat) | spine card | head-injury card |

A real fall with back pain still gets the spine card on the follow-up ("can he
walk out if i take his pack", "should i sit her up against a tree").

Decision-only runs (`GENERATE=0`), one each; the written replies for the
fall chats were generated once (`follow-up-replies/after-written-replies.jsonl`).
Not run on the phone: the change is in rules that run the same there.

## Found by the full comparison, and fixed

The first commit changed three replies it should not have
(`follow-up-replies/changed-all-sets-second-commit.txt` is the run after the
correction).

- "should i rub them with snow" after white, numb toes moved from the
  frostbite card to the immersion-foot card. Staying on the shown card is
  right for a fall, which says how someone got hurt, and wrong for frostbite,
  which names what is wrong. The rule is now for falls only.
- "ok paramedics have him. unrelated but i sliced my finger whittling" (and
  its reworded twin) got the help-came small talk. That reply is now only for
  a message that says nothing else.
- With the spine card gone, "can she still carry her pack" got "I don't have
  reliable information on that". It now falls back to the broken-bone card.

## Open

- The one test chat still missing: "my sister slipped... her thumb is puffy
  and turning purple" gets no card (a "watch" reply), and the follow-up "is it
  ok for her to keep using her trekking poles" gets a bare "Yes, it is ok",
  written from hiking-gear pages. The same before this branch. It is a card
  the matcher does not reach, so it goes with #152.
- "ok paramedics have him. unrelated but i sliced my finger whittling" is
  answered from a first-aid manual page, not the cut card, and its twin gets
  a "watch" reply. Also the same as before, also #152.
