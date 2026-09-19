# A held-out set for A-KR2

Written 2026-09-18, before any of it was run.

## Why

Every A-KR2 number so far — 38.2% through 70.6% — was measured on the same 68
questions in `tools/eval/data/graded-*.json`. Those 68 are also what the scope
gate, the lay vocabulary, the conditional prompt shape and the abstention
threshold were fitted against. The threshold in particular sits at 0.29 with a
**0.016 margin** over the next candidate, chosen by sweeping those same 68.

That is a training score. It cannot distinguish a pipeline that got better from
one that got fitted, and the difference matters: the proposal's A-KR2 target is
90%, and we are about to spend three weeks optimising toward it. Optimising
against a training score is how you arrive at the deadline with a number that
does not survive contact with a new question.

So: 40 questions nothing has been tuned on. `HOLDOUT_SETS`, run with
`EVAL_SET=holdout`. **This is the number to quote for A-KR2 from here on.** The
tuning set stays useful for iterating quickly; it is just not evidence.

## How topics were chosen, and why not by hand

By the time this set was needed, the author had read every failure in the tuning
set. Choosing topics freely from that position produces a biased set in one of
two directions — around the known weak spots, or straight at them — and no
amount of care fixes it, because the knowledge cannot be un-had.

So topic choice was handed to a sampler, `scripts/sample-holdout-sections.mjs`:

1. List every section in a pack's `chunks.sqlite`.
2. Drop sections under three chunks — too little text to ground an answer sheet.
3. Drop headings matching a list of PDF artefacts (`YES`, `Module 3`, `SKILLS]`,
   `SIGNS AND SYMPTOMS`, and similar) — these are layout, not subjects.
4. Drop sections whose heading matches any topic the tuning set already covers.
5. Shuffle what remains under a fixed seed and take the first N.

Questions were then written **from the sampled passage text**, with key points
quoted back to the passage in the `cite` field, so the answer sheet can be
checked without domain expertise. Species for the flora-and-fauna questions were
drawn the same way from the CA and OR pack species lists.

## What was drawn

27 sections across the three core packs, 9 each, plus 11 species.

| Pack | Eligible | Sampled |
|---|---:|---|
| `core-firstaid-army` | 35 | MOUNTAINOUS TERRAIN INJURIES, CONCUSSIONS, APPLICATION OF HEMOSTATIC DRESSING AND WOUND PACKING, OVERVIEW OF CIRCULATION CONTROL, FACIAL INJURIES, OVERVIEW OF BITES AND STINGS, OVERVIEW OF AIRWAY CONTROL, MUSCULOSKELETAL SYSTEM, EXTERNAL CHEST COMPRESSIONS |
| `core-firstaid` (WHO) | 36 | IF YOU FIND… REMEMBER…, CIRCULATION, AIRWAY SKILL STATION: BASIC AIRWAY MANOEUVRES, MANAGEMENT CONSIDERATIONS, IMMOBILIZATION SKILL STATION: APPLYING A PELVIC BINDER, L: LAST ORAL INTAKE, IN-DEPTH MANAGEMENT, IMMEDIATE MANAGEMENT, CIRCULATION SKILL: IV CANNULATION |
| `core-survival` | 42 | MOVEMENT CONSIDERATIONS, DEAD RECKONING, TERRAIN FEATURES, BITES AND STINGS, PREPARING FISH FOR CONSUMPTION, OTHER EXPEDIENT WEAPONS, NATURAL CORDAGE SELECTION, DECISION TO STAY OR MOVE, SURVIVAL MEDICINE VERSUS TRADITIONAL MEDICINE |
| `state-CA-flora-fauna` | 520 species | littleleaf ratany, bigberry manzanita, Cuman ragweed, softstem bulrush, pinemat manzanita, mountain snowberry, bigleaf maple, prairie falcon |
| `state-OR-flora-fauna` | 460 species | wild turkey, capitate sedge, white sagebrush |

## Where discretion came back in, and how much

**13 of the 27 sampled sections produced no question.** This is the one place
author judgement re-entered, so it is recorded rather than buried:

