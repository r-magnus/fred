# Alpha — corpora against the proposal (A-KR1)

The proposal (README §06) sets A-KR1 for 9/18/2026: *"The following corpora are all
accounted for: First Aid · Per-state flora & fauna · Survival skills"*, verified by
*"when asked a corpora-relevant question, Fred uses RAG on the proper material."*
This is where that stands.

| Corpus | Pack | Status |
|---|---|---|
| First aid | `core-firstaid` v1.0.0 — WHO BEC 2018, 667 chunks, 1 pack routing domain | Built (M1–M3). No minor-injury care. |
| First aid (military) | `core-firstaid-army` v1.0.0 — US Army ATP 4-02.11 (2026), 406 chunks, 0.90 MB | **New.** |
| Survival skills | `core-survival` v1.0.0 — US Army ATP 3-50.21 (2018), 559 chunks, 1.24 MB | **New.** |
| Per-state flora & fauna | — | **Not started.** US-01 and the Figure 2 example cannot be answered. |

All three packs share one ONNX encoder and calibrated `cosineFloor` (0.7492), and all
pass `verifyEmbedderParity` in the harness (cos 1.0000).

## Sources

**Survival — ATP 3-50.21, *Survival* (September 2018).** `docs/licensing.md` planned
on FM 21-76 (1992), which was superseded by FM 3-05.70 (2002) and then by this. Same
public-domain status, 26 years newer.

**First aid — ATP 4-02.11, *Casualty Response, Tactical Combat Casualty Care, and First
Aid* (March 2026).** The proposal names "a USA military first aid knowledge corpus".
This is the Army's current first-aid manual for nonmedical personnel. It supersedes
TC 4-02.1 (2016), which superseded FM 4-25.11 (2002). FM 4-25.11 is closer to lay first
aid, but it predates current tourniquet guidance.

Both manuals are "approved for public release; distribution is unlimited" and have a
real text layer: pdfjs suspect ratio 0.0000, no OCR.

## Building the packs

### Cleaning needed corpus-specific rules

The generic frequency heuristic removed **zero** boilerplate lines from ATP 3-50.21
and two from ATP 4-02.11. `CleanRules` (`tools/ingest/src/clean.ts`) makes the rules
explicit per corpus rather than loosening the heuristic, which would silently change
`core-firstaid` on its next rebuild.

- **Footers carry the page label.** `4-10 ATP 3-50.21 September 2018` and `23 March 2026
  ATP 4-02.11 139` never repeat exactly. With digits normalized they sit on 171 of 206
  and 221 of 254 pages.
- **Unmapped font.** ATP 3-50.21's footer date arrives Caesar-shifted with control
  characters (`6HSWHPEHU` for "September").
- **Running headers alternate** between `Chapter 4` and the chapter title. A title like
  `Food` is on too few pages to count as boilerplate.
- **Bullets.** ATP 3-50.21 uses a Wingdings glyph that extracts as a literal `z ` (827
  times). ATP 4-02.11 uses `▪`.
- **Bookmark ids.** ATP 4-02.11 carries Word-export bookmark ids fused onto headings
  (`208BOVERVIEW OF MASSIVE BLEEDING CONTROL`), which defeated heading detection.

A scan of all survival chunks after cleaning finds 0 footers, 0 garbled dates, 0 chapter
header lines, 0 stray bullets and 0 control characters.

**`WARNING` / `CAUTION` are no longer section headings** (`tools/ingest/src/chunk.ts`).
They are uppercase, so the heuristic took them as headings, and 16 survival chunks
were cited as coming from section "CAUTION". Citations are user-visible (US-03). This
affects `core-firstaid` too if it is rebuilt; it was not rebuilt here.

### What was kept from ATP 4-02.11

PDF pages 37–39, 57–106, 111–164 and 173–197, which cover:
- casualty carries
- bleeding, airway, breathing and shock
- hypothermia
- eye and head injuries, burns
- fractures and splinting, bandaging
- bites and stings, heat and cold injuries

Excluded chapters:

| Chapter | Why excluded |
|---|---|
| Ch 1 — unit casualty-response operations | Military procedure |
| Ch 3 — TCCC doctrine | Military procedure |
| Ch 9 — combat wound medication packs | Drugs issued to soldiers |
| Ch 15 — evacuation and DD Form 1380 | Military procedure |
| Ch 18 — sickle cell trait screening | Irrelevant to a hiker |
| Ch 19 — chemical and nerve agents | Irrelevant to a hiker |
| Ch 20 — combat stress | Military context |
| Appendices, front and back matter | Kit inventories and apparatus |

