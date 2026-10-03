# The other 48 state species packs: results (#118)

2026-10-03. Run and grades: `states/`.

**Short version: nothing needed building. All 50 state packs are already
published with the state map bundles (`r-magnus/fred-maps`, release
`maps-2026-09`, 422 MB in all, 3-13 MB each), byte for byte the same as the
local 1.1.0 builds, and the app downloads a state's pack with its map (#26).
What was missing was a test outside California and Oregon. On 28 questions
across 11 states, with all 50 packs loaded as on a phone that has every
state, Fred answered 23; graded: 13 right, 7 partly right, 8 wrong, nothing
unsafe. That is about the level of the California and Oregon questions:
without a pack these all get "which state are you in?" or a decline.**

## The test

`tools/eval/data/holdout-states.json` (`EVAL_SET=states`): Arizona, Colorado,
Montana, Florida, New York, Maine, Texas, Washington, Alaska, Minnesota and
Georgia, two or three questions each, tagged with the hiker's state; key
points from general knowledge, after checking only that each species is in
that state's pack. One trap (grizzlies in Georgia: none) and one with no
location.

## What it found

- Right: Arizona sycamore, grizzlies in Montana, black bears in New York,
  eastern hemlock, moose and lynx in Maine, western redcedar, salal, wolves in
  Minnesota, paper birch, kudzu, longleaf pine, saw palmetto.
- Wrong facts from the model, not the packs: the elk rut "in late spring to
  early summer" (fall), black spruce "30 to 60 meters" tall (it is a small
  tree).
- Declined with the species in the pack: saguaro height, bighorn sheep diet,
  lowbush blueberries, mesquite pods, the madrone ("the tree with the peeling
  red bark", named only by description), and grizzlies in Georgia (the right
  answer is "no", which a species review of grizzlies does not say outright).
- "are there moose around here" with no state was answered from NPS moose
  safety instead of asking where the hiker is.

## Still open

- Species facts from FEIS reviews are uneven with the 1.7B model everywhere,
  not only outside California.
- A state's pack downloads only with its map (the map is 100-650 MB). A
  pack-only download (3-13 MB) would let a hiker add a state's plants and
  animals without the map.