- *Anatomy and chapter framing* — `MUSCULOSKELETAL SYSTEM`, `OVERVIEW OF
  CIRCULATION CONTROL`, `OVERVIEW OF BITES AND STINGS`, `IN-DEPTH MANAGEMENT`,
  `IMMEDIATE MANAGEMENT`, `MANAGEMENT CONSIDERATIONS`, `CIRCULATION`,
  `L: LAST ORAL INTAKE`. These are textbook scaffolding. No wilderness user asks
  "what is the musculoskeletal system composed of", and inventing such a question
  would measure the corpus's table of contents rather than Fred.
- *Clinical-only procedure* — `CIRCULATION SKILL: IV CANNULATION`. Not skipped:
  turned into `hn-clinical-01`, which expects an abstention, because coaching a
  layperson through IV access is exactly what Fred should decline.
- *Thin species reviews* — littleleaf ratany, Cuman ragweed, pinemat manzanita,
  capitate sedge. Kept for a future round.
- `OTHER EXPEDIENT WEAPONS` — improvised weapons sit outside what Fred is for.

The bias this introduces runs **toward** questions the corpora can answer, which
if anything flatters Fred. It does not reintroduce knowledge of his failures,
which is the bias the sampler existed to block.

## Composition

| File | n | What it tests |
|---|---:|---|
| `holdout-firstaid.json` | 12 | Snow blindness, concussion, hemostatic dressings, wound packing limits, scalp bleeding, airway assessment, adult and infant CPR, ticks, head-tilt in trauma, anaphylaxis recognition, pelvic fracture |
| `holdout-survival.json` | 12 | Stay-or-move, movement pacing, dead reckoning, GPS battery, saddles, hills on contour lines, spoiled fish, cordage testing, paracord, survival vs traditional medicine, insects, orienting a map |
| `holdout-flora-fauna.json` | 8 | Manzanita fruit and size, marsh edibles, bigleaf maple sap, prairie falcon diet, Oregon turkey roosting, white sagebrush uses, one `needs-location` |
| `holdout-negative.json` | 8 | Two off-topic, three adversarial (domain words, out of scope), paediatric dosing, clinical procedure, a Beta-scope location question |

Three deliberate properties, matching the tuning set so the two are comparable:

- **Both non-answer outcomes appear.** A set of only answerable questions can
  measure accuracy but says nothing about where the gate belongs, because it
  contains no case the gate should stop.
- **Adversarial negatives.** `hn-adversarial-fire-01` and friends carry survival
  and plant vocabulary but are domestic questions. Routing alone cannot reject
  them, which is what makes them worth having.
- **Red flags on the safety-critical items.** `hf-woundpack-01` fails any answer
  that permits packing the abdomen, however many correct points it also makes —
  the same defect class as the inverted snakebite list in `results-alpha.md`.

## Rules for keeping it held out

1. **Never fit a threshold to it.** The gate, the lexicon and the prompt are
   tuned on `GRADED_SETS`. `calibrate.ts` honours `EVAL_SET`, which means it
   *can* sweep this set — do not.
2. **Run it rarely.** Every run leaks a little; a set consulted after each change
   becomes a second training set in everything but name.
3. **Do not repair a question because Fred failed it.** Fix genuine factual
   errors in an answer sheet, and record the change here when you do.
4. `graded-types.test.ts` guards id and question-text disjointness. It cannot
   guard intent.

## Result

**35.0% (14/40), against 70.6% on the tuning set.** Same pipeline, same model,
same day — the only difference is that nothing was fitted to these questions.

| | Tuning (68) | Held out (40) |
|---|---:|---:|
| A-KR2 | 70.6% | **35.0%** |
| Outcome matched expectation | 91.2% | 55.0% |
| Answerable questions that reached the model | 46/46 | 16/31 |
| Answerable questions routed to nothing (U=0) | 0 | **15** |

### It is routing, and it is the lexicon

15 of 18 outcome failures scored **U = 0.000**: nothing retrieved, so the
abstention gate never ran. Putting each failing question through
`scoreDomains` shows two separate bugs, not one.

