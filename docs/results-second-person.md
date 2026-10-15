# A new problem after a different one: results (#100)

2026-10-14. Evidence: `second-person/`. Fresh chats: `tools/eval/data/holdout-chats-11.json`.

**Short version: when a new injury follows a different problem, Fred no
longer holds on to the first one. "and now i sliced my thumb on the can lid"
after a wasp sting gets the cut card, not an answer written from the stings
card; a cut or a burn after "it left" (a bear) gets its own card, not the
bear card. On the fresh chats 15 of 18 pass (14 before); across every set 10
replies changed, all for the better or the same, none unsafe. No card was
added or edited.**

## Why it happened

Four places kept the first problem when the message was about a new one:

1. **The joined search.** A follow-up is also searched joined to the message
   before it, and the higher score wins. "son stung by a wasp" + "sliced my
   thumb on the can lid" scored 0.294 against 0.115 alone, only from the
   sting's words.
2. **Staying on the card just shown (#101).** An update on that card ("its
   swelling pretty bad") keeps it unless it names something new, and only
   the trigger phrases counted as new. A cut has none.
3. **"It's over" blocks the matcher's card.** "it left. my wife sliced her
   hand on the hatchet": the card matcher was sure of the cut card (0.66),
   but a message saying something is over never opened one.
4. **The record closed what came after.** "ok it left. my kid just burned
   her hand on the stove" closed the latest open condition, which was the
   burn named after "it left", so the burns card was hidden.

## What changed

The card matcher now runs before the joined search. When it is sure the
message names a card other than the one the conversation is on:

- the joined search is not used (1);
- the card just shown is not kept (2);
- "it's over" refers to the earlier card, so the matcher's card can open (3).

And in the record, a message no longer closes a condition it names after
saying something is over (4); "he was bleeding badly yesterday but he is
fine now" still closes the bleeding. Fixing (4) let "is it ok to burn poison
oak in the campfire" keep a burn condition that "it ok" used to close, and
the model's answer took a line from the burns card. "to burn" and "can i
burn" no longer set the burn condition.

## Results

### Fresh chats (written before the change, `holdout-chats-11`)

Generated, 36 replies. Chats passing on the card that fits: 14 -> **15**
of 18.

| Chat | Before | After |
|---|---|---|
| bear, then "it left. my wife sliced her hand on the hatchet" | bear card | cut card |
| a sting, then "its swelling up past my wrist now" | written from the stings card and two insect passages | stings card |

Still failing, the same before and after:

- **Cut after hypothermia**: "hes in dry clothes in the bag now. i cut my
  finger open on the ice getting him out" gets the hypothermia card. The
  matcher reads the whole message as hypothermia (0.25).
- **Shin gash after heat**: "shes cooling off now but i gashed my shin on a
  branch getting her water" gets the watch reply. The matcher leans to the
  cut card at only 0.16.
- **A bleed that will not stop** gets "A bandage soaking through with
  blood", not the heavy-bleeding card the chat named. Both are for this; the
  test's choice was strict.

### Every set (decision sweep, 27 sets)

Baseline: the sweep for #100's first change (`e40c3f6`, the same code as
main), plus the fresh chats before the change.

| Chat | Message | Before | After |
|---|---|---|---|
| `c10-second-cut` | "and now i sliced my thumb on the can lid" | written from the stings card | cut card |
| `c2-bear-then-cut` | "it's gone. my partner sliced her thumb on the can lid cleaning up" | bear card | cut card |
| `sw-bear-burn` | "it left. my daughter grabbed the stove and her palm is red and hurting" | bear card | burns card |
| `ph-camp-bear` | "ok it left. my kid just burned her hand on the stove" | bear card | burns card |
| `ph-camp-bear` | "should i pop it" (the blister) | watch | burns card |
| `dg-allergy` | "my lips are swelling and my throat feels tight" (after a sting) | written from the stings card | anaphylaxis card |
| `c2-danger-wake` | "he's not waking up" (after a head injury) | head-injury card | get help now |
| `lg-lake-heat` | "ok we're up here and my friend is dizzy with a headache" | written from cold, heat and water passages | altitude card |

Plus the two fresh-chat changes above. No other outcome or card changed
(`decision-diff.txt`).

## Not done here

- **The wrist after heat** (`c10-second-sun`): "i think i rolled my wrist
  grabbing him" does not reach the sprain card even on its own. That needs
  wrist wording on the sprain card; not done, since cards are not being
  changed for now.
- **A sting after a snakebite handed over** (#203): the understanding step
  drops the sting and the answer is about the bite.
- The matcher misreads messages that say two things (the cut after
  hypothermia, the shin after heat); fixing that means retraining it.
