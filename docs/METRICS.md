# Fred — metrics at a glance

*Generated from `docs/metrics.json` — do not edit by hand. Last updated **2026-10-07**.*

```
model              Qwen3-1.7B-Q4_K_M
embedder           EmbeddingGemma-300M (GGUF Q8), meaning-only search of the whole question
retrieval          4 passages, best field card reserved a place from 0.35
answers            a clearly matching field card verbatim; otherwise Qwen3-1.7B from the passages; clinical procedures referred on
abstainThreshold   0.29
scoring            four-part rubric since 2026-09-24: safe first, then correct, on the question, sounds like Fred
measuredOn         desktop harness for accuracy; Nothing Phone (3) for device latency and memory
akr2Target         70% (final proposal v1.2, 2026-09-27); an A needs more than 80%
```

## Milestone scorecard

| KR | What | Due | Now | Grade |
|---|---|---|---|---|
| `A-KR1` | Necessary knowledge corpora | 2026-09-18 | **all 3 types, 50 states** | 🟢 A |
| `A-KR2` | Response accuracy | 2026-10-12 | **73.8%** / 70%<br><sub>67.5% fresh breadth set, graded blind</sub> | 🟡 B |
| `A-KR3` | Response time | 2026-10-19 | **15.3s** / 20s | 🟢 A |
| `B-KR1` | Location while in service | 2026-10-26 | **9.5m** | 🟢 A |
| `B-KR2` | Location in Fred's answers | 2026-11-10 | **state only** | 🔴 D |
| `B-KR3` | Predicted service zone | 2026-11-16 | **on device** | 🔵 built, unverified |
| `RC-KR1` | iOS and Android app | 2026-11-25 | — | ⚪ not started |
| `RC-KR2` | User population | 2026-12-02 | — | ⚪ not started |
| `RC-KR3` | Product page and promo | 2026-12-09 | — | ⚪ not started |

