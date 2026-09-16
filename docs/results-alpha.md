# Alpha — corpora against the proposal (A-KR1)

The proposal (README §06) sets A-KR1 for 9/18/2026: *"The following corpora are all
accounted for: First Aid · Per-state flora & fauna · Survival skills"*, verified by
*"when asked a corpora-relevant question, Fred uses RAG on the proper material."*

| Corpus | Pack | Size |
|---|---|---|
| First aid | `core-firstaid` v1.0.0 — WHO BEC 2018, 667 chunks | 1.1 MB |
| First aid (military) | `core-firstaid-army` v1.0.0 — US Army ATP 4-02.11 (2026), 406 chunks | 0.90 MB |
| Survival skills | `core-survival` v1.0.0 — US Army ATP 3-50.21 (2018), 559 chunks | 1.24 MB |
| Flora & fauna, California | `state-CA-flora-fauna` v1.0.0 — USFS FEIS, 531 species, 5,773 chunks | 9.64 MB |
| Flora & fauna, Oregon | `state-OR-flora-fauna` v1.0.0 — USFS FEIS, 470 species, 5,124 chunks | 8.58 MB |

**All three corpus types now exist, for two pilot states.** All five packs share one
ONNX encoder and calibrated `cosineFloor` (0.7492), and all pass `verifyEmbedderParity`
on desktop and on the phone (cos 1.0000).

Storage (R-02): the global packs total 3.2 MB, a state pack is roughly 9 MB. Fifty states
would be ~450 MB, which is the proposal's own fallback: let the user pick which states to
download.

## Sources

**Survival — ATP 3-50.21, *Survival* (September 2018).** `docs/licensing.md` had planned
on FM 21-76 (1992). That manual was superseded by FM 3-05.70 (2002), which was in turn
superseded by this one. Same public-domain status, 26 years newer.

**First aid — ATP 4-02.11, *Casualty Response, Tactical Combat Casualty Care, and First
Aid* (March 2026).** The proposal names "a USA military first aid knowledge corpus". This
is the Army's current first-aid manual for nonmedical personnel. It supersedes TC 4-02.1
(2016), which superseded FM 4-25.11 (2002).

Both manuals are "approved for public release; distribution is unlimited" and have a
real text layer.

**Flora & fauna — USFS Fire Effects Information System (FEIS).** 1,092 peer-reviewed
species reviews, public domain. `docs/licensing.md` planned to use USDA PLANTS and USFWS
as the per-state filter and FEIS as the text. That turned out unnecessary: each FEIS
review carries its own structured state list ("United States: CA OR WA").

## Building the packs

### Army manuals: cleaning needed corpus-specific rules

The generic frequency heuristic removed zero boilerplate lines from ATP 3-50.21 and two
from ATP 4-02.11. Footers carry the page label, so no two repeat exactly. One footer date
is set in a font pdfjs cannot map (it arrives as `6HSWHPEHU` for "September"). Running
headers alternate with chapter titles. Bullets extract as `z` or `▪`. Word-export
bookmark ids are fused onto headings (`208BOVERVIEW OF…`).

`CleanRules` (`tools/ingest/src/clean.ts`) makes these explicit per corpus rather than
loosening the heuristic, which would silently change `core-firstaid` on its next rebuild.
`WARNING` / `CAUTION` are no longer treated as section headings: 16 survival chunks had
been cited as coming from section "CAUTION".

**ATP 4-02.11 keeps only chapters a civilian can act on:**
- carries
- bleeding, airway, breathing and shock
- hypothermia
- eye and head injuries, burns
- fractures and bandaging
- bites and stings, heat and cold injuries

Unit operations, TCCC doctrine, combat medication packs, evacuation, sickle cell trait,
CBRN, combat stress and appendices are excluded.

**Twelve chunks that teach invasive procedures are dropped:** needle chest decompression,
airway-tube insertion, cricothyrotomy. The first rule matched mentions and dropped 19,
including CPR and the recovery position. The one CPR chunk still dropped advises needle
decompression *instead of* CPR, which is wrong for a civilian cardiac arrest.

