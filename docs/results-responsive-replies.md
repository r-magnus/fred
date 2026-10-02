# Replies that answer the message: results (#109)

2026-10-02. Plan: `plan-responsive-replies.md`. Grades, packets and phone
logs: `responsive-replies/`.

**Short version: when a hiker asks something specific about the card Fred is
on ("can i put ice on it", "should i take my boot off", "how warm should the
water be"), Fred now shows the card's one-line summary and the one or two
card lines that answer it, word for word, with the whole card folded beneath.
On the sealed chats, 6 replies got better and none worse (9.0 → 12.5 of 13
changed replies), with no unsafe reply. On the phone, follow-ups that were written
from the manuals show in 1.7-2.1 s instead of 12.4-13.9 s.**

## What was built

- **Card lines matched by the search model.** Each field card's lines (its
  steps, then its don'ts, get-help line and notes) have a vector of their own,
  built into the card pack (`core-fieldcards` 0.7.0, manifest `cardLines`;
  the card search vectors are byte-for-byte those of 0.6.0). A specific
  question is compared with them; the best line counts if its similarity is at
  least 0.37, and the next one too if it is within 0.08 of the best. Nothing
  is written by the generator, and no model call is made; the question's
  vector is usually the one the search already made.
- **When it applies:** a message that asks something specific (yes/no; how
  long, how much, where, which; "what should I watch for"), when Fred would
  show a card, or as a follow-up about the card the conversation is on (its
  condition, or the card just shown). How-to questions, first reports and
  statements ("can't feel my fingertips", "I don't know which way the trail
  is") keep the whole card. No line close enough: as before (the card, or a
  model-written answer from the manuals for a follow-up).
- **The summary leads.** Lines alone missed the point a card opens with
  ("rest" for a sprain; "only eat what you can positively identify").
- **Off switch for the eval:** `LEAD=0`.

### Two designs that failed first

1. **A short model-written answer from the card** ("Yes, ...", "No, ...") on
   seen chats inverted the card: "No. Do not take off her ring" (a sting on a
   swelling hand); "Yes, she can walk on it" against the sprain card's "rest";
   "Yes, keep going" where the lost card says stop and take stock. The same
   failure as card-only rewriting in `results-phase3.md`.
2. **The model picking line numbers** answered "none" for every yes/no
   question a "Don't" line answers ("can i put ice on it" beside "Don't put
   ice on it"; rub, twist, whiskey, run), even when told that a "Don't" line
   counts; when it did pick, it was often the wrong line ("should i take my
   boot off": the ice line).

The search model, asked the same thing, put the answering line first or
second for 13 of 15 seen questions, and the two it missed scored under the
floor.

## Results

Same packs as the phone, `INTENT=1`, California. Graded blind: before and
after shuffled as A and B, the key opened after grading. One grader, Claude,
who wrote the change.

### Sealed card-question chats (20 chats, written before any code)

| | Before | After |
|---|---:|---:|
| Score, the 13 replies that changed | 9.0 | **12.5** |
| Better / worse | | **6 / 0** |
| Unsafe | 0 | 0 |
| Last turns written from the manuals (slow) | 11 of 20 | **3 of 20** |

Fixed: "should i take my boot off" (before, a written answer said to remove
it if it hurts, against the card); "can i put ice on it", "how warm should the
water be", "can he have some whiskey", "how long should i ice it", "should he
chug a bunch of water" (before, the whole card or a written answer with the
point buried).

### Every other set (decision sweep, then the changed replies graded)

Tuning, held-out, breadth, colloquial, everyday, the chat sets (sealed,
long, seen), and the two-message conversation sets. 18 replies changed
outside the seen chats:

| | Before | After |
|---|---:|---:|
| Score, 18 changed replies | 14.5 | **16.0** |
| Better / worse | | **4 / 1** |
| Unsafe | 0 | 0 |

Better: "should we raise his legs up" after a fall (now "Keep them flat on
their back"), "can i put ice on it" and "is ice ok for it" after a burn ("Don't
use ice or ice water"), "do i massage his arms and legs". Worse: "My friend hit
their head on a rock and seems confused. What should I watch for?" now gets the
emergency signs but not the card's list of concussion signs, which the whole
card shows. No question changed outcome (answer, decline, help now).

The sweep also found two statements read as questions ("can't feel my
fingertips and they've gone kind of waxy"; "I think I'm lost. I don't know
which way the trail is."); the question rule was fixed before grading, and
both get the whole card again.

### On the phone

Nothing Phone (3), six sealed chats, the app before and after, same messages:

| | Before | After |
|---|---:|---:|
| First message, first words (median) | 4.3 s | 4.4 s |
| Follow-ups written from the manuals before (5) | 12.4-13.9 s | **1.7-2.1 s** |
| Follow-up shown as the whole card before (1) | 2.8 s | 7.8 s |
| Turning text into vectors, follow-ups (median) | 1.3 s | 1.5 s |

The 7.8 s is "how warm should the water be" after frostbite (now the card's
summary and its 99-109°F line, before the whole card): turning text into
vectors took 6.4 s that turn against 2.4 s before. The question's vector is
usually the search's own, but not always (the search may run on a reworded
request), so the match can cost one more embedding; on the other five
follow-ups that added about 0.2 s. One run each; the 6.4 s is not explained.

## Still open

- "What should I watch for" after a head injury: the matched lines miss the
  card's list of signs. Signs lists may need to count as how-to (whole card).
- "my toes are white and waxy... can i rub them" opens the trench-foot card,
  not frostbite (retrieval, unchanged here); its line "Don't rub or massage the
  feet" is still right.
- The floor (0.37) and band (0.08) were set on 15 seen questions.
