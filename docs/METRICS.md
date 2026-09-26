# Fred — metrics at a glance

*Generated from `docs/metrics.json` — do not edit by hand. Last updated **2026-09-25**.*

```
model              Qwen3-1.7B-Q4_K_M
embedder           EmbeddingGemma-300M (GGUF Q8), meaning-only search of the whole question
retrieval          4 passages, best field card reserved a place from 0.35
answers            a clearly matching field card verbatim; otherwise Qwen3-1.7B from the passages; clinical procedures referred on
abstainThreshold   0.29
scoring            four-part rubric since 2026-09-24: safe first, then correct, on the question, sounds like Fred
measuredOn         desktop harness for accuracy; Nothing Phone (3) for device latency and memory
akr2Target         80% (working target, lowered from 90% on 2026-09-18)
```

## Milestone scorecard

| KR | What | Due | Now | Grade |
|---|---|---|---|---|
| `A-KR1` | Necessary knowledge corpora | 2026-09-18 | **all 3 types, 50 states** | 🟢 A |
| `A-KR2` | Response accuracy | 2026-10-12 | **66.3%** / 80%<br><sub>83% tuning set</sub> | 🔴 D |
| `A-KR3` | Response time | 2026-10-19 | **15.4s** / 10s | 🟡 B |
| `B-KR1` | Location while in service | 2026-10-26 | **9.5m** / 10m | 🟢 A |
| `B-KR2` | Offline location estimate | 2026-11-10 | **on device** | 🔵 built, unverified |
| `B-KR3` | Predicted service zone | 2026-11-16 | **on device** | 🔵 built, unverified |
| `RC-KR1` | iOS and Android app | 2026-11-25 | — | ⚪ not started |
| `RC-KR2` | Product page | 2026-12-02 | — | ⚪ not started |
| `RC-KR3` | Promotional material | 2026-12-09 | — | ⚪ not started |

- `A-KR1` — First aid, survival, signalling, flora/fauna. 5 core packs (WHO BEC, ATP 4-02.11, ATP 3-50.21, FM 21-76 ch.19 signalling, 27 reviewed field cards) and 50 state packs, all built for the EmbeddingGemma search model as of 2026-09-25: 55 packs, 408 MB. CA and OR are on the phone; the other 48 wait for it to be connected.
- `A-KR2` — Held-out set, 40 questions nothing was tuned on, four-part rubric. 50.0% (the old pipeline regraded on the rubric) -> 62.5% phase 1 (EmbeddingGemma, field cards) -> 61.3% phase 2 (card slot, survival-manual redactions) -> 66.3% phase 3 (verbatim card answers, clinical procedures referred on, state named in the prompt, signalling source). Safety failures 4 -> 1; tuning 38.5 -> 83.0 with none. One held-out answer is 2.5 points, and one grader who knew which run was which scored every run. docs/results-phase3.md.
- `A-KR3` — Phone mean for model-written answers, Nothing Phone (3), 2026-09-24 (phase 1, range 9.9-24.1 s). Since phase 3, an answer from a field card skips generation: measured on the phone at 0.77-0.88 s end to end (4 of 7 check questions). Model-written answers on the same run took 8.3-19.0 s. Still inside the 10-20 s band.
- `B-KR1` — 9.5 m median outdoors in airplane mode, best 5.6 m, five attempts (docs/results-bkr1-outdoor.md). The 33.5 m indoor figure was WiFi positioning, not GPS — indoors the 10 m early exit never fires. PROVISIONAL: one location. The KR is verified by driving to different physical locations and that has not happened.
- `B-KR2` — Built and rendering on device: per-state PMTiles basemap at z14 via MapLibre, with the estimated zone drawn as the GPS's own 68% confidence radius. The 9.5 m airplane-mode measurement above is the WiFi-off case this KR asks about, ~100x inside its ±1 km target. Unverified: needs the drive.
- `B-KR3` — Built and rendering on device. FCC BDC hexagons aggregated to H3 res 7; all three major LTE carriers for California are 71,211 cells in a 7.1 KB pack. Nearest-coverage search reports bearing and distance offline. Unverified: needs the drive.
- `RC-KR1` — iOS launches on the simulator (Xcode 27). Needed expo 57.0.24 + scene support; Android not rebuilt since. See results-ios-build.md.
- `RC-KR2` — Not started.
- `RC-KR3` — Not started.