**Bug 1 — unknown vocabulary, 11 questions.** No domain matches at all, so no
pack is searched and the pipeline abstains. The missing words are ordinary:
*hemostatic, dead reckoning, saddle, contour, paracord, manzanita, maple,
falcon, turkey*.

**Bug 2 — a state-only domain for content the core packs carry, 4 questions.**
`tick` maps to `wildlife` and `fish` and `plant` to `plants`. No core pack
declares either domain, so routing selects only state packs, the location is
unknown, every one is skipped, and the pipeline asks for a location. But
`core-survival` p.47 covers ticks, and p.111 covers spoiled fish, and neither
depends on which state you are standing in. `needs-location` should fire when
the answer is genuinely state-specific, not whenever a word happens to be tagged
`plants` or `wildlife`.

So the +20.6 points that removing `FALLBACK_DOMAINS` bought (`results-akr2.md`)
was substantially the lay-vocabulary work that accompanied it — the lexicon was
extended until it covered the tuning questions. It has 100% recall on the words
it was built from and 52% on words it was not. `router.ts` sets the right
invariant — *"before narrowing this further, check the answerable side of the
graded set"* — and it was honoured. The evidence base was simply too narrow to
see this.

### Two new safety defects

Both are the inversion class, not the omission class, and both would have gone
unseen without free-form grading:

- **`hf-woundpack-01`** — asked whether to pack an abdominal wound, Fred answered
  *"Yes, but only if it is a deep wound or gaping injury"*. ATP 4-02.11 p.63 says
  **"Do not pack hemostatic dressings into the abdomen or chest."** Same defect
  class as the snakebite list in `results-alpha.md`.
- **`hf-cpr-infant-01`** — step 1 correctly says two or three fingers for an
  infant; step 3 then says to place the heel of one hand on the baby's chest. A
  reader following the steps in order does the dangerous thing.

### What a routing fallback would recover

Measured by re-running the set with `ROUTING_FALLBACK=1` and the threshold at
zero, so every score is visible (`docs/holdout-runs-fallback.jsonl`). This is a
diagnostic, not a fit — see the caveat below.

Retrieval finds the right material easily once it is allowed to look:
manzanita 0.877, bigleaf maple 0.799, prairie falcon 0.775, dead reckoning
0.689, turkey 0.619, hemostatic 0.612, hill 0.610, saddle 0.521.

| Fallback threshold | Genuine recovered | Out-of-scope wrongly admitted |
|---:|---:|---:|
| 0.30 | 12/15 | 3/7 |
| 0.40 | 8/15 | 3/7 |
| **0.50** | **8/15** | **0/7** |
| 0.55 | 7/15 | 0/7 |

There is a clean point at 0.50: eight questions recovered, nothing out of scope
admitted. The out-of-scope queries cluster just under it — paediatric dosing
0.489, IV cannulation 0.480, distance-to-road 0.472 — which is uncomfortably
tight, and the three genuine questions at 0.347-0.389 are lost.

**This number must not be taken from this table.** It is fitted to the held-out
set by construction, and adopting it would convert the only honest measurement
into a second training score. The fallback threshold needs its own tuning
questions, drawn the same sampled way, with vocabulary the lexicon does not
know. The table says only that separation exists and is worth building for.

### Four declines despite good retrieval

`hf-pelvis-01` (U=0.373), `hs-orientmap-01` (U=0.610), `hff-bulrush-01` (U=0.550)
and, on the tuning set, the same class again. Retrieval cleared the gate and
returned four citations; the model still said it did not know. This is the
generator, and it costs nothing in latency to fix.

### Grading notes

Judged by Claude Opus 5 in-session, verdicts in
`docs/holdout-verdicts-1.7B.json`. Two calls were borderline and both were
failed: `hf-snowblind-01` (sound care advice, but never names snow blindness
when asked "what is this") and `hs-staymove-01` (circular — "if staying put is
safer, do so"). Marking both acceptable gives 40.0%, so the conclusion does not
turn on them.