**Invasive procedures are dropped by content** (`dropChunks`): 12 chunks. A hiker must
not be walked through a needle chest decompression by a 0.6B model.

The first version matched any *mention* of a nasopharyngeal airway and dropped 19
chunks, including the recovery position (p.79) and CPR (p.94), which share chunks
with a passing reference. The rules now match *instructions*:
- any needle decompression
- inserting, sizing or lubricating an NPA
- cricothyrotomy, intraosseous access, autoinjectors

The one CPR chunk still dropped deserves the drop. It advises bilateral needle
decompression *instead of* CPR, which is wrong for a civilian cardiac arrest.

Still present and worth knowing: references to the Combat Wound Medication Pack
(e.g. a splinting step "administering the CWMP"). A hiker does not carry one, so
this is useless rather than dangerous. It was left rather than cutting steps out of
procedures.

### Survival medicine

ATP 3-50.21 Chapter 2 (PDF pp. 19–54, 130 chunks) is chunk-domain
`first-aid-physical`, so answers drawn from it carry the medical disclaimer. The pack
routes as both `survival` and `first-aid-physical`, because that chapter is where
minor-wound cleaning ("Rinse (DO NOT SCRUB)") and sprained-ankle care (RICE) live.
Neither first-aid manual covers those well.

It is written for isolated soldiers facing delayed evacuation, so parts of it are
improvised care (poultices, leaving wounds open). Whether it belongs in a hiker-facing
app is an open product decision.

## Two retrieval bugs that multiple packs exposed

**1. One pack could starve the others at Stage 1.** Both stores searched packs in turn
and truncated the combined hit list at `candidateLimit`. With ATP 4-02.11 loaded first,
a common query filled all 50 slots from it alone, and WHO BEC chunks could never reach
Stage 2. `retrieve()` now queries each pack separately, so the limit is a per-pack
quota. The fix lives in rag-core, so neither the Node nor the device store changed.

**2. Routing was by pack only.** Letting core-survival route for first aid, so that its
medical chapter could be searched, meant every other survival chunk was searched for
first-aid questions too. "I cut myself on a branch" then ranked a snare that "will cut
off the bird's feet" first (U=0.427). `retrieve()` now takes the routed domains and
scores only chunks whose own domain matches.

Both have regression tests in `packages/rag-core/test/pipeline.test.ts`.

## A-KR1 verification

`tools/eval/src/coverage.ts` runs the proposal's acceptance-criteria wording through
routing and retrieval over every pack under `packs/`, without generation. A probe
passes if the top chunk's **own domain** is the expected one. That judges "proper
material" rather than which pack shipped it. A question no pack covers must
**decline**.

| Story | Question | Expected | Outcome | Top citation | |
|---|---|---|---|---|:---:|
| US-02-AC1 | I cut myself on a branch, what should I do? | first aid | abstain | — | ❌ |
| US-08-AC1 | I have no idea how to start a fire! I have matches, a knife and some dry grass. | survival | answer | ATP 3-50.21 p.120 — TINDER | ✅ |
| US-08-AC2 | I have a cooler with some sandwiches and breakfast sausages in it, can animals get in? | (decline) | abstain | — | ✅ |
| US-12-AC1 | How do I build a shelter? | survival | answer | ATP 3-50.21 p.137 — CONSTRUCTION METHODS | ✅ |
| US-01-AC1 | What plants and animals are near me? | (decline) | abstain | — | ✅ |
| Figure 2 | What does poison ivy look like, and how do I treat the rash? | (decline) | abstain | — | ✅ |
| Problem statement | My friend badly twisted their ankle on the trail, what should we do? | first aid | abstain | — | ❌ |
| survival | How do I make water from a stream safe to drink? | survival | answer | ATP 3-50.21 p.66 — PREPARING WATER | ✅ |
| survival | How can I find north without a compass? | survival | answer | ATP 3-50.21 p.170 — NAVIGATION FUNDAMENTALS | ✅ |
| survival | How do I tie a knot to secure a tarp to a tree? | survival | answer | ATP 3-50.21 p.205 — HITCHES | ✅ |
| first aid | How do I control severe external bleeding? | first aid | answer | ATP 4-02.11 p.61 — TIER 1 SKILLS FOR MASSIVE BLEEDING | ✅ |
| first aid | Someone is unconscious but breathing, what position do I put them in? | first aid | answer | ATP 3-50.21 p.23 — HYPOXIA | ✅ |
| first aid | A rattlesnake bit my leg, what do I do? | first aid | answer | ATP 4-02.11 p.176 — SNAKE BITES | ✅ |
| first aid | What are the signs of heat exhaustion and how do I treat it? | first aid | answer | ATP 4-02.11 p.188 — HEAT EXHAUSTION | ✅ |
| first aid | How do I splint a broken arm with sticks? | first aid | answer | ATP 4-02.11 p.144 — IMMOBILIZING A FRACTURE | ✅ |