## A-KR2 — answer accuracy over time

```
baseline (0.6B)                             ███████████░░░░░░░░░░░░░░░░░   38.2%   0.6B
+ conditional prompt                        ████████████░░░░░░░░░░░░░░░░   44.1%   0.6B
+ Qwen3-1.7B                                ██████████████░░░░░░░░░░░░░░   48.5%   1.7B
+ scope gate, lay lexicon                   ███████████████████░░░░░░░░░   69.1%   1.7B
+ gate 0.29                                 ████████████████████░░░░░░░░   70.6%   1.7B
I: routing as a hint (held out)             ██████████████████░░░░░░░░░░   62.5%   Qwen3-1.7B
rubric: old pipeline regraded (held out)    ██████████████░░░░░░░░░░░░░░   50.0%   Qwen3-1.7B
phase 1: EmbeddingGemma, cards (held out)   ██████████████████░░░░░░░░░░   62.5%   Qwen3-1.7B
phase 2: card slot, redactions (held out)   █████████████████░░░░░░░░░░░   61.3%   Qwen3-1.7B
phase 3: card answers, referral (held out)  ███████████████████░░░░░░░░░   66.3%   Qwen3-1.7B
TARGET                                      ██████████████████████░░░░░░   80.0%
```

**38.2% → 66.3%** (+28.1 points). Target is 80%.

> The rows are not all the same measurement. Rows before "rubric" were scored yes/no, all but the last on the tuning set. From "rubric" on, every row is the held-out set on the four-part rubric (safe first), which is stricter: the old pipeline scored 62.5% yes/no and 50.0% on the rubric. Compare within each group.

The score has two halves:

| Half | Score | What it measures |
|---|---|---|
| answerable | **16/31** — 51.6% | held-out questions Fred should answer, fully right (7 more partly right, 1 wrong, 6 declined) |
| decline | **8/9** — 88.9% | held-out questions Fred should decline or ask a location for, handled correctly |

### Follow-up questions (conversation memory, 2026-09-26)

Measured separately: a second question that only makes sense after the first.
Held-out two-turn set, 13 conversations, run once: **46% → 81%** with memory
(6.0 → 10.5), no unsafe answers either way. Single-question answers are byte for
byte unchanged, so the 66.3% above stands. docs/results-memory.md.

### Where the remaining points are

| Lost | Why | What would fix it |
|---:|---|---|
| 6 | declined answerable questions (held out), mostly unusual wording the search does not match | no safe lever yet. A second search in manual wording recovered ~9 on tuning but let 14 out-of-scope questions through (rejected, docs/results-phase3.md step 4) |
| 7 | partly right (held out): a card that answers without leading with the answer, or a model answer missing a key point | cards could carry a short direct answer per common question; the model misses are generation quality |
| 1 | unsafe: hff-bulrush-01 treats plants wildlife eat as food for people | no card matches the question; the wild-plants card already says animals eating a plant is not a test |
| 1 | a card matched a neighbouring topic (map orientation got finding north) | the clear-match rule (0.35, or 0.32 and top) has thin margins; more cards or a tighter bar |

## A-KR3 — response time

```
(longer bar = slower; the target is to stay left of the 10s mark)

target   10.0 s   ██████████████░░░░░░░░░░░░░░  <-- 10s
mean     11.4 s   ████████████████░░░░░░░░░░░░
median   11.0 s   ███████████████░░░░░░░░░░░░░
p95      17.7 s   █████████████████████████░░░
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
10s target                           ███████████░░░░░░░░░░░░░░░░░
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
| `state-XX-flora-fauna` | 1.1.0 | 177,963 | USFS FEIS, 50 states, EmbeddingGemma, 403 MB |

**179,484 chunks** across 6 pack types.

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
