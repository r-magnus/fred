# Plain-language phrasings on field cards, and card sources in the app

2026-09-28. Two requests: help Fred match the way people actually talk to the
right field card, and show the manuals each card comes from.

**Short version: the phrasings were measured and rejected. Casual messages
mostly reach the right card already, and adding phrasings made answers
slightly worse. Card sources ship: the app now shows the manuals and pages
under every card.**

## A test set written first

`tools/eval/data/holdout-colloquial.json`: 36 casual first-person messages
("ow ow ow touched the camp stove grate with my fingers"), 30 on field-card
topics and 6 out of scope. It was committed before any phrasing was written,
and `cards-leak.test.ts` covers it, so no phrasing can copy one of its
messages.

## Phrasings added to the cards: worse

Each card got five or six plain descriptions of its situation (230 in all,
self-reviewed for fit: each describes a case the card's own advice covers,
and none copies a test question). Only `askedAs` changed; the summaries,
steps, don'ts and quotes were untouched. The card pack was rebuilt and run on
the colloquial, tuning and breadth sets.

Only 5 answers in 197 changed. Graded blind (`phrasing-verdicts.json`,
`phrasing-runs-*.jsonl`):

| | Before | With phrasings |
|---|---:|---:|
| 5 changed answers | 3.0 | 1.5 |

1 win (the blood-soaked gauze got an answer instead of an offered card).
3 losses: a plain splinting question lost the fracture card, "is it worth
nibbling an unknown plant?" got a weaker answer, and the dislocated shoulder
became a refusal.

Why so little moved: each card is searched as **one blended vector** of its
text plus all its phrasings. More phrasings smudge it rather than add new
ways in.

## Why casual messages fail, when they do

From the baseline run on the colloquial set, 30 on-topic messages:

| | Messages |
|---|---:|
| Right card, shown word for word | 22 |
| Right card, just under the cutoff (offered, not shown) | 4 (soaked gauze, creek water, eye, shelter) |
| Wrong card | 3 (two burns got the campfire card; a seizure got the **shock** card) |
| Nothing close | 1 (lost) |

Wording isn't the main problem. An offline check scored every card against
every message with no generation. Today's cards put the right card first for
28 of 30. A vector per phrasing (best-of) gets 29: it fixes both burns and the
seizure, but sends the sting message to the tick card, and makes 17 of 35
out-of-scope questions look like a card match instead of 14. Mixed, so not
built.

**The seizure → shock card mismatch is a real defect** (a collapsed, jerking
person gets shock treatment). It's worth fixing on its own, in the shock or
seizure card's wording, and measured like everything else.

## Card sources in the app

The card pack's manifest now carries, per card, the manuals and pages its
quotes come from (`cardSources`, built from the same quotes `validateCards`
checks word for word). Card citations carry them (`Citation.basis`), and the
app shows them under the card:

    Fred field card — Burns
       from ATP 3-50.21 Survival 2018 p. 28 · ATP 4-02.11 First Aid 2026 pp. 129, 132

`core-fieldcards` 0.5.0 has search vectors identical to 0.4.0, so no answer
can change.
