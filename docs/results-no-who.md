# Fred without WHO (#33, #214)

2026-11-13. Decision and licence register: `licensing.md`, "Release decision".

**Short version: the WHO first-aid pack can come out with no measurable cost.
On 97 questions (40 held out, 57 breadth), taking it out changes one answer,
at the same score. With two public-domain trial packs added, one more answer
changes, for the better. Fred's real dependence on WHO is the field cards:
11 cards quote it, and a commercial build has to re-back them first.**

## Why this was measured

WHO *Basic Emergency Care* (`core-firstaid`, 601 passages) is CC BY-NC-SA 3.0
IGO: a free release may ship it, a paid one may not. The first release is
free (Ryan, 2026-11-13), but a later one must not depend on WHO. This
measures what WHO is worth to Fred today and what replaces it.

## What was run

Three runs of the held-out (40) and breadth (57) sets, generated answers,
settings as the app ships (`INTENT=1 STATE=CA`, scope scorer, card matcher,
`VOICE=1`), code at `ddd453d`, one run at a time:

| Run | Packs |
|---|---|
| with WHO | `~/fred-packs-g-all`, as on the phone |
| without WHO | the same, minus `core-firstaid` |
| replaced | without WHO, plus `core-firstaid-usphs` and `core-firstaid-pd` |

The trial packs, both public domain and built from this branch:

| Pack | Source | Passages |
|---|---|---:|
| `core-firstaid-usphs` 0.1.1 | US Public Health Service, *The Ship's Medicine Chest and Medical Aid at Sea* (2003, govinfo.gov): heat and cold illness, wound care, dental emergencies, cold water and near-drowning. Tourniquet, drug, IV, injection and suturing passages left out. | 54 |
| `core-firstaid-pd` 0.1.1 | CDC *First Aid for Seizures*, *Low Blood Sugar*, *Treatment of Low Blood Sugar*, *Signs and Symptoms of Stroke*; NHLBI *Heart Attack: Symptoms* | 37 |

Pages were chosen from the field cards that quote WHO most, before any run.

## Results

| | Held out (40) | Breadth (57) |
|---|---|---|
| Answers changed without WHO | 0 | 1 (br-tq-01, same score) |
| Answers changed, replaced | 0 | 2 (br-tq-01 same score; br-maggots-01 0 → 0.5) |
| Safety failures | none new | none new |

Graded blind (`no-who-verdicts.json`). Every other answer is word for word
the same in all three runs. Runs: `no-who-runs-*.jsonl`.

**Why so little moves.** WHO passages reached the top four in 13 of the 97
questions with WHO installed. In 12 of them the reply did not come from the
passage: a field card answered (anaphylaxis, pelvis, diabetic, CPR, choking,
a child's belly wound, rattlesnake), Fred declined on purpose (dose and
clinical-procedure questions, which is most of what WHO is about), or Fred
declined in all three runs (hs-survmed-01, a known miss). Only the
tourniquet question was written by the model from a WHO passage; without it,
the bleeding card answers instead.

The absolute held-out score is not re-stated here. These runs place the hiker
in California (`STATE=CA`, as the phone does once it has a fix); the 73.8% run
of 2026-10-06 had no state, and two answers differ for that reason alone
(hff-nostate-01 now answers for California; hn-adversarial-plant-01 now
declines rather than asking for a location). Both are identical in all three
runs here.

## What still needs WHO: the field cards

The card pack is marked nonCommercial because cards quote WHO (`cards.ts`,
`cardsLicense`). Its WHO quotes, and how many have a public-domain sentence
already in Fred's packs sharing at least half their key words (a rough lexical
check; it misses rewordings such as WHO's "Do not place anything in the
mouth" against CDC's "Don't put anything in their mouth"):

