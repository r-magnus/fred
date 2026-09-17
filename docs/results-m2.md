# M2 — Evaluation harness and first accuracy numbers

**Model:** Qwen3-0.6B-Q4_K_M · **Encoder:** gte-small fp16 · **Pack:** core-firstaid-v1.0.0 (825 chunks)
**Eval set:** 46 questions — 30 corpus-derived, 16 independent. Key positions balanced 12/12/11/11.
**Scoring:** raw-completion with a `root ::= [ABCD]` GBNF grammar, so no answer can fail to parse.

## Headline

> **Superseded.** The two tables in this section are the first run, at n = 46 and
> under a prompt that no longer exists. They are kept because the McNemar analysis
> below refers to them. **The current MCQ numbers are the n = 109 re-run at the end
> of this file**, and the free-form graded numbers that A-KR2 is actually scored on
> are in `docs/results-akr2.md` — that eval measures a different task and does not
> reproduce this ordering.

| Condition | Accuracy | Mean ms | Prompt tokens |
|---|---:|---:|---:|
| vanilla | 63.0% | 191 | 55 |
| rag (lexical only) | **80.4%** | 4244 | 1271 |
| rag-rerank (hybrid) | 71.7% | 4171 | 1252 |
| rag-rerank-compress | 67.4% | 3259 | 1021 |

## The result that matters: provenance splits the picture

| Condition | corpus-derived (n=30) | independent (n=16) |
|---|---:|---:|
| vanilla | 53.3% | **81.3%** |
| rag | **90.0%** | 62.5% |
| rag-rerank | 76.7% | 62.5% |
| rag-rerank-compress | 70.0% | 62.5% |

Paired McNemar tests on the same questions:

| Comparison | Discordant | p | Verdict |
|---|---|---:|---|
| corpus-derived: vanilla → rag | 12 gains / 1 loss | **0.003** | **significant** |
| independent: vanilla → rag | 1 gain / 4 losses | 0.375 | underpowered |
| all: rag → rag-rerank | 1 gain / 5 losses | 0.219 | underpowered |
| all: rerank → +compress | 4 gains / 6 losses | 0.754 | no effect |
| **all questions: vanilla → rag** | 13 gains / 5 losses | **0.096** | **not significant** |

**What is established:** RAG produces a large, statistically significant gain on
corpus-derived questions (+36.7 pp, p = 0.003). This replicates the paper's
direction and magnitude.

**What is suggestive but not established:** on independent questions RAG appears
to *hurt* (81.3% → 62.5%), and reranking appears to hurt relative to lexical-only
retrieval. Neither reaches significance at this sample size.

**The methodological point stands regardless of significance.** Measured on
corpus-derived questions alone, RAG looks like a decisive win. Measured across
both sets, the aggregate effect is **not significant (p = 0.096)** — because the
gain on corpus-derived questions and the loss on independent ones partly cancel.

PocketRAG derives all 200 of its MCQs from the same WHO corpus its system
retrieves from. That design cannot observe this cancellation. Its reported
accuracy is therefore best read as *retrieval and reading comprehension over a
known corpus*, not as first-aid competence — and the gap between our two sets is
a measurement the paper's methodology structurally cannot produce.

A plausible mechanism for the independent-set drop: handed ~1,200 tokens of
topically-related-but-non-answering context, a 0.6B model is pulled away from
parametric knowledge it already had. If that holds up with more questions, it
argues directly for the abstention gate — retrieving nothing useful should
suppress the answer, not decorate it.

## Limitation: the eval set is too small

n = 46 (30 / 16) is not enough. Only the strongest effect clears significance;
an 8.7 pp difference between conditions is about four questions. **Expanding
toward the paper's 200 is the single highest-value next step**, and the split
should stay roughly 2:1 corpus-derived to independent so both cells have power.

## A harness bug worth reporting

The first run returned **exactly 26.1% in all four conditions**. Nothing errored
and the table looked entirely normal — it reads as "RAG does not help on this
corpus." The model had answered **"A" on 46 of 46 questions in every arm**, and
26.1% is precisely the fraction of keys that happen to be A.

Cause: scoring ran through `LlamaChatSession`, which applies Qwen3's chat
template. That template opens the assistant turn with a `<think>` block, so a
`root ::= [ABCD]` grammar constrained a position whose distribution concerns
reasoning tokens rather than answer letters. Masking there collapsed to a
constant. Switching to raw `LlamaCompletion`, with no chat template, fixed it.

Two lessons for the writeup:

1. **Evaluating a reasoning model through a chat template with constrained
   decoding yields a silent, plausible null result.** Anyone replicating this
   paper with Qwen3 could report "no effect" and never see an error.
2. **Check the answer distribution, not just the accuracy.** Identical accuracy
   across four different conditions is the tell; 46/46 "A" made the cause
   obvious in a single query.

---

# Update — corpus cleanup (2026-09-04)

