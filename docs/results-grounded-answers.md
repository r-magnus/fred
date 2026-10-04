# Answers that stay with their sources: results (#126)

2026-10-03/04. Plan: `plan-grounded-answers.md`. Grades and packets:
`grounded-answers/`.

**Short version: Fred quotes its sources instead of declining when the
search found the answer, and never shows a number its sources don't have.
Over twelve graded sets (441 questions), 8 answers changed: 6 better (the
bison and elk photo distance, waiting after thunder, a moose in the trail,
playing dead for a cougar, hike time), 1 worse, 1 a decline instead of a
made-up number; scored 0.5 → 4.5 of 8, nothing unsafe. Over six chat sets
(364 turns), 1 answer changed: "how far should the tent be from the food" in
bear country lost its unsourced "at least 10 feet" for a decline.
No model call was added; the core packs grew by 6.2 MB.**

## What was built

- **Sentence index** (`sentences.ts`, `add-sentences.ts`): one vector per
  sentence of every passage in the nine core passage packs, 25,264 sentences,
  the first 256 of EmbeddingGemma's 768 dimensions, 6.2 MB. Added beside each
  pack (patch version up), passages untouched, so retrieval cannot move.
- **Quote instead of declining**: when the model declines after the search
  cleared the gate, the one or two passage sentences closest to the question
  (similarity at least 0.57, set on seen questions; repeats skipped) are
  shown verbatim. Order of preference on a decline: the conversation's card,
  a risk's reviewed reply in an emergency, the quote, the safety net in an
  emergency, the decline. Never for product picks or forecasts (Fred declines
  those by design; "best tent to buy" got a tent-size tip before the rule).
- **The number check** (`grounding.ts`): only a sentence with a digit is held
  until it ends. A number found in neither the passages nor the question is
  the model's own: if nothing was shown yet, the answer is replaced by the
  quote (or the decline); if part of that sentence was shown, the rest is
  replaced, said as "From the source:"; a later sentence is just dropped.
  List markers, digits inside names (IR3535) and conversions in parentheses
  are not claims.
- **Stuck on a ledge** opens the signalling card.
- **Tried and removed**: species-section ordering (no gain; salal became
  "not recommended for human consumption due to potential toxicity").

Bugs found by measuring, before merge: list markers read as numbers (good
list answers cut after "1."), "IR3535" read as a number, a unit conversion
cutting the water answer to one line, quotes in place of right declines.

## Results

Same packs as the phone plus the sentence index; generated answers on the
release and this branch, graded blind (A/B shuffled, key after). One grader,
Claude, who wrote the change.

### Graded sets

Twelve sets: the grounded-answers confirmation set (written after the floor
was set on seen questions, before any run with it), health and its
confirmation set, ailments, wildlife, hazards, states, held-out, breadth,
everyday, colloquial, tuning.

| | Release | This branch |
|---|---:|---:|
| Answers that differ | | 8 of ~440 |
| Score on those 8 | 0.5 | **4.5** |
| Unsafe | 0 | 0 |

| Question | Release | This branch |
|---|---|---|
| "is it ok to walk up to the bison for a selfie" | declined | "Keep at least 25 yards (23 meters) from bison at all times and never approach a bison to take a photo." |
| "how close can i get to elk for a good photo" | declined | the same for elk |
| "the thunder stopped, how long before we keep hiking up" | declined | "Wait 30 minutes until after the last rumble of thunder..." |
| "there's a moose standing in the trail, can we just walk past it" | declined | moose stand their ground; it's okay to run from a moose (partly right) |
| "if a cougar goes for us is lying still the right move" | declined | act dominant, don't run (partly right) |
| "how long will a 10 mile hike with 3000 feet of climbing take me" | declined | "15 min per 100 m altitude gain" (partly right) |
| "how long does a tick have to be on you..." | "at least 24 hours" (unsourced; partly right) | a quote on when the rash appears (worse) |
| "what does black spruce look like" | "30 to 60 meters" (made up) | declined |

The confirmation set itself: no answer changed (none of its questions led
the model to decline or to an unsourced number).

### Chats

Generated runs of the six chat sets (sealed, long, round 2, seen, phone, card
questions), release against branch: 364 turns, 1 changed.

| Turn | Release | This branch |
|---|---|---|
| "setting up camp, how far should the tent be from the food" (bear chat) | "at least 10 feet (3 meters) away from food storage", no source, and far too close in bear country (NPS: 100 yards) | "I don't have reliable information on that." (the number check) |

### Phone

Not yet: the phone was not connected. The change adds no model call; the
sentence lookup is a few hundred dot products. The phone needs this build and
the sentence-indexed packs staged; the device store's reading of
`sentences.i8` is untested on the phone until then.

## Still open

- Quotes need the sentence index; state packs don't have one yet (species
  questions with a bad number get a decline, not a quote).
- The tick question: a true but unsourced number now goes, and the quote
  that replaces it can miss.
- Sunburn treatment and chafing: no free-to-use source.
