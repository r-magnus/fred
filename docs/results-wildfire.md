# A wildfire near: results (#100)

2026-10-16. Evidence: `wildfire/`. Fresh questions:
`tools/eval/data/holdout-hazards-3.json` and `holdout-hazards-4.json` (set
`hazards-confirm`).

**Short version: a hiker who sees a wildfire's glow, ash or burning trees no
longer gets the campfire card or the burns card, and no answer tells them to
make smoke signals by setting a tree on fire. Across every set, only those four
replies changed. No card or reviewed reply was added; the hazards pack is
unchanged (1.1.0).**

## What was wrong

All of these were the same before #206 and after it; the write-up for #206
listed only replies that changed, so the first was missed there.

| Message | Reply |
|---|---|
| "there's an orange glow and ash falling on our camp" | the campfire card, word for word |
| "there's a fire on the hillside above our camp" | the campfire card |
| "embers are drifting into camp from somewhere upwind" (fresh) | the campfire card |
| "i can see trees burning across the lake from our site" (fresh) | written from the burns card |
| "we smell smoke and the sky is turning brown" | "...create smoke signals using a burning tree" |

The last came from the Army survival manual's signalling page (the tree
torch), which matched only on "smoke".

## What changed

1. **A wildfire near** (`WILDFIRE_NEAR`, conditions.ts): a wildfire named, its
   smoke, glow, ash, embers or a red sun, or flames or burning on the land
   around. While the thread says one, the campfire card is blocked on every
   route to a card (`NOT_AFTER`), and no passage that says to start a fire or
   make smoke (`FIRE_STARTING`: signal fires, the tree torch) reaches the
   model. It is not a condition in the record: it has no card.
2. **Burning trees are not a burn.** "trees burning", "the forest is burning",
   "something burning" no longer set the burn condition; "i burned my hand on
   the stove while the trees were burning" still does.

Tried and dropped: cutting the Forest Service's Boundary Waters smoke steps
into one passage per step, so the canoe step ("paddle into the lake and tip
your canoe and go under it") would come up only on the water. All three steps
share the heading, so the canoe step still came up for hikers, and the extra
steps pushed out the Park Service passage ("note the location ... report it
... avoid traveling near it"); the answer got worse.

## Results

### Every set (decision sweep, 29 sets)

Baseline: main (`a69c1b7`), packs as on the phone. Changed: the four messages
above that are in the sets, nothing else (`decision-diff.txt`).

### Fresh questions (written before running, two rounds)

Round 1 (10): two of six wildfire messages still got a wrong card (the embers
and the burning trees); the four campfire questions kept the campfire card.
Both misses were fixed by item 1's embers and burning wording and item 2, so
round 1 is no longer a clean test. Round 2 (10, written after): no wrong card
before or after; a son burned by the wildfire and an ember burn keep the burns
card, and "im freezing and need to get a fire going fast" keeps the campfire
card (`fresh-questions.txt`).

### The changed replies, generated (`changed-answers.jsonl`)

| Message | Now |
|---|---|
| orange glow and ash | "If there is a risk of further fire ... evacuate immediately" (Forest Service, Park Service) |
| smell smoke, brown sky | stay calm, take another route away from the fire, a large lake; still ends with the canoe step |
| embers drifting in | "I don't have reliable information on that." |
| trees burning across the lake | "I don't have reliable information on that." |

## Still open

- **Most wildfire messages are declined**: round 2's "bits of burnt leaves keep
  landing on our tent", "helicopters keep dumping water on the mountain next to
  us", "it got dark at 3pm and everything smells like a campfire", and "the air
  is so smoky we keep coughing". "the hills to the east are glowing tonight" is
  read as small talk. No hiker-facing source on breathing smoke has been found.
- **The canoe step** still reaches hikers.
- **The model's own advice** ("move to a hill") is not caught: that needs a
  reviewed wildfire reply like the lightning-strike one, which is close to a
  card and waits on Ryan.
