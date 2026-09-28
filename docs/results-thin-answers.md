# Why manual-based answers come out thin

2026-09-27. Ticket #85. Option 1 from the accuracy plan: before fixing thin
answers, find out whether search, passage splitting or the answer itself is to
blame. Then two narrow fixes were tried, graded blind, and both rejected.

**Short version: in most thin answers, the needed text was in the prompt. The
answer-length rule looked like the cause, but loosening it made answers
*worse* (the model fills the room with wrong statements), and answering how-to
questions in steps barely moved anything. Neither ships. The remaining causes
are what the model does with noisy passages, and a few search misses.**

## Diagnosis: 15 weak answers on the breadth set

For every breadth answer graded below full, the exact prompt was re-created
(`dump-context.ts`, which now saves it) and read against the answer.

| Cause | Answers |
|---|---|
| Needed text in the prompt, answer cut short or garbled | pressure bandage too tight, tourniquet, sling, maggots, shellfish, moon navigation, bow drill, signal mirror, infected scrape |
| Search missed the passage | rope from plant fibres (twisting passage not found), keeping bugs off (passages about *eating* insects), tarragon (no description passage) |
| A list split across two passages | map bearing (steps 1-2 in the passage before) |
| Wrong field card | white, numb toes got immersion foot rather than frostbite |
| Read as small talk | "I think I'm lost" (now handled by the chat map, #79) |

Two things stood out in the first group:

- Every prompt ends with a shape rule. It asks for numbered steps when at least
  half the passages are tagged as procedures, and otherwise for "two or three
  short sentences and nothing else". The bow drill question had every step in
  hand and got three sentences. The moon passage says exactly which side is
  lit, and the answer was "Yes".
- Procedure tags come from each passage's own layout, so the second half of a
  list split across passages is tagged prose.

## Two fixes, graded blind

Both behind `SHAPE=` in the eval (prompt.ts `ShapeVariant`), off by default.

- **B `how`:** how-to questions ("how do I", "how does", "what should I do")
  answered in steps whatever the tags say.
- **C `how-few`:** B, plus "a few short sentences" instead of "two or three".
  "And nothing else" stays: removing it on the 0.6B model took refusals from 1
  to 16 (`results-akr2.md`).

Baseline: today's pipeline with intent, on the tuning (104) and breadth (57)
sets. Only answers that changed were graded, A/B shuffled
(`shape-verdicts.json`, `shape-runs-*.jsonl`).

| | Changed | Base | Variant | Wins | Losses |
|---|---:|---:|---:|---:|---:|
| B, tuning | 0 | | | | |
| B, breadth | 6 | 2.5 | 3.0 | 1 | 0 |
| C, tuning | 9 | 8.5 | 5.5 | 0 | **4** |
| C, breadth | 17 | 11.5 | 12.5 | 3 | 1 |

**C is rejected.** Given room, the model added claims the sources don't make:
"California black oak is not found in Oregon" (it is native there), beavers as
predators of black bears, "Delaware is not listed" for the catbird. It also
shortened one answer to the single word "California". The wins it had
(shellfish red tide, the moon's lit side) are real, but they don't pay for
the new wrong answers.

**B is not shipped.** Its one win is half a point, a bug answer that mixes
repellent advice with how to cook insects. The step lists it produced for bow
drill and rope scored the same as the short versions, because they pulled in
neighbouring material: hand-drill steps in the bow drill list, rawhide in the
plant-rope list. Refusals didn't change for either variant.

## What this means for the next fixes

- The length limit protects this model more than it costs. Leave it.
- The thin answers come from **noisy passages**. Of the four passages the model
  gets, often only one fits the question, and the model blends in the rest.
  That argues *against* adding neighbouring passages (option 2 of the plan)
  unless the extra passage replaces a weaker one rather than adding to them.
- The search misses (rope, bugs, tarragon) and the wrong card (frostbite) fit
  option 3: plain descriptions of situations on the cards, and better matching
  for how people phrase things.
