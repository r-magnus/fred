# Fred — metrics at a glance

*Generated from `docs/metrics.json` — do not edit by hand. Last updated **2026-09-17**.*

```
model              Qwen3-1.7B-Q4_K_M
embedder           gte-small (ONNX)
abstainThreshold   0.29
topK               4
measuredOn         desktop harness (node-llama-cpp), settings aligned to device
```

## Milestone scorecard

| KR | What | Due | Now | Grade |
|---|---|---|---|---|
| `A-KR1` | Necessary knowledge corpora | 2026-09-18 | **all 3 types, 50 states** | 🟢 A |
| `A-KR2` | Response accuracy | 2026-10-12 | **70.6%** / 90% | 🟠 C |
| `A-KR3` | Response time | 2026-10-19 | **11.4s** / 10s | 🟡 B |
| `B-KR1` | Location while in service | 2026-10-26 | — | ⚪ not started |
| `B-KR2` | Offline location estimate | 2026-11-10 | — | ⚪ not started |
| `B-KR3` | Predicted service zone | 2026-11-16 | — | ⚪ not started |
| `RC-KR1` | iOS and Android app | 2026-11-25 | — | ⚪ not started |
| `RC-KR2` | Product page | 2026-12-02 | — | ⚪ not started |
| `RC-KR3` | Promotional material | 2026-12-09 | — | ⚪ not started |

- `A-KR1` — First aid, survival, flora/fauna. 53 packs, 186,855 chunks.
- `A-KR2` — Free-form answers graded against an answer sheet, all five corpora.
- `A-KR3` — Desktop mean. NOT yet measured on device at this model size.
- `B-KR1` — Not started. No location code exists.
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
| 14 | answered but the prose was not good enough | NLI grounding verifier (~1 day); catches fabrication and inversion |
| 6 | answered a question no corpus covers | sufficient-context classifier (~4 hrs); these contain domain words so routing cannot see them |

## A-KR3 — response time

```
(longer bar = slower; the target is to stay left of the 10s mark)

target   10.0 s   ██████████████░░░░░░░░░░░░░░  <-- 10s
mean     11.4 s   ████████████████░░░░░░░░░░░░
median   11.0 s   ███████████████░░░░░░░░░░░░░
p95      17.7 s   █████████████████████████░░░
```

**30 of 68** queries exceed ten seconds. Desktop, 1.7B. The 0.6B was 4.3s mean with 0 over ten seconds.

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

*To refresh: re-measure, update `docs/metrics.json`, run `node tools/eval/src/metrics.ts`.*
