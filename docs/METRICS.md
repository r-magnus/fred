# Fred — metrics at a glance

*Generated from `docs/metrics.json` — do not edit by hand. Last updated **2026-09-18**.*

```
model              Qwen3-1.7B-Q4_K_M
embedder           gte-small (ONNX)
abstainThreshold   0.29
topK               4
measuredOn         desktop harness for accuracy; Nothing Phone (3) for device latency and memory
```

## Milestone scorecard

| KR | What | Due | Now | Grade |
|---|---|---|---|---|
| `A-KR1` | Necessary knowledge corpora | 2026-09-18 | **all 3 types, 50 states** | 🟢 A |
| `A-KR2` | Response accuracy | 2026-10-12 | **35%** / 90% | 🔴 F |
| `A-KR3` | Response time | 2026-10-19 | **14.7s** / 10s | 🟡 B |
| `B-KR1` | Location while in service | 2026-10-26 | **33.5m** / 10m | 🟡 B |
| `B-KR2` | Offline location estimate | 2026-11-10 | — | ⚪ not started |
| `B-KR3` | Predicted service zone | 2026-11-16 | — | ⚪ not started |
| `RC-KR1` | iOS and Android app | 2026-11-25 | — | ⚪ not started |
| `RC-KR2` | Product page | 2026-12-02 | — | ⚪ not started |
| `RC-KR3` | Promotional material | 2026-12-09 | — | ⚪ not started |

- `A-KR1` — First aid, survival, flora/fauna. 53 packs, 186,855 chunks.
- `A-KR2` — Held-out set, 40 questions nothing was tuned on (docs/results-holdout.md). The 70.6% previously reported here is the score on the 68 questions the scope gate, lay lexicon, prompt shape and abstention threshold were all fitted against — a training score. The gap is almost entirely routing: the lexicon reaches 46/46 answerable questions on the set it was built from and 16/31 on new ones.
- `A-KR3` — Device mean, Nothing Phone (3). Desktop was 11.4s, so the phone runs ~1.3x slower at this model size. Still inside the 10-20s band.
- `B-KR1` — Working on device: expo-location fix plus offline state resolution (packages/geo), no network geocoding. 33.5 m is the median of 8 consecutive indoor samples, where GPS cannot lock and the platform falls back to WiFi positioning. Indoors is the worst case, so this is a floor. The KR is verified by driving outdoors, which has not been done yet.
- `B-KR2` — Not started. The harder half of Beta.
- `B-KR3` — Data source identified (FCC BDC, ~310MB at H3 res 7). No code.
- `RC-KR1` — Android harness only. iOS never built.
- `RC-KR2` — Not started.
- `RC-KR3` — Not started.

## A-KR2 — answer accuracy over time

```
baseline (0.6B)            ███████████░░░░░░░░░░░░░░░░░   38.2%   0.6B
+ conditional prompt       ████████████░░░░░░░░░░░░░░░░   44.1%   0.6B
+ Qwen3-1.7B               ██████████████░░░░░░░░░░░░░░   48.5%   1.7B
+ scope gate, lay lexicon  ███████████████████░░░░░░░░░   69.1%   1.7B
+ gate 0.29                ████████████████████░░░░░░░░   70.6%   1.7B
TARGET                     █████████████████████████░░░   90.0%
```

**38.2% → 70.6%** (+32.4 points). Target is 90%.

The score has two halves:

| Half | Score | What it measures |
|---|---|---|
| judged | **32/46** — 69.6% | questions Fred answered, prose graded against an answer sheet |
| outcome | **16/22** — 72.7% | questions Fred should decline or ask location for, scored on what he did |

### Where the remaining points are