**ATP 3-50.21 Chapter 2 (Survival Medicine) is tagged medical.** Its answers carry the
disclaimer, and the survival pack also routes for first aid, because that chapter holds
the minor-wound and sprain care the first-aid manuals lack. It is written for isolated
soldiers facing delayed evacuation; whether it belongs in a hiker app is an open product
decision.

### FEIS: fetch once, filter by state, keep the sections a hiker needs

`tools/ingest/src/feis-fetch.ts` downloads the review index and every review page once,
into `corpora/feis/` (not committed), at a polite rate. `feis-pack.ts <states>` builds
packs from that cache without touching the network.

**The state parser failed silently at first.** The heading is
`<h3><strong>States and Provinces</strong></h3>`, and a regex anchored to the heading tag
found nothing for 420 reviews. That left 641 of 1,092 without a state list and California
at 264 species. Matching on stripped text, and accepting older reviews' "States" heading,
brings it to **147 without a list, California 531, Oregon 470**. The 147 give distribution
only as prose ("New York, Virginia, and Colorado"); they are left out of every state pack
rather than guessed from place names. `tools/ingest/test/feis.test.ts` pins both formats.

**FEIS is a fire-ecology database**, so most of each review answers the wrong question.
Kept for plants:
- general distribution
- site characteristics
- botanical description
- seasonal development
- importance to wildlife and palatability
- other uses
- other management considerations, which carries the "Safety/Medical" notes (urushiol)

Kept for animals:
- general distribution
- biological characteristics
- predators
- diet
- preferred habitat
- cover requirements

Everything else is dropped: fire effects, regeneration strategy, plant-community tables,
appendices, references. Inline citations (`[29,30,32]`) are stripped.

**Every chunk names its species.** Each opens with "Pacific poison-oak (Toxicodendron
diversilobum) — Botanical Description". A mid-review chunk without the name could not be
retrieved by it. Plant and animal reviews are told apart by a heading every plant review
has, and chunks carry that domain.

**Coverage is uneven.** California's 531 species are 452 plants and 79 animals, mostly
birds and game mammals. FEIS has nothing on treating a poison-oak rash or on bear-encounter
safety; those have to come from the first-aid and survival packs.

## Two retrieval bugs that multiple packs exposed

1. **One pack could starve the others at Stage 1.** The stores searched packs in turn and
   truncated the combined list, so a large pack listed first filled every candidate slot.
   `retrieve()` now queries each pack separately.
2. **Routing was by pack only.** Letting core-survival route for first aid exposed its
   snare and woodcraft chunks to first-aid questions ("I cut myself on a branch" ranked a
   bird snare first). `retrieve()` now scores only chunks whose own domain was routed.

Both have regression tests.

## A-KR1 verification

`tools/eval/src/coverage.ts` runs the proposal's acceptance-criteria wording through
routing and retrieval over every pack under `packs/`, without generation. A probe passes
if the top chunk's own domain is expected. Where a question should decline (no location
given), declining is the pass.

