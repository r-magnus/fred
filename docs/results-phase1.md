# Phase 1 and 2: search, trimming, field cards, and the phone

Work from 2026-09-23/24, following the plan in `results-strategy-research.md`.
Everything is measured on the 100-question tuning set unless it says otherwise.
The held-out set was not touched.

**Short version: the search and trimming fixes are real but small on their own.
The biggest single gain in search is EmbeddingGemma with pure meaning-based
ranking: +10 points on "the right passage is among the four Fred reads". The
paragraph-aware passage cutting I expected to help did not, and is off. Gemma 4
E2B does not fit on the phone. Q4_0 weights are a clear speed win.**

## End to end, on the four-part rubric

The new pipeline is EmbeddingGemma, meaning-only ranking (`ALPHA=1.0`), the
whole question embedded, 20 nearest passages per pack added (`DENSE_POOL=20`),
trimming off (`COMPRESS=0`), and the 27-card pack. The model and prompt are
unchanged (Qwen3-1.7B Q4_K_M). The decline threshold was re-fitted on the tuning
set and landed at 0.293, so 0.29 stays.

Both pipelines were graded by the same grader (Claude, in-session) on the same
rubric, in the same sitting. The old answers were re-graded rather than reusing
their yes/no verdicts, and out-of-scope questions Fred answered anyway were
judged for safety in both. Grader caveat: I knew which run was which.

**Held-out set** (40 questions, never tuned on, run once):

| | Old | New |
|---|---:|---:|
| Rubric score | 20.0 / 40 (50.0%) | **25.0 / 40 (62.5%)** |
| Safety failures | 4 | **3** |
| Fully right | 13 | **19** |
| Partly right | 12 | 4 |
| Wrong | 1 | 0 |
| Declined an answerable question | 3 | 6 |
| Sounds like Fred | 26/30 | 24/26 |

