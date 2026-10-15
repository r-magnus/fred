# A follow-up read without its conversation: results (#100)

2026-10-14. Evidence: `bare-follow-up/`. Fresh chats: `tools/eval/data/holdout-chats-10.json`.

**Short version: "how do i pull it out" after a cholla cactus is stuck in
the hand no longer gets the tick card. Across every set exactly one reply
changed, that one, from the tick card to the watch reply. The 18 fresh chats
came out the same before and after: the eight that must keep their card still
do, but none of the look-alikes (splinter, fishhook, bug in the ear, leech,
dropped glasses, cactus on the arm) showed the bug before the change, so they
show no harm, not that the fix reaches further than the cactus.**

## Why it happened

"can i touch a cholla cactus" / "dang its stuck in my hand now" / "how do i
pull it out": the last message only points back. Its own words found the
tick-removal card (0.197, under the answer threshold), and as a NOW message
the top card was opened anyway. The understanding step had restated it
correctly ("cholla cactus stuck in hand, how to remove it"), and that request
found nothing that strong (0.073), so Fred showed the tick card, rash advice
and all.

## What changed

A NOW message that leans back on the conversation (`leansBack`), with no
card shown just before, no condition set by this message and the
understanding not used, leaves its top card closed when the card is under the
threshold and the restated request does not lead with the same card. Nothing
is offered instead: the reply falls through to the usual watch reply.
Diagnostics record the card left closed (`understood.cardLeftClosed`). No
new threshold, no model call.

## Results

### Fresh chats (written before the change, `holdout-chats-10`)

Generated, 37 replies: 0 changed, misses 1 -> 1. The miss is
`c10-second-sun#2` ("ok hes resting in the shade. but i think i rolled my
wrist grabbing him" gets a chat reply), the second-person item of #100,
missed the same way before the change.

Three turns echoed the stings card's phrasing "how do I get a stinger out"
and failed the leak test; they were reworded before either run, as in #98 and
#152 (`d7e1ef9`).

### Every set (decision sweep, 26 sets)

Baseline: the #200 sweep (`520c98e`, the same pipeline code as main), plus
`holdout-chats-9` and `-10` run at main. One reply changed:

| Chat | Turn | Before | After |
|---|---|---|---|
| `nu-cholla'` | "how do i pull it out" | tick-removal card | watch |

No other outcome, card or reply text changed (`decision-diff.txt`). No new
unsafe answer.

## Still open on #100

Hazards as danger signs, keeping the card just shown, altitude as a
condition, bear-country food storage, a second person hurt after a
condition, and phone timing.
