# Tips pack plan: everyday outdoor know-how (#96)

**Outcome (2026-09-29): steps 1-7 and 9 done; ships. 10 answers better, 1 worse, graded blind; emergencies unchanged. See `results-tips.md`. Step 8 (phone) below.**

Written 2026-09-28. Ryan chose the sources (National Park Service and
Wikivoyage) after reviewing candidates; the Army hygiene and mountaineering
manuals are a possible follow-up, not part of this plan.

## Why

Fred's sources are emergency and survival manuals, first-aid cards and a plant
guide. Everyday questions ("how do I poop in the woods?", "where should I pitch
the tent?", "how do I keep food from bears?") have nothing written for them, so
Fred declines, or stretches an emergency passage to fit. The aim is to widen
what Fred can answer **without** making any existing answer worse.

## The risk, stated first

Fred answers by searching his passages and writing from the best four. More
passages means more competition. The failure to guard against is an emergency
question pulling up a tip instead of first aid ("my friend twisted his ankle
and can't walk" matching a Wikivoyage section on footwear). #93 shows search can
already pick the wrong passage, so this is not hypothetical.

## Sources and licences

| Pack | Source | Licence | Notes |
|---|---|---|---|
| `core-tips-nps` | National Park Service articles on nps.gov | Public domain (US Government work) | NPS's own text only. Some pages reproduce third-party copyright, e.g. the Leave No Trace Center's Seven Principles, which may not be reworded without its review; those passages are left out. Photos are not ingested. |
| `core-tips-wikivoyage` | Wikivoyage travel topics (Wilderness backpacking, Hiking, Camping, ...) | CC BY-SA 4.0 | Its own pack so share-alike stays inside it. Each chunk records its article and revision, so an answer can credit "*Article*, Wikivoyage contributors, CC BY-SA 4.0" with a link. Text only. |

Both go in `docs/licensing.md` and `tools/ingest/src/licenses.ts`.

## Steps

1. **Write the test first.** `tools/eval/data/holdout-everyday.json`: about 40
   casual everyday questions with answer sheets (key points and red flags),
   committed before any page is fetched, like the colloquial set. It also
   holds a handful of emergencies phrased near tip topics ("stepped in a hole
   and my ankle is huge and I can't put weight on it"), to catch tips crowding
   out first aid, and some out-of-scope questions Fred should still decline.
   Run today's Fred on it as the baseline.
2. **Collect.** `tools/ingest/src/tips-fetch.ts` fetches a hand-picked list of
   NPS articles and Wikivoyage articles (via the MediaWiki API, pinned to a
   revision) into `corpora/tips/`, cached and never refetched, like
   `feis-fetch.ts`. The list is chosen by topic, not by the test questions.
3. **Build the packs.** `tools/ingest/src/tips-pack.ts` cleans each page
   (navigation, image credits, "see also", LNT-copyright passages out), splits
   by heading into windows like `feis-pack.ts`, embeds with EmbeddingGemma and
   writes the two packs.
4. **A home for tips in the router.** A new domain, `outdoor-skills`, with its
   own vocabulary (campsite, cathole, trowel, bear canister, layering, trekking
   poles, ...), so everyday questions search the tips and emergency words keep
   routing to first aid. Adding a domain is backward compatible: existing
   packs stay valid, so no schema bump and no rebuild.
5. **Safety guards.**
   - When Fred judges a message an emergency (intent `now`), tips passages are
     dropped from what the model reads, so first aid can't be crowded out.
   - Where NPS and Wikivoyage both answer, NPS is placed first.
   - Tips passages never take the field-card slot.
6. **Credit.** Answers drawn from these packs list the source the way card
   answers do; Wikivoyage lines carry the article, "Wikivoyage contributors",
   the licence and a link.
7. **Measure, then decide.** Run the tuning, held-out, breadth, colloquial and
   everyday sets with and without the new packs, graded blind. **Ship only if
   no existing answer gets worse** and no safety failure appears. Also record
   search time and pack size. If something regresses, fix the cause and rerun;
   if it can't be fixed, the pack doesn't ship and the result is written up.
8. **Phone.** Stage the packs, ask a few everyday and emergency questions on
   the device, and check the credit lines.
9. **Write up** (done 2026-09-29) in `docs/results-tips.md` and `docs/METRICS.md`.

## Done when

The everyday set is answered from NPS or Wikivoyage text with correct credit,
no answer on the tuning, held-out, breadth and colloquial sets gets worse
(graded blind), and it works on the phone.