**Tuning set** (100 questions; the cards' topics overlap it, so read with care):

| | Old | New |
|---|---:|---:|
| Rubric score | 38.5 / 100 | **64.0 / 100** |
| Safety failures | 14 | **7** |
| Fully right | 31 | 35 |
| Wrong | 8 | 2 |
| Declined an answerable question | 7 | 12 |
| Out-of-scope questions correctly declined | 17 | 31 |
| Desktop answer time, mean | 10.5 s | 14.7 s |

What changed, in plain terms:

- **The old safety inversions are gone** where a card or the right passage
  reached the model: choking (`fa-choke-01`), wound packing in the belly
  (`hf-woundpack-01`), the soaked bandage (`fa-bleed-02`), the thin sleeping bag
  (`sv-hypo-prevent-01`).
- **Fred declines more out-of-scope questions** (cricothyrotomy, amputation,
  belay knots). Search scores for off-topic questions came out lower with the
  new search model.
- **The cost is more wrongful declines** (tuning 7 → 12, held-out 3 → 6), mostly
  obscure survival facts (animal fat as grease, smoke fumigation, cordage
  testing) where the new search scores sit just under the threshold.
- **Remaining safety failures share a cause.** The card that would have
  prevented them was not among the four passages the model read
  (`fa-bleed-01`, `uv-ingestion-01`), or the card itself mixes adult and infant
  hand positions (`hf-cpr-infant-01`). Both are fixable in the data: give cards a
  reserved slot, and split the CPR card's adult and infant steps.
- **Answers are slower on desktop** (10.5 s → 14.7 s mean) because untrimmed
  prompts are longer. Q4_0 (§6) should give back most of that on the phone.

## 1. The search check (new tool)

`node tools/eval/src/search-check.ts` answers, for each of the 49 answerable
tuning questions whose answer sheet quotes its source: is that source passage in
the corpus, in the top 50, in the top 4, and still there after trimming? It
needs no model and no grader and takes about ten seconds. Settings come from
`RETRIEVAL_QUERY`, `DENSE_POOL`, `ALPHA`, `TOPK`, `COMPRESS` and `PACKS_DIR`
(`retrieval-env.ts`).

## 2. Trimming ("compression")

The trimmer treated every PDF line break as a sentence end, so it dropped lines
of the page rather than sentences. Fixed in `compress.ts`: a line break ends a
sentence only at punctuation, a list item, a numbered paragraph or a heading,
and a sentence carrying "not / never / avoid / caution / warning" is never
dropped.

| | Before | After |
|---|---:|---:|
| Answered questions where trimming broke a "do not / never / avoid" phrase | 10 of 48 | **2 of 48** |
| Context tokens per answer | 898 → 726 | 890 → 727 |

It still removes the answer's source passage on some questions, because it picks
sentences by word overlap with the question: the same lay-word vs manual-word
problem as search. With trimming off, 5 more questions (28 vs 23 of 49) have
their source passage in the prompt, at a cost of about 170 prompt tokens.

**What 170 tokens cost on the phone** (measured, llama-bench, Qwen3-1.7B Q4_K_M,
8 threads): prompt reading is 142 tokens/s, so about 1.2 s. With Q4_0 weights
(§6) it is about 0.9 s.

## 3. Search

| Change (gte-small, all packs) | Top 50 | Top 10 | Top 4 |
|---|---:|---:|---:|
| Shipping: keyword list embedded, keyword candidates only | 78% | 61% | 53% |
| Embed the question as asked | 80% | 61% | 55% |
| + 20 nearest-by-meaning passages per pack added to the candidates | 90% | 63% | 57% |

Searching everything by meaning finds the right passage much more often (top 50
up by 12 points), but the 60/40 meaning/keyword blend that picks the final four
barely moves. The blend is the bottleneck, and with gte-small, weighting meaning
more does not help the top 4 (22/49 at every weight on the core packs).

### EmbeddingGemma-300M

Same passages (core packs, fixed windows), core packs only for both:

| Search model | Blend (meaning weight) | Top 10 | Top 4 |
|---|---:|---:|---:|
| gte-small | 0.6 / 0.8 / 1.0 | 51% / 57% / 59% | 45% / 45% / 45% |
| EmbeddingGemma | 0.6 | 59% | 49% |
| EmbeddingGemma | 0.8 | 59% | 51% |
| **EmbeddingGemma** | **1.0** | **61%** | **55%** |

EmbeddingGemma with pure meaning ranking: **27 of 49 vs 22**. The phone's
llama.rn 0.12.9 supports the architecture; device parity is not yet checked.

Packs now record the search model and its question wrapper
(`EmbeddingSpec.queryTemplate`), and the desktop tools pick the matching model
file from the pack instead of hard-coding gte-small in six places.

## 4. Passage cutting: tried, not adopted

`chunkByStructure` cuts at the manuals' numbered paragraphs and headings, keeps
lists with their header, and drops figure captions.

| | Fixed windows | Structure |
|---|---:|---:|
| Passages starting mid-sentence (army / WHO / survival) | 55% / 37% / 67% | **3% / 1% / 7%** |
| Right passage in top 4 (EmbeddingGemma, meaning-only) | **27/49** | 21/49 |
| ... at an equal token budget (top 5, 1,040 tokens) | 27/49 | 23/49 |

The windows overlap, so the same text sits in two or three passages. That gives
search more chances, and it also wastes slots: 16 of 62 answerable questions got
near-duplicate passages in their top 4, against 9 with structure cutting. On the
evidence, clean passages search worse. Kept as `CHUNKING=structure`; the default
stays windows. Readable text for the model is the field cards' job.

## 5. Field cards

26 cards so far, each a plain-language answer for one situation from the
standard wilderness first-aid and survival curriculum (a topic list written
without reference to the test questions). **Every card cites verbatim quotes**,
332 in total, and `tools/ingest/src/check-cards.ts` refuses to build a card whose
quote is not in the named source within two pages. `cards-pack.ts` builds them
into `core-fieldcards`, one card per passage. With `CARDS=approved`, only cards
Ryan approved at their current revision are included.

**Review page:** https://claude.ai/artifact/9FpqGtywLL3U3u8hurV3P6 shows each
card next to its quotes, with approve / request-changes and a note. A card
edited after review is flagged "changed since your review".

**A leak, caught and closed.** The first cards' "found when someone asks"
phrasings echoed tuning questions nearly word for word, because I had read that
set. That would have inflated the tuning score for the wrong reason. 17
phrasings were rewritten as generic topic names, and
`tools/ingest/test/cards-leak.test.ts` now fails if any phrasing shares half its
content words with any tuning or held-out question. The topics themselves still
cover questions in the tuning set, so **the held-out set is the honest measure of
the cards**.

### Where the manuals and our answer sheets disagree

Found while writing cards. Each is flagged on its card for Ryan to rule on:

| Question | Answer sheet says | Manual says |
|---|---|---|
| `fa-ankle-01` sprain | remove footwear | "leave the boot on a sprained ankle unless circulation is compromised" (ATP 3-50.21 p.45) |
| `fa-bleed-01` bleeding | elevating the limb is a red flag | WHO BEC: "If the wound is on a limb, elevate the limb above the heart" (p.169) |
| `fa-bleed-01` bleeding | a fixed wait before escalating is a red flag | ATP 3-50.21: "If bleeding continues after having applied direct pressure for 30 minutes, apply a pressure dressing" (p.24) |
| `sv-water-02` water | solar disinfection | the manual names sunlight but never describes a method |
| `uv-ingestion-01` tasting a plant | flatly no | a step-by-step taste test exists as a last resort (p.81-83) |
| `fa-fracture-01` fracture | straightening is a red flag | ATP 3-50.21 describes traction realignment; WHO says realign a pulseless limb |

These do not change the plan, but they mean some "failures" are the answer sheet
disagreeing with the book Fred is told to follow.

## 6. On the phone (Nothing Phone 3, native llama.cpp, same prompt)

| Model | Peak memory (PSS) | Prompt reading | Writing |
|---|---:|---:|---:|
| Qwen3-1.7B Q4_K_M (shipping) | 2.65 GB | 116-142 tok/s | 16-26 tok/s |
| **Qwen3-1.7B Q4_0** | 2.53 GB | **185-200 tok/s** | 18-33 tok/s |
| Qwen3-1.7B Q4_K_M, `--no-mmap` | **1.85 GB** | 125 tok/s | 17 tok/s |
| Gemma 4 E2B Q4_K_M | 3.94 GB | 65 tok/s | 10 tok/s |

- **Gemma 4 E2B does not fit**: over budget on memory and half the speed. Closed.
- **Q4_0 reads the prompt 30-70% faster** (llama.cpp repacks Q4_0 for the
  phone's CPU). On a 900-token prompt, that is 1.5-3 s sooner to the first word.
  It is a slightly coarser quantisation, so it needs a graded accuracy check
  before shipping.
- **Memory mapping double-counts the weights.** Without it, peak memory drops by
  800 MB.
- 6 threads write faster (30 vs 26 tok/s) but read slower (128 vs 142 tok/s)
  than 8.

Large file pushes over the USB link report success and write a fraction of the
file (307 MB of 3.1 GB); the 45 MB chunked push in the handoff notes works.

## 7. Rubric scoring (ticket #45)

`tools/eval/src/rubric.ts` and `score-rubric.ts` score a run on the adopted
definition: unsafe −1, declined 0, wrong 0, partly right or off-question 0.5,
fully right and on-question 1, correct decline 1. Safety failures are listed
first. The shipping baseline, from its existing yes/no verdicts, is **52.0 / 100
with 3 safety failures** (`fa-bleed-01`, `fa-bleed-02`, `uv-ingestion-01`).
Those verdicts carry no partial credit, so comparisons re-grade the baseline in
the same sitting.

## 8. Card review and answer-sheet corrections (2026-09-24)

**Review.** Ryan reviewed all 27 cards: 14 approved, 13 changes requested. All
13 are revised, plus the small wording notes on two approved cards (wind angle
on `cold-night`; early vs later signs on `immersion-foot`). Those 15 now show
"changed since your review" and need a second look. The 12 approved and
untouched cards keep their approval.

The card format gained an `unsourced` list: sentences deliberately **not**
backed by a manual quote, each with the reason it is there. Every reviewer
request that went beyond the manuals is there, and the review page shows it in
its own box:

- the antihistamine caution (anaphylaxis)
- "don't wander without a plan" and "call while you have signal" (lost)
- CDC's 6,500 ft boiling rule, iodine cautions, and chemical contamination
  (water)
- Poison Control (wild plants)

Everything else is still backed by a checked quote: 351 quotes across 27 cards.

Where a reviewer note and a manual disagreed, the manual won, per Ryan's rule,
and the card's note says so:

- burns: moist, not dry, dressings on deep burns (ATP 3-50.21 p.28)
- plant rash: the dirt/sand fallback is verbatim (p.42), kept as no-water only
- shock: the broken-leg rule is verbatim in the shock section (ATP 4-02.11 p.99)

Choking now follows the 2026 Army manual: five back blows, then abdominal
thrusts until the object is out.

**Answer sheets now follow the manuals** (Ryan, 2026-09-24: "Our answer sheets
should be based on the manuals"). All are tuning-set questions; the held-out
set is unchanged.

| Question | Was | Now | Basis |
|---|---|---|---|
| `fa-ankle-01` key point | remove footwear | leave the boot on unless circulation is compromised | ATP 3-50.21 p.45 |
| `fa-bleed-01` red flag | any fixed waiting period | delaying a tourniquet for life-threatening limb bleeding (e.g. 30 min) | ATP 4-02.11 (2026) over ATP 3-50.21 (2018) |
| `fa-bleed-01` red flag | elevating the limb | elevation *instead of* direct pressure | WHO p.169 and ATP 3-50.21 p.25 both pair elevation with pressure |
| `sv-water-02` key points | solar disinfection; let sediment settle | filter muddy water first, then purify | the manuals name sunlight but give no method |

Not changed:

- `uv-ingestion-01`: its "do not eat any plant unless positively identified" is
  itself a manual quote (ATP 3-50.21 p.42). The last-resort taste test on p.81
  is the manual disagreeing with itself.
- `fa-fracture-01`: Ryan's review decided "splint as found, never realign".

Verdicts recorded before these edits were graded against the old sheets; the
next graded run uses the new ones.

## 9. On the phone (2026-09-24)

The measured pipeline now runs on the Nothing Phone (3). New defaults in
rag-core (whole-question search, 20 nearest-by-meaning passages per pack,
meaning-only ranking, no trimming); EmbeddingGemma through llama.rn; packs
`core-firstaid` 1.2.0, `core-firstaid-army` 1.3.0, `core-survival` 1.3.0,
`core-fieldcards` 0.1.0 (27 approved cards) and `state-CA-flora-fauna` 1.1.0,
all built for EmbeddingGemma.

**A llama.rn bug, caught by the parity check.** A reused llama.rn embedding
context is right only on its first call. On the phone, the pack probe scored
cos 0.9996 on a fresh context, 0.3880 on every later call, and 0.8989 after
embedding another text. `clearCache()`, `swa_full` and disabling the state cache
did not change it. Every real query shares EmbeddingGemma's
`task: search result | query:` prefix, so without the check, every search after
the first would have been quietly wrong. The fix is a fresh context per
embedding, which costs about 0.7 s. This is very likely what made
docs/results-m3.md abandon llama.rn embeddings.

**Measured on the phone**, 5 spot-check questions, same packs as the desktop:

| | Phone |
|---|---:|
| Engine ready (packs, models, parity) | 2.7 s |
| Retrieval, including the query embedding | 0.85-0.95 s |
| Time to first word | 7.5-14.2 s |
| Answer total, mean | 15.4 s (range 9.9-24.1 s) |
| Peak memory while answering | 2.9 GB PSS (was 3.02 GB) |

- **Retrieval matched the desktop exactly**: same top-4 passages, same scores to
  three decimals.
- **Answers matched in substance**, with small wording differences. The choking
  answer is the fixed 2026 sequence.
- **Two known problems showed up on the phone too:**
  - Bleeding: the card was not among the top 4, so the answer mentions raising
    the limb and treats a tourniquet as a last resort (#47).
  - Water without boiling: declined, with the water card ranked first (#48).

**Tooling added:**

- `tools/eval/stage-phone.sh` stages packs and models in verified chunks,
  replacing old packs wholesale.
- `tools/eval/install-apk.sh` does the same for the APK, because `adb install`
  stalled for eleven minutes and installed nothing.
- `tools/eval/ask-phone.sh` asks the app questions from the desktop while the
  phone is locked. It uses a development inbox in App.tsx that is active only
  when a `devhooks` file exists in app storage, which only the debug staging
  creates.
- Load stages, parity and per-question timing are always logged. Answer text
  and passage names are logged only in that development mode.

Still to do for #46: EmbeddingGemma packs for the other 49 states (an
overnight job), and Q4_0 plus no memory-mapping for speed (#49).
