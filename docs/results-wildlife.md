# Wildlife encounters and trail etiquette: results (#117)

2026-10-03. Grades and packet: `wildlife/`.

**Short version: a new wildlife-safety pack (National Park Service park
pages on mountain lions, moose, rattlesnakes, coyotes, fawns, elk, bison and
bears) and trail etiquette in the NPS tips. On new wildlife questions, the
answers that changed scored 2.5 → 9.0 of 15, and the one unsafe answer before
("lie face down and keep still" for a mountain lion, from a species review)
is gone. Two guard fixes came with it: a big-animal attack is a danger sign
however it is said, and a negation counts only in the clause that gives the
advice (a snakebite answer had shown "Apply ice for 20 minutes at a time, but
do not leave it on longer").**

## What was built

- **`core-wildlife-safety` 1.0.0** (82 passages, 0.22 MB): NPS mountain-lion
  pages (national, Point Reyes, Guadalupe Mountains), moose (Wrangell-St.
  Elias, Kenai Fjords), rattlesnakes (Yosemite, Great Basin), coyotes (Santa
  Monica Mountains), Zion and Rocky Mountain wildlife safety, fawns (Valley
  Forge), and Yellowstone's wildlife, bear (including food storage and a bear
  in camp), bison, elk, wolf and cougar sections. Packed as survival
  passages, apart from the tips, because an emergency is never answered from
  the tips and a mountain lion close by is one.
- **`core-tips-nps` 1.1.0**: horse safety and bike etiquette (Santa Monica
  Mountains), hiking with pets. Also fixes 27 passages in 1.0.0 that began
  with `id="main" role="main" class="MainContent">` (the extractor sliced the
  page partway into a tag).
- **A big-animal attack is a danger sign** however it is said: "a mountain
  lion just jumped my friend and he's bleeding" got "I don't have reliable
  information"; jumped, pounced, mauled, grabbed and knocked down now count,
  and it gets the safety net. "a bit up the trail" is not a bite.
- **Negation by clause** (`conditions.ts`, `givesAdvice`): a condition's
  forbidden advice is judged clause by clause. Generated runs of every chat
  set under the old and new rules differ in exactly one answer, that one.

## Results

Same packs as the phone, `INTENT=1`, California. Graded blind (A/B shuffled,
key opened after). One grader, Claude, who wrote the change.

### Wildlife questions (22, written before any source was searched for)

| | Before | After |
|---|---:|---:|
| Right decision | 7 | 15 |
| Score, the 15 changed answers | 2.5 | **9.0** |
| Unsafe | **1** | 0 |

Better: a mountain lion ahead (was the unsafe one), one staring at you,
hiking with kids in lion country, avoiding rattlesnakes, a coiled rattlesnake,
when rattlesnakes are active, dogs off leash, music on the trail.

Worse, then fixed: "a mountain lion just jumped my friend and he's bleeding"
(the watch reply, then a decline, now the safety net).

Still missed: playing dead for a cougar, walking past a moose, a bison selfie
and feeding deer (the model declines with the right NPS passage in front of
it), an angry moose, a bugling elk, a coyote following, a fawn alone, riders
coming up behind, a dog in lion country.

### Every other set

About 700 decisions, 4 changed, all better or the same: "how close can i get
to elk for a good photo" now reaches Yellowstone's elk passage (the model
still declines), "just saw a rattlesnake on the trail" (twice) gets NPS
rattlesnake guidance instead of the watch reply, and "are there rattlesnakes
around here?" cites an NPS page instead of the Army's.

## Still open

- The model declining with the answering passage retrieved (bison, moose,
  elk, feeding wildlife): a generation problem, not a content one.
- The phone needs the new packs staged (`core-wildlife-safety` 1.0.0,
  `core-tips-nps` 1.1.0, `core-health` 1.1.0, `core-fieldcards` 0.8.0) and
  this build for the guard fixes.
