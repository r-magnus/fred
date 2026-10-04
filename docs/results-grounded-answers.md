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
- **Stuck on a ledge** gets the lost and signalling cards' summaries (stay put; be seen and heard), whatever the message is classified as (fixed on the phone, #128).
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

2026-10-04, Nothing Phone (3), this build with every new pack staged (#128):
`core-fieldcards` 0.8.0, the nine core packs with the sentence index (1.x.1),
CA and OR. The app loads all twelve (12,791 passages, the sentence index
read) in about 5 s.

| Message | Reply | First words |
|---|---|---:|
| "a raccoon bit my kid's hand while we were camping" | CDC: wash 15 minutes, seek care promptly | 11.3 s |
| "i've had diarrhea all morning on the trail" | NIH: rehydrate, electrolytes, get care if it persists | 12.6 s |
| "is it ok to walk up to the bison for a selfie" | the quote: "never approach a bison to take a photo" | 11.3 s |
| "lightning hit right near us and my friend is on the ground not breathing" | the reviewed reply: safe to touch, start CPR | 13.2 s |
| "the thunder stopped, how long before we keep hiking up" | the quote: "Wait 30 minutes until after the last rumble" | 14.7 s |
| "a snake bit my friend" / "can i put ice on it" | the card, then "Don't put ice on it." | 4.5 s / 2.0 s |
| "we're stuck on a ledge and can't climb up or down" | stay put, be seen and heard (after the fix below) | 4.5 s |
| "how do i make rope from plant fibers" | model-written | 15.6 s |

Model-written answers show first words in 11-16 s, as before. Two fixes came
from the phone: the ledge rule sat inside the emergency branch, and "we're
stuck on a ledge" is read as a question, so it was declined (on the desktop
too; it now applies to any message and shows the lost and signalling cards'
summaries, not the signalling card whole, whose first step is to reach the
highest ground); and a list marker ("1.") held back an answer's first
sentence in the number check (now released at once; first words 0.6 s
sooner on list answers).

## Still open

- Quotes need the sentence index; state packs don't have one yet (species
  questions with a bad number get a decline, not a quote).
- The tick question: a true but unsourced number now goes, and the quote
  that replaces it can miss.
- Sunburn treatment and chafing: no free-to-use source.