| Lost | Why | What would fix it |
|---:|---|---|
| 6 | answered a question no corpus covers | sufficient-context classifier (~4 hrs); these carry domain words so routing cannot see them |
| 6 | grounded in the right chunk but the wrong focus, or incomplete | retrieval and prompt work; no latency cost. The largest single group |
| 4 | declined despite retrieval succeeding | prompt or model; two had the answer in the top chunk. No latency cost |
| 4 | fabricated or inverted a fact | NLI grounding verifier — the only technique that catches these, but ~2s per answer (docs/results-nli-research.md) |

## A-KR3 — response time

```
(longer bar = slower; the target is to stay left of the 10s mark)

target   10.0 s   ██████████████░░░░░░░░░░░░░░  <-- 10s
mean     11.4 s   ████████████████░░░░░░░░░░░░
median   11.0 s   ███████████████░░░░░░░░░░░░░
p95      17.7 s   █████████████████████████░░░
```

**30 of 68** queries exceed ten seconds. Desktop, 1.7B. On device the mean is 14.7s over four questions (10.1 / 22.8 / 15.8 / 10.0). The 0.6B was 4.3s on desktop.

## On the actual phone

`Nothing Phone (3), Snapdragon 8s Gen 4, Android 15, 11.5 GB RAM`  ·  Qwen3-1.7B-Q4_K_M, CPU only (n_gpu_layers 0)

| | |
|---|---|
| Pack load | 249 ms (four packs) |
| Model load | 1.8 s |
| Retrieval | 54-106 ms |
| Answer, mean | **14.7 s** |
| Peak memory | **3.02 GB PSS** / 3.12 GB RSS |
| Idle after run | 411 MB PSS |
| Embedder parity | OK cos=1.0000 on all four packs |

```
control severe external bleeding  ███████████░░░░░░░░░░░░░░░░░   10.1 s   (TTFT 7.5s)
build a shelter                   ██████████████████████████░░   22.8 s   (TTFT 7.0s)
rattlesnake bit my leg            ██████████████████░░░░░░░░░░   15.8 s   (TTFT 8.7s)
what does poison oak look like    ███████████░░░░░░░░░░░░░░░░░   10.0 s   (TTFT 6.0s)
10s target                        ███████████░░░░░░░░░░░░░░░░░
```

> Peak memory is during generation; it falls to ~411 MB once the context is released, so sample while it is working.

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
| `core-firstaid` | 1.0.0 | 667 | WHO BEC 2018 |
| `core-firstaid-army` | 1.1.0 | 410 | US Army ATP 4-02.11 |
| `core-survival` | 1.1.0 | 563 | US Army ATP 3-50.21 |
| `state-XX-flora-fauna` | 1.0.0 | 185,215 | USFS FEIS, 50 states, 309 MB |

**186,855 chunks** across 4 pack types.

---

## A-KR2 on held-out questions

**35.0%** (14/40) against **70.6%** on the set everything was tuned on.

The gap is routing, not generation:

| Set | Answerable questions that reached the model |
|---|---|
| tuning (lexicon built from it) | 46/46 — 100% |
| held out | 16/31 — 52% |

Answerable questions that got any retrieval at all. 15 of 18 holdout failures scored U=0.000, from two distinct bugs: 11 matched no domain vocabulary at all, and 4 matched only plants/wildlife, which no core pack declares, so routing selected state packs only and asked for a location instead of searching core-survival.

**Safety defects this surfaced:**
- `hf-woundpack-01` — Answered 'Yes' to packing an abdominal wound; the source says explicitly not to. Direct inversion.
- `hf-cpr-infant-01` — Said two or three fingers for an infant, then said to place the heel of one hand. A reader following the steps in order does the dangerous thing.

⚠️ This is the number to quote for A-KR2. Run it rarely and never fit to it; calibrate.ts refuses by default.

---

## Location (B-KR1)

Implemented 2026-09-18.

| Fix | Where | State | Accuracy |
|---|---|---|---:|
| 2026-09-18T21:05 | indoors, wifi on | CA | ±73 m |
| 2026-09-18T21:15 | indoors, wifi on | CA | ±33.5 m |

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
