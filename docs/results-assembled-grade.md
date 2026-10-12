# The fresh "put together" questions, graded (#23)

2026-10-12, main at 509cd00, Qwen3 1.7B on the desktop, packs `fred-packs-g-all`.
Sets: `assembled` (working) and `assembled-sealed`. Each has 30 questions the sources answer in other words
or across passages, and 15 look-alikes they do not answer.

Not blind: the grader (Claude, in session) also wrote the questions and key points. The sealed set has now
been read answer by answer, so it is no longer sealed.

## Score

| | working | sealed |
|---|---|---|
| Rubric score | 35.5 / 45 (78.9%) | 35.5 / 45 (78.9%) |
| Unsafe answers | 0 | 0 |
| Answerable: fully right | 17 | 18 |
| Answerable: partly right or off the question | 9 | 7 |
| Answerable: wrong | 2 | 2 |
| Answerable: declined | 2 | 3 |
| Look-alikes correctly declined | 14 of 15 | 14 of 15 |

The rubric gives half credit to a correct card that does not answer the question. Counted strictly, Fred
fully answers 35 of the 60 answerable questions (58%).

## Where the other 25 fall short

| Cause | Count | Questions |
|---|---|---|
| A field card on the right topic that does not hold the answer | 7 | as-soaked, as-iodine, az-reflect, az-fastwater, az-leaves, az-cass, az-bend |
| The wrong field card | 1 | as-horse (bear card for horses) |
| The model's own answer is wrong, garbled or missing the point | 7 | as-green, as-tinder, as-melt, as-toofast, as-tickdryer, az-snap, az-bearspray |
| A quote that is near the question but does not answer it | 5 | as-smoke, as-crypto, as-antler, az-thick, az-bark |
| Search found nothing good enough | 3 | as-oakfire, az-dew, az-turnback |
| The model declined and nothing replaced it | 2 | as-fawn, az-layers |

Look-alikes answered: `la-drytime-01` got lines of the campfire card; `lz-snakeid-01` got a made-up list of
Arizona rattlesnakes written as steps (it names copperheads and cottonmouths).

## Would the manuals have done better than the card?

The eight card answers were asked again with card answers off (`CARD_ANSWER=off`,
`docs/c23/assembled-cards-off.jsonl`):

- Better without the card, 1: `az-bend-01` ("a straight stretch", though it says "SOURCE 2 states").
- Different, not checked against the source, 1: `az-leaves-01` ("at least 3 feet thick"; the key point
  says 6 to 12 inches, so one of the two is from a different passage).
- Worse without the card, 6: generic or invented advice (`as-soaked`, `az-reflect`), a wolf answer for
  horses, and `az-fastwater-01` saying a fast stream "may have higher risk", the opposite of the source.

So the cards are not hiding good answers. Where the card misses the question, the model mostly does worse.

## Reading

There is no single cause to fix. The misses are spread over cards that are too general, weak model answers,
near-miss quotes and search. Two things stand out:

- Quotes: in `as-crypto-01` the sentence that answers ("no known cure but time") sits two lines above the
  one quoted, in the same passage. Picking the closest sentence to the question is not the same as picking
  the sentence that answers it.
- The model: 7 of the 30 answers it wrote for answerable questions were wrong or incomplete, and it wrote
  the one made-up look-alike answer. This is the limit of the 1.7B model, not of the pipeline around it.

Grades: `docs/assembled-verdicts.json`, `docs/assembled-sealed-verdicts.json` (each verdict has a `cause`).

## Follow-up: can the quotes be made to answer more often? (2026-10-12)

Three ideas were tried on the quoted answers. One was kept.

**Where the answering sentence is, for the five off-target quotes**

| Question | Answering sentence | Rank by closeness to the question |
|---|---|---|
| as-smoke-01 | Same list item, two sentences before the one quoted | 13th (0.459 against 0.600) |
| as-crypto-01 | Same passage, two sentences before, in the paragraph above | 6th (0.493 against 0.656) |
| az-bark-01 | A different passage | 4th (0.538 against 0.595) |
| az-thick-01 | A different passage ("the diameter of the forearm at a minimum") | 9th (0.489 against 0.610) |
| as-antler-01 | A different passage ("please leave them where you find them") | 12th (0.438 against 0.595) |

So the answer was found by the search every time and lost when one sentence was chosen. A higher bar does
not separate good quotes from off-target ones: off-target quotes score 0.595 to 0.656, good ones 0.608 to 0.676.

**Rejected: let the model pick.** The model was shown the question and the six closest sentences and asked
for the number of the one that answers, or 0 (`docs/c23/quote-picker-*.txt`, about 2 s a call on the desktop).

- Off-target quotes fixed: 0 of 5. For the antler it picked "You want to take it home to show your nephew."
- Good quotes on the fresh sets made worse: 3 of 7 (rain, tarp stakes, crashed truck).
- On existing questions it answered "none" for the bison selfie and the hike-time quotes, both good, and
  picked a weaker line for the cougar and the moose.

The 1.7B model cannot judge which sentence answers a question any better than the similarity score does.

**Kept: quote the short paragraph the sentence sits in.** When the paragraph or list item around the chosen
sentence is 360 characters or less (about three sentences), all of it is quoted; otherwise the sentence alone,
as before. The choice of sentence does not change, so no decision changes: only the text of a quote.

Re-run with written answers on both fresh sets and the seven existing questions that get a quote: 97 replies,
84 identical, 13 quotes longer.

| | Count | Which |
|---|---|---|
| Now answers the question | 1 | as-smoke-01 (wind and route) |
| Same grade, more complete | 7 | as-eatsnow (melt it), as-rain (rain off leaves), az-wreckfire (safe distance), az-bike, elk, bison, cougar |
| Same grade, no better | 3 | as-crypto, as-antler, tick |
| Same grade, noisier | 2 | az-sandstake (opens with a sentence about a branch, but names the "dead man" method), az-thick (still the wrong passage, now two sentences of it) |
| Worse | 0 | |

Working set 35.5 → 36.0 of 45 (80.0%); sealed set unchanged at 35.5. No unsafe answer. The 360 limit was
chosen by eye on these quotes, and the gain in grade is one question, so this is a wording improvement to
text that is already reviewed, not a measured gain in accuracy.
Grades: `docs/assembled-paragraph-verdicts.json`, `docs/assembled-sealed-paragraph-verdicts.json`.

**One lead, not acted on.** The two answerable questions where the model declines and nothing replaces it
have a sentence that answers just under the quote bar of 0.57: `as-fawn-01` at 0.545 ("Leave the fawn alone…
its mother will return") and `az-layers-01` at 0.562. The nearest bad candidate among today's dead ends is
`he-cooktent-01` at 0.526. A bar of about 0.54 would pick up both, but that is two examples with a margin of
0.02, chosen after reading the answers. It needs questions nobody has looked at before it can be trusted.
