# Accuracy, from a different angle — 2026-09-19

The first round (`results-improvement-research.md`) asked "which component should
we improve". Every answer was a thing to build, and the one we built first
(contextual retrieval) turned out to address a failure we do not have.

This round asks two different questions. **What does Fred have that he should
not?** And **what can he already afford that we have not been spending?**

Both turn out to have better answers than "build another component".

## 1. The router is not an optimisation. It is pure cost.

The router exists to narrow the search before it happens. So: measure what the
narrowing is worth.

```
mean unrouted Stage-1 over ALL 7,413 chunks on the device:   1.88 ms
recorded device answer time (metrics.json):                14,700 ms
```

Searching **every pack on the phone**, with no routing at all, costs **0.013% of
one answer**. The device only ever holds four packs — three core plus one state —
and FTS5 over 7,413 rows is not a problem worth solving.

Against that saving, routing costs **15 of 31 answerable held-out questions**.

| Pack on device | Chunks |
|---|---:|
| `core-firstaid-army` | 410 |
| `core-firstaid` | 667 |
| `core-survival` | 563 |
| `state-CA-flora-fauna` | 5,773 |
| **total** | **7,413** |

The literature agrees from the other direction. *The Coverage Illusion*
(arXiv 2605.27220) measured four ways of routing before retrieval — rules 38.4%,
best ML router 13.4%, fine-tuned neural encoder 26.2% — against a post-retrieval
cascade with no training at all at **72.2%**, which was also 31.8% faster.

**This is a deletion, not a build.** It is the cheapest change available and it
addresses the single largest loss. Routing should survive only as a hint that can
narrow the search, never as a gate that can empty it.

## 2. We have a latency budget and we have not been spending it

Every technique this project has considered was weighed as though latency were
scarce. Look at the actual numbers:

- An answer takes **14.7 s**. A-KR3's B band is 10-20 s, so there is roughly
  **5 seconds of headroom before the grade moves**.
- A cross-encoder reranker costs **50-150 ms** for **+5-15 points of recall@5**
  on hard queries. TinyBERT-class checkpoints are ~17 MB and designed for CPU
  devices with no GPU.

150 ms is **1% of one answer**. We have been protecting a resource we are not
using, and declining recall improvements priced in milliseconds while losing
half our questions to a 2 ms saving.

This also reprices the NLI verifier the earlier research shelved: ~2 s is 13% of
an answer, not a blocker. It stays low priority because it buys little
(`results-nli-research.md`), not because it is unaffordable.

## 3. Fred's model is a generation behind

Qwen3-1.7B was the right choice when it was picked. Since then:

- **Qwen3.5** (Alibaba, March 2026) — 0.8B to 9B, one architecture, Apache 2.0.
  Same family, so largely a drop-in.
- **Gemma 4** (Google DeepMind, 2 April 2026) — E2B at 2.3B effective and E4B at
  4.5B effective, 128K context.
- **SmolLM3-3B** — 64K native context, `/think` and `/no_think` modes.

And one finding that points straight at our generator failures: in comparisons of
small models for RAG, **SmolLM2-1.7B is reported as the most accurate at staying
grounded to retrieved content**, producing answers that track the provided
context without importing outside information.

That is exactly the axis Fred fails on. Four held-out questions were declined
with good retrieval in hand; two were inverted against the source. Neither is a
retrieval problem.

**A model swap is the cheapest experiment with real upside on the board.** No
architecture change, no re-ingest, no new component — change a path, re-run the
held-out set, read the number. An afternoon.

## 4. Learned sparse retrieval targets the exact weakness the holdout exposed

SPLADE-family retrieval performs automatic term expansion at index time, which is
the textbook fix for vocabulary mismatch. The property that matters here:

> Learned sparse retrieval often holds up better than dense embeddings on data
> that looks nothing like its training set, because it is anchored to actual
> words.

Generalising to unfamiliar data is precisely what our held-out set proved we
cannot do. **SPLARE** (ICLR 2026) replaces SPLADE's vocabulary projection head
with a sparse autoencoder and reportedly matches dense state of the art on MMTEB
while beating vocabulary-based sparse retrieval cross-domain.

There is direct evidence we need term expansion, independent of routing: even
searching every pack unrouted, **`paracord` returns 0 hits**. The corpus says
*cordage* and *parachute cord*. No amount of routing repair finds that passage —
it is a genuine lexical gap, and term expansion or a synonym layer is what closes
it. A hand-built synonym list is the cheap version; SPLADE is the principled one.

## 5. Grounding is learnable far more cheaply than assumed

We have treated the model as frozen throughout. *Models for minimalist RAG*
(arXiv 2607.27506) is worth knowing about: a 1B model trained with GRPO on
**723M tokens on a single GPU** — orders of magnitude below pretraining.

Two findings transfer even if we never fine-tune:

- **Grounding emerged without being supervised for it.** Rewarding answer
  similarity alone produced passage citation in 42.4% of responses, 5.6× the
  training-data rate. Grounding is an accuracy-maximising strategy, not a
  separate objective.
- **At 1B scale, losses are 56% factual errors, not hallucination.** Knowledge
  needs scale; *grounding behaviour is learnable from limited data*.

Filed as a real option rather than a recommendation — it is the largest lift here
and a capstone may not have the GPU time.

## Ranked

| # | Change | Cost | Addresses |
|---|---|---|---|
| 1 | **Delete the router as a gate** | negative — removes code, costs 2 ms | 15 of 31 lost questions |
| 2 | **Swap the generator** (Qwen3.5, or SmolLM2-1.7B for grounding) | an afternoon | 4 declines, 2 inversions |
| 3 | **Cross-encoder reranker** | 50-150 ms, ~17 MB | +5-15 recall@5 |
| 4 | **Term expansion / synonyms** | ingest-side | genuine lexical gaps (`paracord`) |
| 5 | Fine-tune for grounding | a GPU and a week | the generator, properly |
| — | ~~Contextual retrieval for recall~~ | 4.5 s/chunk | **measured: no recall benefit** |

## The through-line

Fred has been tuned for **precision** — a scope gate, a router that refuses, an
abstention threshold — while his actual failure is **recall**. And that precision
machinery was justified by a latency budget the measurements say we are not
spending.

The first three rows above are all cheap, and none of them is a new component.