| Story | Question | State | Expected | Outcome | Top citation | |
|---|---|---|---|---|---|:---:|
| US-02-AC1 | I cut myself on a branch, what should I do? | — | first aid | abstain | — | ❌ |
| US-08-AC1 | I have no idea how to start a fire! I have matches, a knife and some dry grass. | — | survival | answer | ATP 3-50.21 p.120 — TINDER | ✅ |
| US-08-AC2 | I have a cooler with some sandwiches and breakfast sausages in it, can animals get in? | CA | wildlife / survival | abstain | — | ❌ |
| US-12-AC1 | How do I build a shelter? | — | survival | answer | ATP 3-50.21 p.137 — CONSTRUCTION METHODS | ✅ |
| US-01-AC1 | What plants and animals are near me? | OR | plants / wildlife | answer | FEIS — winterfat > Importance to Wildlife | ✅ |
| US-01 | Are there mountain lions around here, and what do they eat? | CA | wildlife | answer | FEIS — mountain lion > Predators | ✅ |
| Figure 2 | What does poison oak look like, and how do I treat the rash? | CA | plants | answer | FEIS — Pacific poison-oak > General Distribution | ✅ |
| no location | What does poison oak look like? | — | (decline) | needs-location | — | ✅ |
| Problem statement | My friend badly twisted their ankle on the trail, what should we do? | — | first aid | abstain | — | ❌ |
| survival | How do I make water from a stream safe to drink? | — | survival | answer | ATP 3-50.21 p.66 — PREPARING WATER | ✅ |
| survival | How can I find north without a compass? | — | survival | answer | ATP 3-50.21 p.170 — NAVIGATION FUNDAMENTALS | ✅ |
| survival | How do I tie a knot to secure a tarp to a tree? | — | survival | answer | ATP 3-50.21 p.205 — HITCHES | ✅ |
| first aid | How do I control severe external bleeding? | — | first aid | answer | ATP 4-02.11 p.61 — TIER 1 SKILLS FOR MASSIVE BLEEDING | ✅ |
| first aid | Someone is unconscious but breathing, what position do I put them in? | — | first aid | answer | ATP 3-50.21 p.23 — HYPOXIA | ✅ |
| first aid | A rattlesnake bit my leg, what do I do? | — | first aid | answer | ATP 4-02.11 p.176 — SNAKE BITES | ✅ |
| first aid | What are the signs of heat exhaustion and how do I treat it? | — | first aid | answer | ATP 4-02.11 p.188 — HEAT EXHAUSTION | ✅ |
| first aid | How do I splint a broken arm with sticks? | — | first aid | answer | ATP 4-02.11 p.144 — IMMOBILIZING A FRACTURE | ✅ |

**14/17.** Several passes are weaker than the checkmark:

- **US-01 passes on domain only.** "What plants and animals are near me?" is a list
  question; the top chunk is winterfat's value as livestock forage. RAG cannot enumerate
  a state's species. Answering US-01 needs a structured species list per state, not
  retrieval.
- **Figure 2 gets identification but not treatment.** "Rash" routes nowhere, so the
  question reaches only the plants pack, and FEIS has no rash care.
- **"Unconscious" ranks jaw-thrust above the recovery position**, which is the answer.

### The three failures

**Cut and twisted ankle are scoring problems, not missing content.** The right passages
exist but score below the 0.35 abstention gate:

| Question | Right passage | Stage 1 | U | Would win if the gate were lowered |
|---|---|---|---|---|
| cut on a branch | survival p.22 "minor cuts and scrapes" | position 90 of 119, past the limit | 0.307 | "PREPARE TO LIFT" litter command (0.345) |
| twisted ankle | survival p.45 RICE | position 12 of 48 | 0.288 | splint jewelry removal (0.332) |
| twisted ankle | army p.195 "twisted ankles or muscle strains" | position 1 of 22 | 0.322 | ″ |

Lowering the gate would answer both from the wrong chunk. What would move them:
1. Calibrate the gate against labelled answerable and unanswerable questions (it has only
   ever been set by hand).
2. Apply the domain filter inside Stage 1 rather than after it.
3. Down-weight lay filler words in S_lex.

**The cooler question regressed from "correct decline" to "abstain".** Before the
flora-fauna packs existed, declining was right. Now "animals" routes to the California
wildlife pack, whose nearest chunk is chickadees caching food (0.332). The useful answer,
food storage at camp, is survival material that "animals" does not route to.

## Lexicon fixes found by these probes

`packages/rag-core/src/lexicon.ts`, each with a test:
- **Lay injury words.** Added "cut", "twisted", "ankle" and similar.
- **Plural matching.** "animals" now matches "animal"; "snakes", which `stem()` turns into "snak", now matches "snake".
- **Bites are first aid too.** Bite/sting/venom now route to first aid as well as wildlife, where they had been listed alone.

## On the phone

