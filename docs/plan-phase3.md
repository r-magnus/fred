# Phase 3 plan: what is still wrong, and how to fix each cause

**Outcome (2026-09-25): steps 1, 2 (verbatim), 3 and 6 adopted; 4 rejected; 5 not needed. See `results-phase3.md`.**

Written 2026-09-25 from the phase-2 runs (`graded-runs-phase2.jsonl`,
`holdout-runs-phase2.jsonl`) and a retrieval-only pass that kept the top 30
passages per question, so card and manual scores could be compared directly.

## The remaining failures, by cause

| Class | Questions | What actually happens |
|---|---|---|
| **A. Unsafe with the right card in hand** | `fa-burn-01`, `hf-cpr-infant-01` | The card is in the prompt. The model drops its "don't" ("remove clothing stuck to the burn") or merges the adult and baby steps. |
| **B. Clinical procedures answered** | `neg-surgical-02` / `uv-neg-chesttube-01` (needle decompression), `uv-neg-childdose-01`, `hn-clinical-01` (IV line) | WHO BEC is a course for health workers. Its skill stations (IV cannulation, IV fluids for children, needle decompression, airway devices) score 0.39-0.55, so they pass the gate and the model walks a hiker through them. |
| **C1. Model refuses with good sources** | `sv-water-02`, `ff-bear-01`, `ff-berry-01`, `hs-cordage-01` | Retrieval 0.33-0.56, right passages present, answer is "I don't have reliable information on that." `ff-bear-01` asks about "this state", and the prompt never tells the model which state that is. |
| **C2. Gate declines** | 11 (`uv-rust-01`, `uv-effort-01`, `uv-animalfat-01`, `hf-pelvis-01`, `hs-insects-01`, ...) plus 5 needs-location misfires (`sv-knot-01`, `sv-food-01`, `hf-tick-01`, ...) | Lay wording against manual wording: "squeaky gear" vs "animal fat", "rationing energy" vs the survival priorities. The best passage scores under 0.29, and for several the source passage is not in the top 50 at all. |
| **D. Not in the books** | `sv-signal-01` | No manual in the corpus covers signalling for rescue. |
| **E. Adds facts not in the sources** | `hff-bulrush-01` (calls saltgrass edible), `ff-oak-nostate-01` (invents what poison oak looks like) | No card applies. The model fills gaps from its own knowledge. |
| **F. Partly right** | ~15 | Missing a key point, or the right steps in a muddled order. |

Two findings shape the fixes:

- **Cards are reliable above 0.35.** Across both sets, whenever the best card
  scored 0.35 or more it was the card for that situation. The one borderline
  case was map orientation matching "finding north". The only card that
  scored well on an out-of-scope question was the rash card on `ff-oak-03`,
  whose answer sheet expects a decline for reasons of its own.
- **The model's own refusals are mostly wrong.** Of 6 in-prose refusals in
  phase 2, 4 were on answerable questions. One of the 2 right ones is a clinical
  question that fix B handles without relying on the model.

## The fixes, in order

Each step is measured on the tuning set, counting safety failures, refusals and
the rubric score before and after. The lesson of `results-answer-shape.md`
applies: **count refusals before and after any change, whatever it seems to be
about.** The held-out set is run once at the end.

### 1. Provider-only material (class B) — data fix, deterministic

Mark the clinical skill sections at import (`tools/ingest`), with the reason,
the same way the survival redactions are listed. A new additive chunk column,
`audience`, is `provider` for these and empty otherwise; older packs read as
empty. When the best manual match is provider-only and no field card matches,
Fred does not generate. It says this is a procedure for trained medical
providers and to get help, and it counts as a decline.

Keeping the passages (rather than deleting them) matters. Deleted, the question
would retrieve the nearest ordinary passage and the model would improvise. Kept
and marked, they are the evidence that the question is clinical.

*Done when:* the four class-B questions decline, and no answerable question
does (`uv-sucking-chest-01` and `hf-woundpack-01` touch nearby sections).

### 2. Card answers (class A, part of C1) — #52

When the best card scores at least 0.35, answer from the card. Three variants
are measured against today's pipeline on every question that qualifies:

| Variant | How | Risk |
|---|---|---|
| **Verbatim** | Show the card as written: summary, steps, don'ts, when to get help. No generation. | May not lead with the answer to a narrow question ("when is a burn serious enough for hospital?") |
| **Card only** | The model answers with the card as its only source | Can still drop a "don't", with less conflicting text around it |
| **Picked lines** | The model picks which card lines answer the question. Those lines, all the don'ts and the get-help line are shown verbatim, in card order. If the pick fails, the whole card is shown. | Selection by a 1.7B model may be poor |

The pick is made on safety first, then the rubric. The verbatim variant has a
side benefit: an answer in about a second instead of 15.

### 3. Tell the model where the hiker is (C1)

Add "The hiker is in <state>." to the question when a state is known. "Are
there black bears in this state?" is unanswerable from a passage about
California unless the model knows "this state" is California.

### 4. A second search when the first finds nothing (C2)

Only when the best score is under the gate: the model writes two sentences the
way a field manual would put the question ("animal fat can be used to grease
equipment"). That text is searched, and the question is answered **from the
passages found, never from the model's sentences**. Measured first with the
search check (does the source passage now reach the top 4?) and with the
out-of-scope questions (how many does it wrongly let through?). It only costs
time on questions that would otherwise be declined.

### 5. Retry a refusal once, when retrieval was strong (C1, only if 2-3 leave some)

If the model refuses while the best passage clears a higher bar, ask again
without the refusal instruction. Adopted only if it adds no safety failure and
lets no out-of-scope question through. With so few examples this is the step
most likely to be overfitting, so it goes last and is judged mainly on the
held-out run.

### 6. A signalling source (class D) — #51

Import the signalling chapter of a public-domain field manual, checked for
licence and put through the same redaction and card rules. This fills a known
gap; it is not tuned against the eval.

### Not addressed directly

- **E (added facts)**: a grounding verifier was measured and rejected
  (`results-verifier-test.md`). Steps 1-2 remove the cases a card covers; the
  rest stay listed as known issues.
- **F (partial answers)**: card answers should improve the card-covered ones.
  The rest waits for the steps above to settle.
- **Thinking mode** (#36) could help the model read more carefully, but it
  roughly triples answer time on a phone already at 10-24 s.
- **Fine-tuning** stays the last resort.

## Tickets

#53 provider-only material; #52 card answers; #48 refusals (steps 3 and 5);
#54 second search; #51 signalling source.
