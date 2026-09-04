# M2 — Evaluation harness and first accuracy numbers

**Model:** Qwen3-0.6B-Q4_K_M · **Encoder:** gte-small fp16 · **Pack:** core-firstaid-v1.0.0 (825 chunks)
**Eval set:** 46 questions — 30 corpus-derived, 16 independent. Key positions balanced 12/12/11/11.
**Scoring:** raw-completion with a `root ::= [ABCD]` GBNF grammar, so no answer can fail to parse.

## Headline

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
