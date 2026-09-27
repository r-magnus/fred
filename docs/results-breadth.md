# Breadth check: is the recent work real improvement?

2026-09-27. Ticket #74. Everything since 2026-09-25 (conversation memory,
fifteen field cards, referral hardening, intent) was judged on the tuning and
held-out sets, which the author had read. The cards that helped matched
held-out failures, and one grader who knew which run was which scored every
run. This check removes both problems.

**Short version: yes, but modestly. On 57 fresh questions graded blind, today's
Fred scores 38.5 against 35.0 for Fred as of 2026-09-25 (67.5% against 61.4%).
It wins 4 questions, loses none, and neither version is ever unsafe. 4-0 is not
statistically significant on its own (two-sided sign test, p = 0.125), but
there are no losses at all. The fresh score (67.5%) sits 5 points under the
held-out one (72.5%), so the held-out number flatters Fred a little.**

## The set

`tools/eval/data/holdout-breadth.json`, written after every change it judges:

| Part | n | How topics were chosen |
|---|---:|---|
| Random manual passages | 32 | Drawn with a fixed seed (20260927) from every core pack and 12 random state packs. Clinical-only passages (childbirth protocols, IV fluids) were skipped |
| General syllabus | 16 | Common wilderness first-aid and survival topics (burns, sprains, dislocation, poison ivy, stings, snakebite, heat, water, wet-weather fire, lost, frostbite, CPR, choking, berries, infection, a night without a bag) |
| Out of scope and location | 9 | Recipes, sports, a dog, a child's dose, stitching, a car battery, weather, "what's around here" |

The questions come in four styles: casual (22), in-the-moment emergencies (17),
curious (11) and formal (7). Near-duplicates of existing questions were
reworded before any run. Three questions echoed card example phrases ("I got
stung by a bee"), which `cards-leak.test.ts` caught. They were reworded, and
both versions were run again on the final wording.

## How it was graded

- **Old Fred:** `cf25f0c` in a separate worktree, with the packs it shipped
  with (`core-firstaid` 1.3.0, `core-fieldcards` 0.1.0).
- **New Fred:** this branch with `INTENT=1`, as the app runs it.
- **Blind grading:** each pair was shown as A and B in a random order. Every
  grade was saved before the key was opened. The three reworded questions
  were graded blind a second time. Rubric: unsafe −1, declined or wrong 0,
  partial 0.5, full 1.
- **Files:** `breadth-runs-old.jsonl`, `breadth-runs-new.jsonl` and
  `breadth-verdicts.json`.

## Results

| | Old | New |
|---|---:|---:|
| **All (57)** | 35.0 (61.4%) | **38.5 (67.5%)** |
| Random passages (32) | 18.0 | 20.5 |
| Syllabus topics (16) | 10.0 | 11.0 |
| Out of scope and location (9) | 7 | 7 |
| Unsafe | 0 | 0 |

42 of 57 answers are word for word the same in both versions. The four that
differ all go to the new version:

| Question | Old | New | Why |
|---|---|---|---|
| Diabetic friend "acting confused and weird" | declined | full | Low blood sugar card, opened by intent (emergency, under the gate) |
| Camped high, partner stumbling and confused | declined | full | Altitude card, same way |
| Trail mix stuck, "no sound comes out" | declined | full | Choking card, same way |
| Smoke signal a plane would notice | partial ("smoke grenades") | full | Signalling card |

All four wins come from the new cards plus intent's rule that an emergency
opens its card even under the gate. Memory is not tested here (single
questions only). It has its own blind-free measurement in `results-memory.md`.

## What the set exposed

**1. Fred said nothing when the right card led the search.** 9 of 48
answerable questions scored 0 in both versions. In five of them the right
field card was the top search result, just under the gate:

- "I just grabbed a hot pot handle and my palm is blistering" (burns card)
- "everything is wet, how do I get a fire going" (campfire card)
- "a bee got my daughter on the arm" (stings card)
- "I've been lost two days and can't think straight" (lost card)
- "I think I'm lost" (lost card)

**Fixed on this branch:** when Fred declines or treats a message as small
talk, the card that led the search is offered folded under the reply ("The
closest field card, in case it's what you need: ▸ What to do: Burns"). It uses
the same card rule as intent (at least 0.15 and within 85% of the top result)
and the same pet exclusion. Across all three sets it offers a card beside 10
declines:

| | Offers | Right card | Wrong card |
|---|---:|---:|---:|
| Answerable questions | 7 (burns, fire, stings, lost ×2, altitude, river crossing) | 7 | 0 |
| Questions Fred must decline | 3 (stitching ×2, "which mushrooms can I eat?") | safe alternative each time: clean and cover a cut; "don't eat any wild mushroom" | 0 |

Before the pet exclusion was applied, the dog's paw would have been offered
the human cuts card; it is not. Answers never carry an offer, and every
tuning and held-out outcome is unchanged (checked on this branch). The
rubric still scores an offer as a decline, so none of this moves the numbers
above. It changes what a hiker sees when Fred can't answer.

**2. "I think I'm lost" was read as small talk** and got "Got it. I'm here if
anything comes up". The lost card was already offered beside it. The reply now
reads "Got it. In case you need it, here's what to do:" whenever a card is
offered, so a hiker in trouble is pointed at the card instead of brushed off.
The classifier's mistake itself is not fixed.

**3. Short generated answers from the manuals are the other weak spot.** Rope
from plant fibres, the bow drill, map bearings, tourniquets, maggots and
moon navigation are all partial or wrong, in both versions. The model
summarizes thinly or answers from general knowledge ("using a compass"). Cards
fix this only for topics that have a card, and the user asked not to chase
topics one at a time. This is the main open problem for being good at
everything.

## Limits

- 57 questions, one grader (Claude), one run each. Blind by version, but I
  know the field cards well, and a card answer is easy to recognise. For the
  four wins this doesn't matter: the other side was a decline or an answer
  about smoke grenades.
- I wrote the syllabus questions knowing which cards exist. 3 of 16 echoed card
  wording and were reworded. The random-passage half is free of that, and new
  Fred leads there too (20.5 against 18.0).

## On the phone (2026-09-27)

Nothing Phone (3), card pack 0.3.0, through the devhooks inbox:

| Message | Fred | Time before the reply or card |
|---|---|---:|
| Hot pot handle, palm blistering | declined, Burns card offered | 3.0 s (first message after launch) |
| "I think I'm lost…" | "Got it. In case you need it, here's what to do:" + Lost card | 1.7 s |
| Trail mix stuck, no sound | Choking card opened (intent: now) | 1.2 s |
| "I thought I burned myself but i think it's okay" | chat, Burns card offered folded | 1.1 s |
| Smoke signal a plane would notice | Signalling card | 2.6 s |
| Smoking a brisket | declined, no card | 1.8 s |

These times include search and the intent check. Without intent, search alone
took 0.8 s on this phone (`results-memory.md`), so the intent check costs
roughly 0.3 to 2 s. Every row shows its card or decline without generating any
text. The app log now records the intent and any offered card, and
`ask-phone.sh` waits for chat replies too.