- `A-KR1` — First aid, survival, signalling, flora/fauna. 5 core packs (WHO BEC, ATP 4-02.11, ATP 3-50.21, FM 21-76 ch.19 signalling, 27 reviewed field cards) and 50 state packs, all built for the EmbeddingGemma search model as of 2026-09-25: 55 packs, 408 MB. Plus two everyday-tips packs (2026-09-29, #96): National Park Service articles and Wikivoyage travel topics, 384 passages, 1 MB. CA and OR are on the phone; the other 48 wait for it to be connected.
- `A-KR2` — Held-out set, 40 questions nothing was tuned on, four-part rubric. 50.0% (the old pipeline regraded on the rubric) -> 62.5% phase 1 (EmbeddingGemma, field cards) -> 61.3% phase 2 (card slot, survival-manual redactions) -> 66.3% phase 3 (verbatim card answers, clinical procedures referred on, state named in the prompt, signalling source) -> 67.5% re-measured 2026-09-26 on the current pipeline (the phase-3 number predates narrowing the state line; +0.5 on manzanita size), with drug, oxygen and IV steps removed from WHO BEC (#61), which changed no held-out answer. -> 68.8% with a note on plant-database passages about animals eating ("not food for people"): the last held-out safety failure (hff-bulrush-01) is gone. -> 71.3% with six field cards on syllabus topics (spinal, chest wound, pelvis, altitude, seizure, low blood sugar): the pelvis card answers a question that was declined. -> 70.0% with three more (belly wound, dehydration, signalling): the belly card answers "can I pack a wound in someone's belly?" with the whole card rather than "no" first (full -> partial). -> 72.5% with six more (eye injury, snow blindness, river crossing, knots and cord, staying healthy, chest pain and stroke): snow blindness partial -> full, plant cordage test declined -> partial. -> 72.5% with the everyday-tips packs (2026-09-29, #96): one held-out answer worse (hs-movement-01, left unfixed rather than tuned against), one better (hs-insects-01), graded blind (docs/results-tips.md). Safety failures 4 -> 1; tuning 38.5 -> 83.0 with none. One held-out answer is 2.5 points, and one grader who knew which run was which scored every run. docs/results-phase3.md. -> 73.8% re-measured 2026-10-06 on main (77f3e6b) with the packs in ~/fred-packs-g-all (field cards 0.8.0, health, hazards, wildlife safety and tips packs): 36 of 40 answers word for word those of 2026-09-29; the tick question, which asked for a location, is now answered (0 -> 1, graded full on the question asked, partial if the allergy point is required: 72.5%); CPR and belly-wound answers reworded at the same score, graded blind. No safety failures. Like for like the 2026-09-29 figure is 71.3%, not 72.5%: its GPS-battery answer was graded full in-session on 2026-09-27 and 0.5 blind. The phone's 12 packs were checked byte for byte against that folder on 2026-10-07: identical. A first run that day on the repo's packs/ folder (field cards 0.5.0, none of the newer packs) gave 71.3% and is kept for the record (docs/holdout-runs-2026-10-06.jsonl); it is not this pipeline. Runs and verdicts: docs/holdout-runs-2026-10-06-shipped.jsonl, docs/holdout-verdicts-2026-10-06-shipped.json. Checked blind on 57 fresh questions (2026-09-27): 61.4% for the pipeline as of 2026-09-25 -> 67.5% today, 4 wins, 0 losses, 0 unsafe; the held-out figure runs about 5 points above fresh questions. docs/results-breadth.md.
- `A-KR3` — Phone mean for model-written answers on the 40 held-out questions, Nothing Phone (3), 2026-10-07, one app session each, the app as shipped (opener on): 17 answers, mean 15.3 s, median 14.3 s, range 8.2-24.1 s; two at or over 20 s (scalp bleeding 24.1 s, spoiled fish 20.0 s). Their first words came at 2.4 s (median): with the opening line shown (10 of 17) the answer itself starts at 13.4 s, without it at 11.5 s. Field-card answers: 12, mean 3.7 s (3.4-4.0 s). Declines, the watch reply, a referral and a location request: 10, mean 1.5 s. Every reply, 39 questions: mean 8.2 s, median 3.7 s. One off-topic question (a sourdough recipe) gave no log line in two tries and is not in these figures; asked again after the next build was installed, it was declined in 1.1 s. Every reply is the same kind as the desktop gave on 2026-10-06, and the phone's 12 packs are byte for byte those of ~/fred-packs-g-all. Log: docs/phone-holdout-2026-10-07.txt. Earlier figure: 15.4 s on 2026-09-24 (phase 1, before cards, intent and the opener).
- `B-KR1` — 9.5 m median outdoors in airplane mode, best 5.6 m, five attempts (docs/results-bkr1-outdoor.md). The 33.5 m indoor figure was WiFi positioning, not GPS — indoors the 10 m early exit never fires. PROVISIONAL: one location. The KR is verified by driving to different physical locations and that has not happened. Proposal v1.2 also asks that the location be served to the LLM: today Fred's prompt gets the state only (see B-KR2).
- `B-KR2` — Redefined in proposal v1.2: the user's location should shape Fred's answers. Planned (#77): when signal comes up, Fred says how far and which way the nearest reported coverage is, and prompts the user to open the map. Today the prompt names the user's state and picks the state's plant and animal pack. The map already shows the coverage zones and the nearest coverage, but Fred's answers don't use them.
- `B-KR3` — Built and rendering on device. FCC BDC hexagons aggregated to H3 res 7; all three major LTE carriers for California are 71,211 cells in a 7.1 KB pack. Nearest-coverage search reports bearing and distance offline. Unverified: needs the drive.
- `RC-KR1` — iOS launches on the simulator (Xcode 27). Needed expo 57.0.24 + scene support; Android not rebuilt since. See results-ios-build.md.
- `RC-KR2` — Redefined in proposal v1.2: at least 10 people using Fred across iOS and Android, with qualitative reviews collected. Not started.
- `RC-KR3` — Proposal v1.2: a product page with at least 3 videos and 8 images of Fred in use. Not started.

## A-KR2 — answer accuracy over time

```
baseline (0.6B)                                   ███████████░░░░░░░░░░░░░░░░░   38.2%   0.6B
+ conditional prompt                              ████████████░░░░░░░░░░░░░░░░   44.1%   0.6B
+ Qwen3-1.7B                                      ██████████████░░░░░░░░░░░░░░   48.5%   1.7B
+ scope gate, lay lexicon                         ███████████████████░░░░░░░░░   69.1%   1.7B
+ gate 0.29                                       ████████████████████░░░░░░░░   70.6%   1.7B
I: routing as a hint (held out)                   ██████████████████░░░░░░░░░░   62.5%   Qwen3-1.7B
rubric: old pipeline regraded (held out)          ██████████████░░░░░░░░░░░░░░   50.0%   Qwen3-1.7B
phase 1: EmbeddingGemma, cards (held out)         ██████████████████░░░░░░░░░░   62.5%   Qwen3-1.7B
phase 2: card slot, redactions (held out)         █████████████████░░░░░░░░░░░   61.3%   Qwen3-1.7B
phase 3: card answers, referral (held out)        ███████████████████░░░░░░░░░   66.3%   Qwen3-1.7B
re-measured, WHO drug steps out (held out)        ███████████████████░░░░░░░░░   67.5%   Qwen3-1.7B
forage note, location fix (held out)              ███████████████████░░░░░░░░░   68.8%   Qwen3-1.7B
cards batch 3: six syllabus cards (held out)      ████████████████████░░░░░░░░   71.3%   Qwen3-1.7B
+ belly, dehydration, signal (held out)           ████████████████████░░░░░░░░   70.0%   Qwen3-1.7B
cards batch 4: six more (held out)                ████████████████████░░░░░░░░   72.5%   Qwen3-1.7B
+ tips packs, NPS and Wikivoyage                  ████████████████████░░░░░░░░   72.5%   Qwen3-1.7B
re-measured 2026-10-06, current packs (held out)  █████████████████████░░░░░░░   73.8%   Qwen3-1.7B
TARGET                                            ████████████████████░░░░░░░░   70.0%
```

**38.2% → 73.8%** (+35.6 points). Target is 70%.

> The rows are not all the same measurement. Rows before "rubric" were scored yes/no, all but the last on the tuning set. From "rubric" on, every row is the held-out set on the four-part rubric (safe first), which is stricter: the old pipeline scored 62.5% yes/no and 50.0% on the rubric. Compare within each group.

The score has two halves:

| Half | Score | What it measures |
|---|---|---|
| answerable | **17/31** — 54.8% | held-out questions Fred should answer, fully right (9 more partly right, 3 wrong, 2 declined), 2026-10-06 |
| decline | **8/9** — 88.9% | held-out questions Fred should decline or ask a location for, handled correctly, 2026-10-06 |

### Follow-up questions (conversation memory, 2026-09-26)

Measured separately: a second question that only makes sense after the first. Held-out two-turn set, 13 conversations, run once: **46% → 81%** with memory (6.0 → 10.5), no unsafe answers either way. Single-question answers are byte for byte unchanged. docs/results-memory.md.

### Fresh questions, graded blind (2026-09-27)

57 questions written after every change they judge (random manual passages, general syllabus topics, out of scope), pipeline of 2026-09-25 against today's, A/B shuffled: **61.4% → 67.5%**, 4 wins, 0 losses, 0 unsafe. The held-out set runs about 5 points above fresh questions. docs/results-breadth.md.

### Everyday outdoor questions, graded blind (2026-09-29)

40 questions written before any tips page was fetched (28 everyday, 6 emergencies near tip topics, 6 to decline). With the National Park Service and Wikivoyage tips packs, everyday questions answered go **4 → 12 of 28**. Across all five question sets 15 of 277 answers changed: 10 better, 1 worse, 0 unsafe; every emergency answered exactly as before. Held-out, breadth and colloquial scores unchanged. docs/results-tips.md.

### Conversations and casual emergencies, graded blind (2026-09-29, #98)

45 sealed conversations of 1-3 messages written before any code ("i'm lost and scared" / "pls help", "uhh dude there's a bear in front of me", and traps in the same styles). With the understanding step: answered when it should **13 → 16 of 28** (California 11 → 15), dead ends where Fred should help **16 → 5**, out-of-scope answers unchanged (1 of 15), no unsafe answers after two fixes (a restated fall opened the shock card below the gate; on the phone an old topic took over new ones). Every other set unchanged except +1 colloquial and +3 conversation answers; held-out unchanged, so A-KR2 stays 72.5%. When the step runs it adds 3.1 s (desktop median) and 2-7 s on the phone, over the 2.5 s limit; nothing when it doesn't. docs/results-understand.md.

### A friendly opening line (2026-10-06, #130)

Before a model-written answer Fred now writes one short line about what the hiker asked ("Good question about making rope from plant fibers.", "Oh no, diarrhea on the trail is uncomfortable."). The model writes it from the hiker's words alone; the code picks its first words by what the message is (a question, a yes/no question, a problem, a worry) and fixed rules drop any line that is not about the message or that carries advice, a fact, a promise or a yes. No opener for emergencies, card replies, declines or small talk. Six sealed sets of messages, each written before the code it tested: on the last three, 29 of 40, 32 of 42 and 31 of 45 openers kept, none of them unsafe; the answer after the opener is word for word what Fred gave without it, so accuracy is unchanged. On the phone the first words come at about 2 s and the answer about 2 s later than before, with a "Working on your answer…" note in between. docs/results-friendly-opener.md.

### Where the remaining points are

| Lost | Why | What would fix it |
|---:|---|---|
| 9 | partly right (held out): a card that answers without leading with the answer (airway, head tilt, belly wound, cordage), or a model answer missing a key point (scalp bleeding, falcon, manzanita, GPS battery, insects) | cards could carry a short direct answer per common question; the model misses are generation quality |
| 3 | wrong but safe (held out): map orientation gets the finding-north card; walking out gets a tips passage about campsites; marsh plants gets "no reliable information" | the clear-match rule (0.35, or 0.32 and top) has thin margins; the tips answer was left unfixed rather than tuned against (docs/results-tips.md) |
| 2 | declined answerable questions (held out): paracord uses and survival medicine, both low search scores | no safe lever yet. A second search in manual wording recovered ~9 on tuning but let 14 out-of-scope questions through (rejected, docs/results-phase3.md step 4) |
| 1 | declined where it should ask for a location (hff-nostate-01) | not investigated |

## A-KR3 — response time

```
(longer bar = slower; the target is to stay left of the 20s mark)

target   20.0 s   ██████████████░░░░░░░░░░░░░░  <-- 20s
mean     11.4 s   ████████░░░░░░░░░░░░░░░░░░░░
median   11.0 s   ████████░░░░░░░░░░░░░░░░░░░░
p95      17.7 s   ████████████░░░░░░░░░░░░░░░░
```

**30 of 68** queries exceed ten seconds. Desktop, 1.7B, measured 2026-09-20 before phases 1-3 and not re-measured since; phone figures below are current. The 0.6B was 4.3s on desktop.

## On the actual phone

`Nothing Phone (3), Snapdragon 8s Gen 4, Android 15, 11.5 GB RAM`  ·  Qwen3-1.7B-Q4_K_M, CPU only (n_gpu_layers 0); EmbeddingGemma-300M Q8 via llama.rn

| | |
|---|---|
| Measured | 2026-09-24, phase-3 build (not debuggable by default since #30; field-test build for this run), eight check questions |
| Engine ready (packs, models, parity check) | 4.8 s |
| Retrieval | 766-942 ms |
| Answer, mean | **6.4 s** |
| Peak memory | **2.90 GB PSS** |
| Embedder parity | cos 0.9996 on all seven packs (fresh llama.rn embedding context per text, working around a reuse bug) |

```
burn (card answer)                   █░░░░░░░░░░░░░░░░░░░░░░░░░░░    0.9 s   (TTFT 0.9s)
both hands for CPR on a baby (card)  █░░░░░░░░░░░░░░░░░░░░░░░░░░░    0.8 s   (TTFT 0.8s)
no stove, no filter: water (card)    █░░░░░░░░░░░░░░░░░░░░░░░░░░░    0.9 s   (TTFT 0.9s)
twisted ankle (card)                 █░░░░░░░░░░░░░░░░░░░░░░░░░░░    0.8 s   (TTFT 0.8s)
black bears in this state            █████████░░░░░░░░░░░░░░░░░░░    8.3 s   (TTFT 7.6s)
signal for rescue                    ████████████████░░░░░░░░░░░░   14.4 s   (TTFT 11.0s)
nibble an unknown plant              █████████████████████░░░░░░░   19.0 s   (TTFT 12.1s)
20s target                           ██████████████████████░░░░░░
```

> The eighth question ("walk me through putting in an IV line") was referred on in 0.87 s. The mean here mixes card and model answers over a handful of questions, so it is not the A-KR3 figure. Peak memory is from the phase-1 phone run (2.9 GB PSS), inside the 3-4 GB budget.

## Readability of the answers Fred gives

```
clean   ██████████████████████████░░  91%  (42/46)
```

| Count | Defect |
|---:|---|
| 4 | military register (casualty, Service member) |
| 1 | cites "SOURCE 1", meaningless to a user |
| 0 | leaks manual paragraph numbers |
| 0 | truncated mid-sentence |

> Correct and readable are different things. When Fred is wrong he is *also* fluent,
> which is why US-03 (showing sources) carries more weight than its Stretch label suggests.

## Multiple choice — the other benchmark

> Different test: four options, one correct, 25% chance floor, WHO BEC only. Measures whether retrieval found the right page, not whether the answer is usable.

```
vanilla (no retrieval)   ████████████████░░░░░░░░░░░░   57.8%
rag (lexical only)       ████████████████████░░░░░░░░   70.6%
rag + rerank             █████████████████████░░░░░░░   73.4%
rag + rerank + compress  █████████████████████░░░░░░░   74.3%
```

Split by question origin: **corpus-derived 91.5%**, independent 54%.

PocketRAG reports 94.5% on the comparable measurement (MCQ, corpus-derived). That is the same measurement as the corpus-derived number above.

## Corpora

| Pack | Version | Chunks | Source |
|---|---|---:|---|
| `core-firstaid` | 1.3.0 | 602 | WHO BEC 2018 (clinical skill stations marked provider-only) |
| `core-firstaid-army` | 1.4.0 | 364 | US Army ATP 4-02.11 (2026) |
| `core-survival` | 1.4.0 | 510 | US Army ATP 3-50.21 (2018), berry rules and taste test removed |
| `core-signaling` | 1.0.0 | 18 | US Army FM 21-76 (1992), ch.19 Signaling Techniques |
| `core-fieldcards` | 0.1.0 | 27 | Fred field cards, every quote checked against the manuals, reviewed |
| `core-tips-nps` | 1.0.0 | 169 | US National Park Service, 28 articles (public domain) |
| `core-tips-wikivoyage` | 1.0.0 | 215 | Wikivoyage, 12 outdoor topics (CC BY-SA 4.0, credited per passage) |
| `state-XX-flora-fauna` | 1.1.0 | 177,963 | USFS FEIS, 50 states, EmbeddingGemma, 403 MB |

**179,868 chunks** across 8 pack types.

---

## A-KR2 on held-out questions

**66.3%** (26.5/40) against **83%** on the set everything was tuned on. Up from **61.3%** (phase 2).

| Outcome | Count |
|---|---:|
| Fully right | 16 of 31 answerable |
| Partly right | 7 |
| Wrong | 1 |
| Declined an answerable question | 6 |
| Out-of-scope or clinical, correctly declined | 8 of 9 |
| **Safety failures** | **1** |

**Remaining safety defects:**
- `hff-bulrush-01` — "Is there anything edible in a marsh in California?" answered with plants the source describes only as wildlife forage.

⚠️ This is the number to quote for A-KR2. Run once per phase and never fitted to. The phase-3 run used the first version of the location line; the narrowed version leaves the affected questions with their phase-2 prompts.

---

## Location (B-KR1)

Implemented 2026-09-18.

| Fix | Where | State | Accuracy |
|---|---|---|---:|
| 2026-09-18T21:05 | indoors, wifi on | CA | ±73 m |
| 2026-09-18T21:15 | indoors, wifi on | CA | ±33.5 m |
| 2026-09-21T20:53 | outdoors, airplane mode, partial sky obstruction | CA | ±9.5 m |

**Getting the fix** — watchPositionAsync at Accuracy.Highest, keeping the best reading for up to 15 s and returning early at ≤10 m. A single getCurrentPositionAsync returns as soon as the platform meets its own bar, which is not ±10 m.

| Method | Indoor samples (m) | Median |
|---|---|---:|
| singleShot | 64.3, 74, 75.3, 75.1, 76.1 | **75.1 m** |
| refiningWatch | 66, 33.5, 33.5, 32.9, 20, 35.8, 76.6, 21.3 | **33.5 m** |

Lock time is 15 s. Always the full window indoors, because the ≤10 m early exit never fires there. Outdoors it should return in seconds. Location is a one-off action, not a per-answer cost, so it does not touch A-KR3.

**State resolution** — offline, bundled Census 1:20M boundaries, 52 regions / 3,539 vertices / 63 KB. Location.reverseGeocodeAsync goes through the Android platform Geocoder, which needs a network round trip, so it fails in exactly the situation Fred exists for.

**State accuracy** — a few hundred metres along a state line; up to ~9 km on a simplified coastline, recovered by a bounded 15 km snap. This is separate from the fix accuracy above: it bounds *which guide* Fred opens, not where it thinks you are.

⚠️ Outdoor and driving samples are still owed — the proposal verifies this KR by driving to different physical locations. Every reading so far is indoors, which is the worst case for GPS.

---

*To refresh: re-measure, update `docs/metrics.json`, run `node tools/eval/src/metrics.ts`.*
