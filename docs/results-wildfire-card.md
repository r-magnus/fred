# The wildfire card: results (#100)

2026-10-16. Evidence: `wildfire-card/`. Follows `results-wildfire.md` (#207).

**Short version: Ryan approved a card for wildfires. "A wildfire or its smoke
nearby" now answers 9 of the 16 fresh wildfire messages that main declined or
answered from loose passages, plus "the smoke is so thick it's hard to
breathe", "we can see a column of smoke over the next ridge" and "the wildfire
is coming toward us and we can't outrun it". Across all 29 sets, 16 replies
changed, all wildfire messages, except one folded offer that went away.
core-fieldcards 0.9.0 (44 cards), core-hazards 1.2.0; the card matcher was
retrained.**

## The card

Don't go closer or try to put it out. Leave by a route away from the fire and
the way the wind is blowing, and report it. If it reaches you, get to the spot
with the least to burn and lie face down, covered. Nine steps: don't
investigate, report (ranger or 911), leave by a route away from the wind's
direction, follow fire crews and closures, ease off in smoke and know its
symptoms, the least-fuel spot (bare ground, rock, a road, a large lake; not
canyons, chimneys or saddles), the backcountry depression, the uphill road
ditch, stay in a car. Don't outrun a close fire, drive through heavy smoke or
light any fire.

17 quotes, checked word for word: NPS visitor fire safety (in the pack), the
Forest Service's Boundary Waters steps (in the pack), and the Army's Fort
Huachuca fire-prevention article (army.mil, public domain), added to the
hazards pack for this. Four lines are marked unsourced, each with its reason:
the smoke step (from NIOSH's outdoor-worker page, left out, below), no fire
even to signal, the SOS and trouble-breathing line, and the examples of bare
ground. "Fire runs uphill" is not claimed: no US agency source found says it;
the card names where to go instead. Self-reviewed (`self-reviews.json`).

## What else changed

1. **The matcher learns the card**: 24 examples, four of them moved from "no
   card" ("a wildfire is on the next ridge"). On examples it never saw, top
   label right 1,290 of 1,506 (85.7%, as before); thresholds sure 0.62, leans
   0.26 (were 0.63, 0.28).
2. **The card is only for a fire in view.** The first sweep showed it on "a
   group on horses is coming toward us on the trail", "dark clouds piling up
   fast over the peak" and "a storm rolled in and we can barely see in the
   snow", the matcher saying no card. Unless the wildfire check (#207) or the
   matcher says a fire, and not one that is over ("an area that burned last
   year"), the card is left out of every search (`NO_FIRE`).
3. **A wildfire near gives way to the card** where it blocks the campfire
   card, and **an answer that sends the hiker uphill or to a ridge, or says to
   light a fire, is replaced by it** (the guard the snakebite and burns cards
   have).
4. **NIOSH left out.** Its wildfire-smoke page is the one government page on
   smoke for people outdoors, but it is written for employers: "the smoke is
   so thick it's hard to breathe", a danger sign, was answered with "Require
   and encourage workers to take frequent breaks". It now gets the card, whose
   get-help line covers trouble breathing.
5. **"burned last year", "burn area" are not a burn**: the burned-area question
   lost the burns card ("Watch for high winds, unstable ground, falling trees,
   and potential landslides or flash floods").
6. **The water card's #51 edit** (boil 3 minutes above about 5,000 feet,
   quoted from EPA) had no self-review entry, so a `CARDS=approved` build left
   the card out. Reviewed and recorded; the shipping build has all 44 cards.

## Results

Baseline: main (`d9fcda9`) with the packs on the phone (`smoke/new2`). New:
this branch with core-hazards 1.2.0 and core-fieldcards 0.9.0.

| | main | with the card |
|---|---|---|
| fresh wildfire messages with the card (16) | 0 | 9 |
| fresh wildfire messages declined or small talk | 9 | 6 |
| replies changed outside wildfire messages | | 1 (an offer of the river card for "paddling across the lake to our campsite" went away) |

The campfire questions keep the campfire card or the manuals; the two people
burned near a fire keep the burns card (`fresh-questions-after.txt`,
`decision-diff.txt`; the first sweep, before item 2, is `first-sweep-diff.txt`).

## Still open

- Declined still: "a big plume of smoke just went up in the valley below us"
  (the matcher is sure, but the scope scorer says it needs no answer, and a
  sure card opens only when it does: retraining the scope scorer would
  change every set), "the whole canyon filled with brown haze", "bits of
  burnt leaves keep landing on our tent", "helicopters keep dumping water on
  the mountain next to us", "the brush just flared up near the creek below
  us". "the hills to the east are glowing tonight" is read as small talk.
- The phone needs the new app and the two packs.
