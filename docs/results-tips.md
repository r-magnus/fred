# Tips packs: everyday outdoor know-how (#96)

2026-09-29. Plan: `plan-tips.md`. Licences: `licensing.md`, "Tips packs".

**Short version: ships. Everyday questions answered go from 4 of 28 to 12 of
28, and across the five question sets 10 answers got better and 1 got worse,
graded blind, with no safety failures. Emergencies are answered exactly as
before.**

## What was added

| Pack | Source | Chunks | Size |
|---|---|---:|---:|
| `core-tips-nps` | 28 National Park Service articles (public domain) | 169 | 0.43 MB |
| `core-tips-wikivoyage` | 12 Wikivoyage travel topics (CC BY-SA 4.0) | 215 | 0.58 MB |

- A new domain, `outdoor-skills`, with a small vocabulary (`lexicon.ts`).
- Emergencies (intent `now`) are searched as if the tips were not installed.
- A question about "this area" with no location, whose best passage is a
  tip, asks for the location: tips are general, not local.
- Where both tips packs make the cut, NPS is read before Wikivoyage.
- Wikivoyage answers show the CC BY-SA credit and a link to the revision.

## The test, written first

`tools/eval/data/holdout-everyday.json`, committed (037164c) before any page
was fetched: 28 everyday questions, 6 emergencies phrased near tip topics, 6
Fred should decline. `EVAL_SET=everyday`.

## Results

Before is `main`; after is this branch with both packs. Same machine, same
settings (`INTENT=1`, as the app runs).

| Set | Before | After |
|---|---:|---:|
| Everyday (40) | 14 | **23** |
| Colloquial (36) | 26 | 26 |
| Breadth (57) | 48 | 48 |
| Held-out (40) | 34 | 35 |
| Tuning (104) | 90 | 89 |

(Outcome matches: answered when it should, declined when it should. Tuning's
one "drop" is `uv-smoke-01`, which gave a wrong answer before and now
declines; both grade 0.)

**Graded blind:** 15 of 277 answers changed (`tips-verdicts.json`, runs in
`tips-runs-*.jsonl`). Before 2.5, after 8.5. 10 better, 1 worse, 4 the same.

- Better: peeing at camp, periods on the trail, picking a campsite, keeping
  bears out of food (it asked for a location before), right of way, trekking
  poles, what to always carry, keeping a sleeping bag dry, whether bugs are
  dangerous, and the moon as a direction finder.
- Worse: `hs-movement-01`, "what should I be thinking about while walking out
  of the backcountry?", a held-out question. A Wikivoyage "prepare for your
  trip" passage outranked the survival manual's movement section and the
  answer went vague (0.5 to 0). **Not fixed on purpose**: tuning a weight
  against a held-out question would quietly make it a tuning question.
- Every emergency in the everyday set got the same answer as before.

**Speed:** mean answer time on the four existing sets 5.0 s before, 5.2 s
after, within run-to-run noise.

## Found and fixed along the way

The first comparison had 4 losses. Three had one cause each, and were fixed
before the run above:

1. **The emergency guard emptied the search.** "A tick dug into my armpit" and
   "freezing in my tent" routed to the tips alone ("tick", "tent" and
   "sleeping" are tips words), the guard then filtered the tips out, and
   nothing was left: the tick and cold-night cards were lost. The guard now
   searches again without the tips instead of filtering.
2. **General tips answered a local question.** "Are there dangerous animals in
   this area?" was answered from a desert-safety passage. Now it asks where
   the hiker is, as it did before.
3. **Words that stole routing.** Adding "ticks" to the tips vocabulary took
   tick questions away from wildlife, and "trail" and "hike" pulled weight off
   the injury words in "twisted my ankle on the trail". The vocabulary is now
   base forms only, and leaves out words injury messages use as scenery.

## Still open

- **Six everyday questions read as small talk** ("it's pouring, can we just
  cook inside the tent", "my feet are always soaked by the end of the day").
  They have no question mark and don't start with a question word, so the
  intent check calls them chat. That is the intent classifier, not the tips,
  and affects any statement-shaped question.
- **Lightning:** neither "afternoon storms keep rolling in" nor "lightning hit
  near us and my friend isn't breathing" is answered, before or after.
  Wikivoyage's storm advice was dropped as contradictory; the NPS lightning
  article is in the pack but doesn't rank.
- **Park-specific pages** (per-state tips) are a later decision.