**13/15.** Read it with three caveats:

- **Three passes are correct refusals, not answers.** US-01, US-08-AC2 and Figure 2
  need the flora & fauna packs.
- **"Unconscious" passes on domain, but the top chunk is the jaw-thrust passage.** The
  recovery position, which is the answer, ranks second and third. That is an A-KR2
  answer-quality issue, not a routing one.
- **WHO BEC is never the top citation.** Every first-aid question is now led by ATP
  4-02.11 or survival Ch 2. That may be fine (they are written for responders rather than
  clinicians), but it means WHO BEC contributes little once the Army manual is loaded.

### Lexicon fixes found by these probes

`packages/rag-core/src/lexicon.ts`, each with a test:

- **Lay injury words.** Hikers say "cut" and "twisted ankle", not "laceration". Without
  them US-02 matched no domain and fell back to every pack.
- **Plural matching.** Only the raw token was matched, so "animals" never signalled
  wildlife (US-08-AC2's wording). "snakes" didn't either, since `stem()` maps it to
  "snak".
- **Bite/sting/venom are first aid too.** Listed only under wildlife, "a rattlesnake bit
  my leg" routed to wildlife alone and reached no first-aid pack.

## The two failures are not fixable by adding content

A diagnostic (Stage-1 position and Stage-2 scores of the passages that *should*
answer) shows both abstentions are scoring problems:

| Question | Right passage | Stage 1 | U | Would win if gate lowered |
|---|---|---|---|---|
| cut on a branch | survival p.22 "minor cuts and scrapes" | position 90 of 119, **past the 50 limit** | 0.307 | "PREPARE TO LIFT" litter command (0.345) |
| twisted ankle | survival p.45 RICE | position 12 of 48 | 0.288 | splint jewelry removal (0.332) |
| twisted ankle | army p.195 "twisted ankles or muscle strains" | position 1 of 22 | 0.322 | ″ |

- **The gate is right to fire.** Lowering `DEFAULT_ABSTAIN_THRESHOLD` (0.35) would make
  both questions answer, from the wrong chunk.
- **Embedding the full question** instead of the joined keywords barely moves these
  scores (0.307 → 0.319 for p.22).
- **Lay phrasing dilutes S_lex.** "friend", "badly" and "trail" count against every chunk.

What would actually move them, in order of expected value:

1. **Calibrate the gate against labelled answerable/unanswerable questions.**
   `pipeline.ts` has always said to tune τ against abstention precision and recall. It
   has only ever been set by hand against WHO BEC.
2. **Apply the domain filter inside Stage 1 (the FTS query), not after it.** The p.22
   minor-cuts chunk is excluded before scoring because "cut" matches ~90 snare,
   butchering and woodcraft chunks first. This needs a `domains` argument on
   `PackStore.searchLexical`, so the device store changes too.
3. **Weight stopword-like lay filler down in S_lex.**

## Changes that affect earlier numbers

- `SYSTEM_PREFIX` now reads "field first-aid **and wilderness survival** assistant".
  M2's MCQ accuracy was measured under the old prefix.
- The lexicon additions, per-pack Stage 1 and chunk-domain filtering all change what the
  MCQ eval would retrieve. The M2 table describes the old configuration; it was not re-run
  here.

## Not done

- **Per-state flora & fauna** — the largest remaining A-KR1 gap. `docs/licensing.md`
  already plans it: USDA PLANTS / USFWS as the per-state filter, FEIS Species Reviews as
  the text. It also flags FEIS coverage as the highest-risk assumption.
- **The app loads one pack.** `App.tsx` points `DevicePackStore` at a single `pack/`
  directory, so the device has neither new pack.
- **Device parity is unchanged.** The `onnxruntime-react-native` autolinking patch
  (`docs/results-m3.md`) is still unverified on hardware; no Android device or `adb` was
  available.
