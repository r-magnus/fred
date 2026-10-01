# Plan: understand the conversation, not just the message

2026-09-29. Ticket #98. Builds on #96 (tips-pack), which it branches from.

## The problem

Fred declines too often in real use, and it reads each message alone.

- "i'm lost and scared", then "help": the second message is searched as the
  single word "help" and declined. Memory exists (`plan-memory.md`) but only
  after a question Fred *answered*, so a chain that starts with distress has no
  memory at all.
- "uhh dude there's a bear in front of me" is an emergency in casual words.
  The words don't match manual language, so the search comes back weak.
- Six everyday questions phrased as statements ("my feet are always soaked by
  the end of the day") are read as small talk (`results-tips.md`).
- When Fred declines, it says "I don't have reliable information on that" and
  stops. For someone in trouble that is a dead end.

## What went wrong last time

Phase 3 step 4 (`results-phase3.md`) restated every weak question in manual
wording and searched again. It recovered about 9 answerable questions and let
**14 out-of-scope questions through** (stitching a cut, a dog's paw, snare
permits, belay knots): the model makes anything sound like a manual. No score
bar separated them. Two things made it unsafe, and this plan changes both:

1. It ran on **every** weak question, including the out-of-scope ones.
2. It trusted the restated text's score alone.

## The design

### 1. Search first, understand only when needed

The message is searched as typed, as today. The understanding step runs only
when one of these holds:

- **The message leans on the conversation:** there are earlier messages from
  the last few minutes and the message searched alone is under the gate
  ("help", "what now", "and if that doesn't work?", "he's not moving").
- **An emergency came up empty:** the intent check says NOW and the search is
  under the gate ("uhh dude there's a bear in front of me").

A weak standalone *question* with no conversation does not trigger it. That is
where phase 3's false admits came from, and it stays declined (with the better
decline in step 4).

**Cost:** nothing when it doesn't run. When it does, it *replaces* the intent
check: one short model call returns both the intent and the search request, so
the extra time is only the ~15-25 tokens of the request (target: at most 2.5 s
extra on the phone, and only on messages that would otherwise be declined).

### 2. One call: intent plus a search request

The model sees the last few user messages (up to 3, oldest first) and writes
one line, for example:

    NOW | lost in the backcountry, frightened, what to do
    NOW | large bear close by, what to do right now
    OUT | pet dog ate chocolate

The first word is the intent (NOW, QUESTION, PREVENT, CHAT, or OUT for
something outside hiking first aid and survival). The rest is searched. The
request is **only used to search**: the model that writes the answer still sees
the hiker's own messages and the manual passages, never the rewrite.

### 3. The request's result has to relate to what was actually said

A passage found through the request is kept only if both hold:

- it clears the normal gate (0.29) for the request, and
- scored against the hiker's own messages (joined), it clears a lower floor
  (calibrated on the tuning sets only, expected near 0.20).

The second check is what phase 3 lacked. "My dog cut his paw" rewritten as
"deep cut on the foot, stop bleeding" finds the bleeding card, but the card
scored against "my dog cut his paw" should fall under the floor; if it doesn't,
OUT from the model is the second line of defence. Both are measured on the
out-of-scope questions of every set, and the floor is set on tuning sets only.

### 4. No dead ends for someone in trouble

When the intent is NOW (or the messages show distress) and nothing clears the
gate even after step 3, Fred does not say "I don't have reliable information".
It shows a fixed, reviewed reply:

- a short lead ("I couldn't find that exact situation in my manuals."),
- the field card for being in trouble: call 911 or use an SOS device if you
  can, then the survival manual's steps for staying calm and sizing up the
  situation, written as a card and self-reviewed like every card
  (`cards-self-review`),
- one question back ("Is anyone hurt?") so the conversation keeps going.

Nothing in it is model-written, so it cannot invent advice.

### 5. Memory keeps unanswered turns

The app passes the last few user messages whether or not Fred answered them.
The existing joined-search rule for follow-ups (`plan-memory.md`) is
unchanged; the understanding step is what uses the longer history.

## The test, written first

`tools/eval/data/holdout-understand.json`, committed **before any code**, about
45 conversations of 1 to 3 messages:

- distress chains ("i'm lost and scared" / "help"; "my friend fell" / "he's
  not moving" / "what do i do"),
- casual or slang emergencies in one message,
- vague follow-ups after an answered question,
- **traps in the same styles** that must still be declined: out-of-scope
  emergencies (a pet, a car), "help" with nothing before it, distress that
  isn't about the outdoors, switches to an off-topic subject mid-chain.

Each has an expected outcome and, where it should be answered, key points and
red flags for blind grading.

## Measure, then decide

Before = this branch at `367e367`; after = with the layer. Both run with **no
state and with California** (`STATE=CA`), because the phone has a state.

- Every existing set (tuning, held-out, breadth, colloquial, everyday) and the
  conversation sets (follow-up, switch, oos, held-out conversations).
- The new sealed set.
- Answers that change are graded blind (A/B shuffled), four-part rubric.

**Ships only if:**

1. no new unsafe answer anywhere,
2. out-of-scope questions answered does not rise on any set,
3. answered-when-it-should rises on the new set and does not fall elsewhere,
4. messages that don't trigger the layer take the same time, and those that do
   add at most 2.5 s on the phone.

If a rule fails, find the cause and fix it; if it can't be fixed, the part that
fails doesn't ship and the result is written up.

## Order

1. Sealed test set, committed.
2. Understanding step (desktop), triggers, cross-check, `UNDERSTAND=0` switch.
3. Safety-net card and reply.
4. App: pass history; render the safety net.
5. Measure (above), write up in `results-understand.md` and `METRICS.md`.
6. Phone check with a few chains.