| Card | WHO quotes | Close match found |
|---|---:|---:|
| spinal-injury | 11 of 16 | 1 |
| pelvis-injury | 10 of 12 | 1 |
| seizure | 8 of 8 | 1 (CDC page now covers most steps) |
| low-blood-sugar | 6 of 7 | 3 |
| heart-stroke | 6 of 7 | 3 |
| snakebite | 5 of 15 | 1 |
| bleeding-soaked | 3 of 5 | 1 |
| choking | 3 of 18 | 0 |
| unresponsive | 2 of 10 | 0 |
| dehydration | 2 of 17 | 0 |
| anaphylaxis | 1 of 13 | 0 |

Seizure, low blood sugar, and heart attack and stroke can be re-backed from the
new CDC and NHLBI pages. Choking, unresponsive, dehydration, anaphylaxis and
snakebite quote WHO for a step or two and are mostly Army-backed already.
**Spinal and pelvis are the hard part:** no public-domain source found so far
covers them for a lay rescuer. The Navy *Hospital Corpsman* manual (NAVEDTRA
14295, public release) is the next candidate; its only clean copy found is on
irp.fas.org, which challenges automated downloads, so it was not fetched.

## Sources looked at and not used

- *Ship's Medicine Chest*, the rest of the book: chapters on examination, IV
  and injection technique, ship sanitation, the law, and appendices that list
  training topics without instructions.
- WHO *Psychological First Aid*: listed in the licence register but never
  shipped; no pack or card uses it, so there is nothing to replace.

## Built so a paid release stays possible

- `COMMERCIAL=1 node scripts/build-core-bundle.mjs` leaves out every pack with
  a nonCommercial licence entry, and refuses while the field cards are one of
  them. On today's packs it refuses, naming the cards. Tested
  (`tools/ingest/test/core-bundle.test.ts`).
- The card pack's licence follows what the cards quote, so it becomes
  commercial-safe on the build after the last WHO quote is replaced.

## Next

