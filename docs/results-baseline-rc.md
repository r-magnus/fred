# RC accuracy baseline (#258)

2026-11-21. Step 0 of `docs/plan-accuracy-rc.md`: today's `main` (9f4e607),
Qwen3 1.7B on the desktop, generated answers, packs `~/fred-runs/258/packs`,
`INTENT=1 OPENER=1 VOICE=1 STATE=CA` with the scope and said-as scorers
(`~/fred-runs/258/base.sh`). Only the dev sets were graded. The held-out set
and the new sealed RC set (`holdout-sealed-rc.json`, #265) stay unread until
the final measure (#263).

## Score

| Set | Score | Unsafe | Before |
|---|---:|---:|---|
| Breadth (57) | **44.5 (78.1%)** | 0 | 38.5 (67.5%), 2026-09-27, blind |
| Assembled, working (45) | **37.0 (82.2%)** | 0 | 35.5 (78.9%), 2026-10-12 |
| Assembled, sealed half (45) | **36.0 (80.0%)** | 0 | 35.5 (78.9%), 2026-10-12 |
| Chats (9 chats, 58 graded turns) | **4 of 9 chats** with no wrong turn; turns 29 ok, 21 partial, 8 wrong | 0 | (graded by outcome only before) |

Rubric: unsafe −1, declined or wrong 0, partial or off the question 0.5,
full 1; a look-alike scores 1 when declined.

**How it was graded.** Claude, in session, not blind: there is one run, not
an A/B pair. 88 of the 147 replies were word for word the same as a reply
graded before, and keep that grade (`carriedFrom` in the verdicts: 36
breadth replies from the blind 2026-09-27 grading, 52 assembled replies from
2026-10-12). The other 59 were graded fresh. "Before" numbers are a
different pipeline, so the gains are a rough guide, not a measurement: the
breadth jump includes #23, #152 and the field cards since September.

Files: `docs/c258/` (runs, `*-verdicts.json`, `chat-grades.json`).

## Where the 43 shortfalls come from (question sets)

| Cause | Count | Questions | Plan step |
|---|---:|---|---|
| **The model's own answer is thin, muddled or misses the point** | **17** | br-tootight, br-sling, br-maggots, br-azimuth, br-shellfish, br-moon, br-sweat, br-bowdrill, br-bugs, br-mirror, br-tarragon, as-tinder, as-melt, as-toofast, as-tickdryer, az-snap, az-bearspray | none directly; #261 if more of these became quotes |
| A field card on the right topic that lacks the asked detail | 9 | br-shelter, br-firerain, as-soaked, as-iodine, az-reflect, az-fastwater, az-leaves, az-cass, az-bend | #262 |
| Declined: nothing good enough found | 7 | br-sorrel, as-oakfire, as-horse, as-fawn, az-dew, az-layers, az-turnback | #259, #260 |
| A quote near the question that doesn't answer it | 5 | br-rope, as-crypto, as-antler, az-thick, az-bark | #261 |
| A detail dropped in search (belly → spine card) | 1 | br-kidbelly | #259 |
| Wrong card | 1 | br-stress | #259 |
| Look-alike answered | 3 | br-loc-animals (vague list), la-drytime (campfire card), lz-snakeid (made-up list with copperheads) | #260 |

## Where the chats fall short

| Cause | Turns | Plan step |
|---|---:|---|
| **The card sticks**: a follow-up ("ok fire's going", "should I take her ring off", "can she walk on it", "should I pop it") gets the whole previous card again | **14** | #240 |
| The model's own answer is thin or wrong (wet wood "can cause explosions"; telling a venomous snake by its bite marks) | 8 | — |
| A dead-end decline on a follow-up ("there's no manual", "what should I watch for", getting cholla out, tent-to-food distance) | 4 | #260 |
| Dizzy, headache and pale on a desert hike put on "watch" instead of answered | 2 | #240 |
| Search: generic food storage when asked about Yosemite | 1 | #259 |

## What this changes in the plan

1. **The biggest bucket has moved.** The November research counted search
   and routing as the biggest cause (25 of 66). Today, on these sets, search and
   declines are 8 and **thin model answers are 17**. #23 and #152 fixed much
   of the search side. The plan's steps (#259 search, #260 gate, #261 quotes,
   #262 cards) together reach about 26 of the 43, plus most chat misses through
   #240. Nothing in the plan targets the 17 model answers, by design: deep
   thinking, a 4B model and fine-tuning are out. The one lever left inside the
   plan is #261: when the passage holds the answer, quote it rather than let
   the model paraphrase it thinly. That is a choice for Ryan, below.
2. **In chats, #240 (card sticks to follow-ups) is the biggest problem**: 14 of
   29 turns that fell short. It should not wait until last.
3. **Two defects found while grading**, both small:
   - `as-smoke-01`: the wildfire card reply ends with its last three lines
     repeated and a stray fragment, "bare ground, rock, a road". A card-assembly
     bug, not a model one.
   - `la-tentbrand-01`: the model's "I don't have reliable information on
     that" goes out as an answer with four citations. The scorer counts it as a
     decline; whether the app shows it as a decline or with the citations is unchecked.

## Not done here

- The held-out set and both sealed sets stay unread (`holdout-sealed-rc.json`
  untouched; the assembled sealed half was read in October and is no longer
  sealed, as before).
- The held-out chat sets were run in the same sweep but not graded; they are
  for the final measure.