Parity, CPU-only generation and the GPU-offload finding are in `docs/results-m3.md`.
The device harness (`apps/mobile/App.tsx`) loaded four packs (core-firstaid,
core-firstaid-army, core-survival and state-CA-flora-fauna; 7,405 chunks in 218 ms) and
ran one question per domain:

| Question | Routed to | Top chunk | Retrieve | TTFT | Total |
|---|---|---|---|---|---|
| How do I control severe external bleeding? | 3 first-aid packs | army p.61 | 94 ms | 2.9 s | **5.2 s** |
| How do I build a shelter? | survival | survival p.137 | 83 ms | 3.3 s | 13.2 s |
| A rattlesnake bit my leg, what do I do? | 3 first-aid packs | army p.176 | 77 ms | 3.6 s | **7.6 s** |
| What does poison oak look like? (CA) | CA flora-fauna | poison-oak | 83 ms | 2.5 s | **9.5 s** |

**A-KR3 (< 10 s):** 3 of 4 answers are under 10 s. Shelter runs over because its answer is
long (811 characters); retrieval is never the cost. Four questions is not a timed series.

**A-KR2 is now the real problem.** The pipeline is correct end to end, and the answers
show what that does and does not buy:
- **Bleeding** invents "if bleeding continues after 30 minutes, apply a dressing". That is
  dangerous, and in no source.
- **Snakebite** says to wash the area and seek care, calls a bite a "sting", and omits
  immobilization.
- **Poison oak** copies the chunk header ("— General Distribution Also called:") into the
  answer. The header format should read as a sentence.

Memory with CPU-only generation: 1.72 GB PSS.

## Changes that affect earlier numbers

- `SYSTEM_PREFIX` now covers wilderness survival as well as first aid.
- Retrieval changes: per-pack Stage 1, chunk-domain filtering and lexicon additions.

M2's MCQ table describes the old configuration and was not re-run.

## Not done

- **A-KR2 grading harness.** The proposal verifies accuracy by having Claude Opus 5 grade
  Fred's free-form answers against an answer sheet; the current eval is multiple choice.
  The same labelled set would calibrate the abstention gate.
- **US-01 as a list.** A per-state species index answered without retrieval.
- **Routing fixes.** Food storage should reach survival from wildlife words; rash should
  reach first aid.
- **Chunk header** phrasing for FEIS chunks.
- **Oregon on device.** Only the California pack has been run on the phone.
- **App.** Packs are copied in by hand and the state is hard-coded. There is no pack
  download or state selection yet.

---

## Three retrieval fixes, and a corpus defect they uncovered

The three failures above were attributed to scoring, with three named remedies.
Two are now done; the third is blocked on the labelled set.

### 1. The domain filter moved inside Stage 1

`candidateLimit` is a quota, and filtering by domain *after* the lexical search
spent it on chunks that were never eligible. `searchLexical` now takes the routed
domains and applies them in SQL. Eligible candidates reaching the re-ranker:

| Query | Before | After |
|---|---:|---:|
| cut on a branch | 43 | 53 |
| twisted ankle | 35 | 35 |
| cooler / animals | 8 | 42 |

The ankle query never had a binding quota, which is why it did not move. The
cooler query gained 5x, and still abstains: 42 wildlife chunks is plenty, and FEIS
simply has no camp-food-storage content. That confirms the diagnosis above — it is
a routing gap, not a candidacy one.

`retrieve()` keeps its post-filter as a backstop, because the store parameter is
optional and a wrong-domain chunk reaching the generator is worth preventing twice.

### 2. Function words are stopped

`S_lex` divides by total keyword weight, so filler dilutes the discriminating
terms. `cut` held 2 of 4 weight; `twisted`+`ankle` held 4 of 7. Reflexive and
indefinite pronouns, degree adverbs and light verbs are now stopped, and
`extractKeywords` consults the lexicon *before* the stopword list — `bit` is a
light verb by spelling and snakebite vocabulary in use. A test sweeps every
`DOMAIN_LEXICON` term so no future stopword can silently delete domain vocabulary.