1. Re-back the 11 cards (#214): seizure, low blood sugar, heart attack and
   stroke first, from the new pages; then the cards with a step or two.
   Each change gets a self-review and the quote check, as usual.
2. Find a lay source for spinal and pelvis care (Navy corpsman manual, fetched
   by hand from a browser).
3. Decide whether the trial packs ship. Neither costs anything measured, and
   `core-firstaid-pd` is what the re-backed cards would quote.

## Nine cards re-backed (2026-11-13, field cards 0.10.0)

Nine of the eleven cards no longer quote WHO; spinal and pelvis still do
(21 quotes between them). Every new quote is checked word for word at build
time; each card has a self-review entry (`corpora/cards/self-reviews.json`)
and the review page shows the new wording.

| Card | Now backed by | Wording |
|---|---|---|
| seizure | CDC *First Aid for Seizures*, ATP 4-02.11 pp.125, 138 | rewritten: 5-minute rule, soft pad under the head, no food or water until alert, CDC's call-for-help list; "don't hold them down" now sourced |
| low-blood-sugar | CDC *Low Blood Sugar*, *Treatment of Low Blood Sugar*, ATP 3-50.21 p.29 | rewritten: trail causes (activity, heat, altitude), fast-sugar foods, the 15-minute recheck, the follow-up snack |
| heart-stroke | NHLBI, CDC stroke and low blood sugar pages, ATP 3-50.21 p.29 | kept (two clauses the new sources don't state dropped) |
| bleeding-soaked | ATP 4-02.11 pp.65, 71 | adds "for at least 3 minutes" |
| snakebite | ATP 4-02.11 p.178, Ship's Medicine Chest p.60 | the snake photo dropped: the newer Army manual says not to try to identify it |
| unresponsive | ATP 4-02.11 pp.78-79, 89, 138 | recovery position as the Army describes it |
| choking | ATP 4-02.11 pp.81, 94 | identical text; the back-blow how-to and the infant steps have no public-domain quote yet |
| anaphylaxis, dehydration | ATP 4-02.11 pp.79, 195; NIDDK | identical text |

The card pack's licence list is now built from the sources the cards quote
(12 entries, from each source's own pack), not a fixed list.

**The CDC/NIH and Ship's Medicine Chest packs do not ship.** The cards quote
them, but quotes are checked when the cards are built, so the packs need not
be on the phone. Installed, the CDC pages sat close behind the cards on the
same topics and took the card answer away three times (a model answer
instead). The Ship's Medicine Chest pack has run-together capitalised
headings and clinical steps a hiker should not attempt (trimming skin flaps,
removing dead tissue from burns).

### Measured

Baseline: the phone's packs (`~/fred-runs/phone-1018/packs`, field cards
0.9.0). New: the same with field cards 0.10.0. Code at `f346b6a`.

- **Decision sweep, 29 sets, 1,129 replies:** one card choice changed. "the
  bandage got wet in the creek and it opened up again" (held out, a second
  turn that accepts any card) now gets the soaked-bandage card instead of the
  cut card; reasonable for a cut that reopened, not unsafe.
  `cards-reback-sweep-diff.txt`.
- **Generated held-out (40) and breadth (57):** six answers changed, each the
  new card text: unresponsive twice (recovery position), low blood sugar,
  soaked bandage, rattlesnake, choking. None worse; low blood sugar fuller.
  The choking change put the back-blow how-to after the don'ts and was
  undone, so the card reads as before. `cards-reback-gen-*.jsonl`.

### Caught on the way, and fixed

1. **Unsourced lines are read out.** Fred says a card's unsourced lines at
   the end of the card. Listing fragments of existing steps there repeated
   them, and the repeats moved "guy here stopped breathing, help" from the
   CPR card to the choking card. Each unsourced line is now a sentence of its
   own.
2. **A longer card loses its questions.** A fuller heart and stroke card
   (heart attack signs, the face-arm-speech check, noting the time) fell from
   0.326 to 0.293 on a held-out chest-pain question, under the 0.32 a card
   needs to be shown as written; the model answer then advised against
   aspirin, against the NHLBI page. The old wording is kept on the new
   sources. Richer card content belongs in its own measured change, tried on
   fresh questions, not inside a re-sourcing.

## Spine and pelvis re-backed (2026-11-14, field cards 0.11.0)

**No field card quotes WHO any more.** The card pack's licence entry is now
public domain (`nonCommercial: false`), so a commercial bundle can ship it.

| Card | WHO quotes replaced | Now backed by |
|---|---:|---|
| spinal-injury | 11 | ATP 4-02.11 pp.75, 77, 121, 124-127, 151-153; Navy *Hospital Corpsman* NAVEDTRA 14295 (2000) pp.146, 192-193; JTS spine guideline (2020) p.7 |
| pelvis-injury | 10 | Navy NAVEDTRA 14295 p.193; ATP 4-02.11 pp.75, 100, 124; JTS *Pelvic Fracture Care* (2026) pp.4, 7 |

Card text is unchanged: only quotes and reviewer notes moved. The built card
pack's passages and vectors are byte-identical to 0.10.0; only the licence
and credit lines in the manifest differ. So retrieval, card choice and
answers cannot change, and no sweep was run.

**Sources.** The Navy manual's clean copy was found on archive.org (marked
public domain, Distribution Statement A), not irp.fas.org. The JTS guidelines
are Defense Health Agency documents written by military officers. All three
go into build-time packs (`core-firstaid-navy`, `core-firstaid-jts-pelvic`,
`core-firstaid-jts-spine`) that the quote check reads and that do not ship.

**Where the sources disagree.**
- The Navy manual (2000) predates pelvic wraps: it pads between the legs and
  ties them together. The 2026 guideline uses a binder or sheet. The newer
  source wins, and the card keeps its wrap.
- The Army manual (2026) slips a towel roll under the neck; the Navy manual
  says not to pad under the neck or head. The card says neither.

**Not worded in the new sources, kept as reviewed before** (noted in each
card's reviewer note): "tingling" as a sign (numbness and weakness are
sourced); "if they vomit" as a reason to roll (rolling as a unit is
sourced); how to place the sheet (centred on the hip bones, crossed at the
front, firm but not very painful); and "don't press or rock the hips".