25.7% of the pack was course apparatus rather than clinical knowledge:
acknowledgements and contributor lists, course administration, module
objectives, key-terms exercises, case-scenario worksheets, and blank ABCDE
assessment checklists. All of it is topically adjacent, so it embeds near real
clinical content and competes for the top-k. `tools/ingest/src/filter.ts` now
removes it at ingest, and `verify-filter.ts` asserts that no passage cited by an
eval question is lost.

**Pack: 825 → 613 chunks, 1.37 MB → 1.06 MB.**
**Practice-MCQ contamination: 9 chunks → 0.** The manual embeds its own
multiple-choice questions, and their option text ("Give intramuscular adrenaline
C.") was previously indexed and retrievable.

## Accuracy, before and after

| Condition | Before | After | Δ | p (paired) |
|---|---:|---:|---:|---:|
| vanilla | 63.0% | 63.0% | 0.0 | — |
| rag | 80.4% | 76.1% | −4.3 | 0.625 |
| rag-rerank | 71.7% | 76.1% | +4.3 | 0.500 |
| rag-rerank-compress | 67.4% | 69.6% | +2.2 | 1.000 |

**The cleanup produced no statistically detectable accuracy change.** Every
comparison is p > 0.5; the deltas are one or two questions at n = 46.

It was still the right change, on grounds that do not depend on this measurement:
the pack is 23% smaller, the eval can no longer retrieve the corpus's own
multiple-choice options, and a quarter of the index no longer consists of text
that cannot answer a question.

## What the cleanup did resolve

The apparent **"reranking hurts retrieval"** result from the first run has
dissolved. Before cleanup, rag beat rag-rerank 5 discordant to 1 (p = 0.219).
After cleanup the two are **identical at 76.1%, 3 discordant to 3 (p = 1.000)**.

The most likely reading is that the original gap was noise amplified by
scaffolding chunks in the candidate pool, not a real property of the fusion
weight. **α = 0.6 needs no adjustment on this evidence**, and the open question
from M2 is closed — provisionally, at this sample size.

## The core finding replicates

| Comparison (cleaned pack) | Discordant | p |
|---|---|---:|
| corpus-derived: vanilla → rag | 12 gains / 2 losses | **0.013** |
| corpus-derived: vanilla → rag-rerank | 12 gains / 3 losses | **0.035** |
| independent: vanilla → rag | 1 gain / 5 losses | 0.219 |
| independent: vanilla → rag-rerank | 0 gains / 3 losses | 0.250 |

RAG still helps significantly on corpus-derived questions and still, consistently
but not significantly, *hurts* on independent ones. Cleaning the corpus did not
change that divergence — which strengthens the reading that it is a property of
the evaluation design rather than of corpus quality.

Expanding the eval set remains the blocking item for the independent-set effect.

---

# Update — eval set expanded to 109 (2026-09-04)

46 → **109 questions**: 59 corpus-derived (every citation verified present in the
pack) and 50 independent. Key positions balanced. The expansion was undertaken
specifically to resolve two effects that were underpowered at n = 46.

| Condition | Overall | corpus-derived (n=59) | independent (n=50) | Abstain | Acc. when answering |
|---|---:|---:|---:|---:|---:|
| vanilla | 57.8% | 54.2% | 62.0% | — | 57.8% |
| rag | 72.5% | 88.1% | 54.0% | 11% | 74.2% |
| rag-rerank | **75.2%** | 86.4% | 62.0% | 17% | **79.1%** |
| rag-rerank-compress | 70.6% | 83.1% | 56.0% | 17% | 73.6% |

## Correction: "RAG hurts on independent questions" does not survive

At n = 46 the independent set showed 1 gain against 5 losses, and this document
previously reported that RAG *consistently but not significantly* hurt there. At
n = 50 independent questions that reverses:

| Comparison | Discordant | p |
|---|---|---:|
| independent: vanilla → rag | 5 gains / 9 losses | 0.424 |
| **independent: vanilla → rag-rerank** | **5 gains / 5 losses** | **1.000** |

With reranking the effect is *exactly zero* — 62.0% either way, five questions
gained and five lost. The earlier apparent penalty was noise from a small sample,
and the reading that RAG actively degrades answers on out-of-corpus questions
should be withdrawn.

Reranking is what recovers it: lexical-only retrieval loses ground on independent
questions (54.0%) while hybrid does not (62.0%), 1 gain against 5 for rerank,
though at p = 0.219 that is still not established.

## What is established, strongly

| Comparison | Discordant | p |
|---|---|---:|
| corpus-derived: vanilla → rag | 22 gains / 2 losses | **0.00004** |
| corpus-derived: vanilla → rag-rerank | 22 gains / 3 losses | **0.0002** |

RAG produces a very large gain on corpus-derived questions: **54.2% → 88.1%**.
That replicates PocketRAG's direction and magnitude convincingly.

## The methodological point, restated more precisely

The claim is no longer "RAG helps on one set and hurts on the other". It is
sharper than that:

> **RAG produces a 34-point gain on questions drawn from the indexed corpus and
> no measurable gain at all on questions that are not — 88.1% versus 62.0%, a
> 26-point gap.**

A benchmark built entirely from its own corpus, as PocketRAG's 200 MCQs are,
measures retrieval and reading comprehension over known text. It cannot
distinguish that from first-aid competence, because it contains no questions
where the two would diverge. Reporting both sets is what makes the distinction
visible, and the gap is the measurement the single-set design cannot produce.

## The abstention gate earns its place

| Condition | Abstained | Acc. on abstained | Answered | Acc. on answered |
|---|---:|---:|---:|---:|
| rag | 12 | 58.3% | 97 | 74.2% |
| rag-rerank | 18 | 55.6% | 91 | **79.1%** |

The gate withholds an answer on 17% of questions, and the model is markedly worse
on exactly those — 55.6% against 79.1%, a **23.5-point** separation. It is
selecting the questions it cannot answer, not firing at random.

This is not something the paper can report: an MCQ benchmark forces a choice, so
abstention can only ever look like a lost mark. Here it is measurable because
`wouldAbstain` is recorded alongside the forced answer.

## Selective context compression: a real trade, not a free win

Compression cuts prompt tokens 1190 → 983 (**−17%**) and mean latency 4030 ms →
2990 ms (**−26%**), and costs roughly 4 points of accuracy (86.4% → 83.1% on
corpus-derived; 9 gains against 4 losses overall, p = 0.267, not significant).

Given M0's finding that prefill dominates on mid-range hardware, a 26% latency
cut for a not-yet-significant accuracy cost is likely worth taking there and not
worth taking on a flagship. That is a per-device decision the paper does not make.

---

# Update — re-run under the simplified prompt (2026-09-05)

The system prompt changed during M3: the instruction to emit inline citations was
removed, because a 0.6B model sometimes answered with nothing but `[1], [3]`
(citations are a property of retrieval and are already returned structurally).
`tools/eval/src/run.ts` uses `SYSTEM_PREFIX` for every RAG condition, so the
previous table described a prompt that no longer exists. Re-run at n = 109.

| Condition | Overall | corpus (n=59) | independent (n=50) | Mean ms | Prompt tok | Acc. when answering |
|---|---:|---:|---:|---:|---:|---:|
| vanilla | 57.8% | 54.2% | 62.0% | 190 | 55 | 57.8% |
| rag | 67.9% | 83.1% | 50.0% | 3739 | 1149 | 68.0% |
| rag-rerank | 76.1% | 88.1% | 62.0% | 3765 | 1129 | 80.2% |
| **rag-rerank-compress** | **77.1%** | 88.1% | 64.0% | **3002** | **922** | **81.3%** |

**Sanity check:** vanilla is unchanged at 57.8%, to the question. It does not use
`SYSTEM_PREFIX`, so it should be identical, and it is — which confirms the change
was isolated to the retrieval arms.

## Two results that were not there before

**Re-ranking now significantly beats lexical-only retrieval.**

| Comparison | Discordant | p |
|---|---|---:|
| all: rag → rag-rerank | 1 gain / 10 losses | **0.0117** |

Under the previous prompt this was 4/7, p = 0.549 — no detectable difference,
and at one point it appeared to run the *wrong* way (see the earlier update).
With the shorter prompt, Stage 2 is demonstrably doing work: **+8.2 points**
overall, and it recovers the independent set entirely (50.0% → 62.0%). The
paper's Table 1 shows the same ordering; we can now reproduce it.

**Compression is free.**

| Comparison | Discordant | p |
|---|---|---:|
| all: rerank → +compress | 4 gains / 5 losses | 1.000 |

76.1% → 77.1%, while cutting prompt tokens 1129 → 922 (**−18%**) and latency
3765 ms → 3002 ms (**−20%**). Under the previous prompt compression cost about
4 points; with the instruction bloat removed it costs nothing measurable. So
Selective Context Compression is a **20% latency reduction at no accuracy cost**,
which is a stronger claim than the earlier "real trade, not a free win" — and it
matters most on the mid-range hardware where M0 showed prefill dominating.

## Unchanged

| Comparison | Discordant | p |
|---|---|---:|
| corpus-derived: vanilla → rag-rerank | 22 gains / 2 losses | **0.00004** |
| independent: vanilla → rag-rerank | 6 gains / 6 losses | 1.000 |

RAG still produces a very large, highly significant gain on corpus-derived
questions (54.2% → 88.1%) and is still *exactly* neutral on independent ones —
six gained, six lost. The withdrawal of the "RAG hurts independent questions"
claim stands, and the 26-point corpus/independent gap remains the central
methodological finding.

## Note on scope

These numbers are produced with node-llama-cpp on both sides of the comparison,
which `docs/results-m3.md` establishes reproduces the reference implementation to
four decimals. They are therefore valid. They are **not** currently reproduced on
device, because llama.rn's embedding path diverges; that is a defect in the device
runtime, not in these measurements.