**Coverage went 14/17 to 15/17, and the new pass is not real.** "I cut myself on a
branch" now answers from ATP 3-50.21's SNAKEBITES chunk. Concentrating weight on
`cut` amplified a term the corpora use as a verb — "cutting opens capillaries",
"a surgical procedure to cut and release burned tissue" — rather than as the noun
the question means. The top three chunks all match `cut` in the wrong sense.

`coverage.ts` judges a probe by the top chunk's *domain*, so all three count as
first aid and the probe passes. Retrieval got no better for that question; the
measurement stopped being able to tell. This is the same failure mode as the MCQ
eval hiding generation defects, one level down, and it is why gate calibration
is **not** worth attempting before the labelled set exists: calibrating against a
metric that cannot see word sense would fit the threshold to a bad ranking.

### 3. The gate is still uncalibrated

Unchanged and deliberately so. The twisted-ankle probe still abstains at 0.340,
with the right passage (army p.195, "twisted ankles or muscle strains") third at
0.331. The margin narrowed but the ordering did not change.

## The corpus defect: negated lists lost their polarity

Chasing the snakebite chunk above turned up something worse than a ranking bug.
ATP 3-50.21 p.48 was stored as:

```
‡ Make any deep cuts at the bite site. Cutting opens capillaries...
‡ Put the hands on the face or rub the eyes, as venom may be on hands.
‡ Break open the large blisters that form around the bite site.
```

In the manual that list is governed by `Do not -`. The 300-token window opened
below the header, and the 50-token overlap could not recover it because the
overlap carries the *tail* of the previous window while a list header sits *above*
its items. The result is a retrievable chunk of three imperatives that mean the
exact opposite of the source, on a question a user in trouble would actually ask.

ATP 3-50.21 p.83 was the same shape and arguably worse: "stay away from any wild
or unknown plants that have -" orphaned from "Foliage that resembles dill, carrot,
parsnip, or parsley" and "An almond scent". That is the water-hemlock and cyanide
indicator list, presented as a list of plants to look for.

**Nothing in the pipeline could have caught this.** The chunks are well-formed,
correctly sectioned, correctly page-numbered, correctly domain-tagged, and embed
to sensible vectors. Retrieval ranks them accurately. The defect is entirely in
what the text *means* once a line is missing, which no test of the retrieval path
inspects.

### The fix and the survey

`chunkPages` now walks back from the overlap window for the governing list header
and carries it in. Two details cost a rebuild each: list items wrap onto unmarked
continuation lines, so the walk cannot stop at the first non-bullet line; and a
window can open on such a continuation rather than on a bullet. The walk is
bounded at 15 lines and stops at a section heading.

Headers are carried for every list, not only negated ones — "Examine the eyes for
the following:" is equally the thing that makes its items mean anything.

Surveyed across all five packs by locating chunks that open inside a list whose
governing header lies outside them:

| Pack | Candidates | Genuine |
|---|---:|---:|
| core-firstaid-army | 2 | 1 |
| core-firstaid (WHO BEC) | 0 | 0 |
| core-survival | 4 | 4 |
| state-CA-flora-fauna | 0 | 0 |
| state-OR-flora-fauna | 0 | 0 |

The FEIS packs are clean because species reviews are prose, with no imperative
lists — the defect is specific to doctrinal manuals. After rebuilding
`core-survival` (559 to 563 chunks) and `core-firstaid-army` (406 to 410), the
survey reports zero. `core-firstaid` was not rebuilt: it has no instances, and
leaving it untouched keeps the WHO BEC numbers in `docs/results-m2.md` comparable.

### What this says about A-KR2

The proposal verifies accuracy by grading Fred's answers against an answer sheet.
That would not have caught this either, unless the question set happened to ask
about snakebite treatment or plant edibility. A grading harness measures the
answers you think to ask for; it does not survey the corpus for passages that
changed meaning in transit.

Both belong in the Alpha evidence: the labelled set for A-KR2, and a structural
check over the packs for defects that make a confident answer wrong. The latter
is cheap — it is a query over `chunks.sqlite` — and it is the kind of check worth
running on every rebuild rather than when something looks odd.
