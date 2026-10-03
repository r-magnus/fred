# Plan: answers that stay with their sources

2026-10-03. From the review after #115 (#117, #118): three weaknesses, fixed
without new model calls, without longer prompts and without more field cards.

## The weaknesses

1. **Declines with the answering passage in hand.** The model is told to say
   "I don't have reliable information" when its sources don't answer, and
   reads that literally: "is it ok to walk up to the bison for a selfie" with
   Yellowstone's "Stay at least 25 yards away from bison" in the prompt; how
   long to wait after thunder; a saguaro's height.
2. **Uneven species facts.** Wrong numbers ("black spruce... 30 to 60
   meters"; the boiling altitude blended to 8,000 ft under an EPA citation)
   and facts from the wrong section ("the elk rut... in late spring to early
   summer").
3. **No source.** Stuck on a ledge (a danger sign since #115, which gets only
   the general safety net), treating sunburn, chafing.

## What to build, in order

### 1. Sentence index (the shared groundwork)

Each core pack gets a vector per sentence of every passage, built at ingest
by a post-processing step that adds files beside an existing pack (the
passages themselves are untouched, so retrieval cannot move): `sentences.i8`,
one row per sentence in passage order, and the sentence split, which is a
fixed function in `rag-core` used at ingest and at run time alike. To keep
size down the rows use the first 256 of EmbeddingGemma's 768 dimensions
(Matryoshka-trained, so a truncated, re-normalised vector keeps most of its
quality): about 3-4 MB over the core packs. State packs are left out for now.

### 2. The number check

A sentence of a model-written answer that states a number not found in any
passage it was given is the model's own: "30 to 60 meters", "8,000 feet". The
answer streams as now; only a sentence with a digit in it is held until it
ends and checked. If a number has no source, the answer is replaced by the
quoted source sentences (step 3). No model call; nothing slower for answers
without numbers.

### 3. Quote the source instead of declining

When the model declines but the search cleared the answer gate, Fred shows
the one or two sentences of the retrieved passages closest to the question,
verbatim, with their source, instead of "I don't have reliable information".
Nothing is written, so nothing is invented; the condition and exposure guards
still apply. A floor on sentence similarity, set on seen questions only, keeps
weak matches out (then the decline stands).

### 4. Section matching for species questions

FEIS reviews have fixed sections. A question's form says which one answers
it: looks like, how tall → Botanical Description; where → General
Distribution, Site Characteristics; eats, eaten by → Diet, Importance to
Wildlife; when → Timing of Major Life History Events. State-pack passages from
the matching section go first among state-pack passages in the prompt. Order
only: no score changes, no gate changes.

### 5. Stuck on a ledge

The ledge danger sign opens the signalling card (stay put, whistle, light,
bright clothing) rather than the general safety net: reviewed text that fits.
Sunburn treatment and chafing stay gaps: no free-to-use source (Wikivoyage's
sunburn section, already in the tips pack, is prevention only).

## How it is tested

- Each step's questions are written before its code: the misses above are
  already in the health, wildlife, hazards and state sets (seen, so tuning);
  a fresh confirmation set is written before step 3's floor is set.
- After each step, every set's decisions, then the changed answers graded
  blind; generated chat runs for anything touching the guards.
- Ships only if: no new unsafe answer, no set worse, first words on the phone
  unchanged for answers without numbers.
