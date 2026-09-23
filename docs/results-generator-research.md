# A-KR2 — what is left to try on the model itself

Desk research, 2026-09-22, after four measured rejections. No code.

**Short version: the strongest untried lever is a bigger generator, and there is
now external evidence that Qwen3-1.7B specifically is bad at the thing Fred
needs. Second is Qwen3's thinking mode, which was disabled for a latency budget
that no longer binds. Both are free to test on desktop.**

## Where this starts

62.5% held out against 80%, due 2026-10-12. Four approaches measured and
rejected:

| Approach | Outcome |
|---|---|
| Generator swap to SmolLM2-1.7B | 28 vs 38 graded. Extractive — emits raw document fragments |
| Numeric sufficiency wording | 0 of 3 on dosing, twice |
| NLI grounding verifier | Flags 3 of 9 failures and 2 of 22 good answers; net negative (`results-verifier-test.md`) |
| Answer-shape prompting | 1 of 5 fixed, refusals 18 → 22 (`results-answer-shape.md`) |

All nine remaining held-out failures have four citations and a non-zero score.
**Retrieval is not the problem and has not been for two weeks.**

## 1. A bigger generator — the one with outside evidence

A 2026 benchmark of small models on a RAG classification task reports
**Qwen3-4B at 95.64%** while **Qwen3-1.7B *declined* under RAG, 43.30%
few-shot to 28.96% with retrieval** ([arXiv 2601.07790](https://arxiv.org/html/2601.07790v1)).
The paper's framing is the interesting part: RAG "can introduce additional
challenges for models that struggle to meaningfully incorporate retrieved
context".

That is a precise description of Fred's remaining failures — three declines with
good passages in hand, three inversions of the source, three answers to a
different question. **The model is being handed the right text and not using
it.**

Caveat that matters: that benchmark is log-severity classification, not first
aid, and a single number on a different task does not transfer. It is a reason
to run the experiment, not a prediction of the result.

| Candidate | Q4_K_M | vs today |
|---|---:|---:|
| Qwen3-1.7B *(shipping)* | 1.03 GB | — |
| Qwen3.5-2B *(declined as "too big", never measured)* | 1.40 GB | 1.4x |
| **Qwen3.5-4B** | **2.81 GB** | **2.7x** |

The phone has 11.5 GB RAM and 168 GB free. `docs/results-m0.md` flags a "~2 GB
app-sandbox budget" as **never validated**, and llama.cpp allocates native
memory rather than Java heap, so the ceiling is likely higher than that note
assumes. `app.json` still has `largeHeap: false`.

**The trade to name honestly: A-KR3.** Response time is 14.7 s against a 10 s
target, graded B inside a 10-20 s band. A 4B model is roughly 2.4x the weights
and will not stay in that band. The owner has said accuracy beats latency and
the current window is fine — but "fine" was said about 14.7 s, not about what
4B would cost. **Measure the latency alongside the accuracy and put both in
front of him before shipping it.**

## 2. Thinking mode, whose objection has expired

`device-pack.ts` sets `enable_thinking: false` with this reason: on Qwen3 it
"spends the whole budget inside `<think>` before any visible text — measured at
3.1x latency on desktop and **an empty answer under a token cap**".

Two things changed. Latency is no longer a constraint. And the second half of
that sentence is not a latency problem at all — it is a **token budget** problem.
The thinking tokens consumed `n_predict` before the answer began. Raising the
cap is a one-line change that was never tried, because there was no reason to
try it while latency ruled.

Reasoning modes are the obvious fit for the failure classes here: an inversion
("do not pack the abdomen" → "yes, if deep") and a wrong-focus answer are both
failures of *reading* the passage rather than of retrieving it.

**Cheapest real experiment on the board.** No new model, no download.

## 3. Quantisation — cheap, and probably not it

Current is Q4_K_M. 2026 surveys put Q8 at near-lossless and Q4_K_M at minor
loss, with the specific note that **commonsense reasoning is resilient to
quantisation while arithmetic degrades below 4 bits**
([dev.to](https://dev.to/pat9000/gguf-quantization-explained-q4km-vs-q5km-vs-q8-which-to-pick-2026-31pl)).

Fred's failures are inversions and wrong focus, not arithmetic, so the prior is
that this is not the cause. Worth one run precisely because it is nearly free —
Q6_K of the current model is ~1.5 GB and the harness takes `GEN_MODEL`. Treat a
null result as expected.

## 4. Things deliberately not recommended yet

- **Fine-tuning.** `results-improvement-research.md` notes a 1B model trained
  with GRPO on 723M tokens on a single GPU, and that grounding is learnable from
  limited data. Real, and the largest effort on this list — it needs a GPU,
  training data this project does not have, and a held-out discipline that
  survives having trained on the domain. Not before the deadline.
- **Reranking.** All nine failures already have the right passages at hand.
  Reordering them cannot fix a model that inverts what it reads.
- **KV cache quantisation.** `device-pack.ts` flags it as needing a CPU retest
  after its "word salad" result was measured on a GPU-offloaded context. That is
  a memory and latency lever, not an accuracy one, and matters only if a larger
  model needs the headroom.

## The order to run them

1. **Thinking mode with a raised token cap**, current model, tuning set. One
   config change, no download. Hours.
2. **Qwen3.5-4B on desktop**, tuning set, graded read — then the held-out set
   *once* if it wins. Record latency next to accuracy.
3. **Q6_K of whichever model wins**, as a cheap null check.

Steps 1 and 2 are independent and can be graded in the same sitting. Both are
desktop-only: nothing here needs the phone until something is worth shipping.

**And if all three fail**, that is the fifth, sixth and seventh measured
rejection, and the report writes itself: a 1.7B-class model on this corpus
plateaus around 62%, with evidence rather than assertion behind the claim.
