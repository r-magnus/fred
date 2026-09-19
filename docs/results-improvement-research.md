# How to improve Fred — desk research, 2026-09-19

Prompted by the held-out result (`results-holdout.md`): A-KR2 is 35%, the
dominant loss is retrieval never firing, and two safety inversions appeared.
This is research into what the field currently says about each, done before
building anything.

**The short version: three of my four planned fixes survive contact with the
literature, one does not, and the highest-value technique is one I had not
planned at all.**

## 1. Do not build a better router. Stop routing first.

*The Coverage Illusion: From Pre-retrieval Routing Failure to Post-retrieval
Cascades in a Production RAG System* (arXiv 2605.27220) is a production study of
exactly our failure — queries routed to an empty knowledge base, 15-20% of real
traffic, driven by out-of-vocabulary terms.

They tried four ways to route better, and all of them were bad:

| Approach | Result |
|---|---|
| Rule-based heuristics | 38.4% (random baseline is 20%) |
| Classification models (LR, gradient boosting) | best ML router **13.4%** |
| Neural encoder fine-tuning (all-MiniLM-L6-v2) | **26.2%** |
| Ridge regression on predicted quality | captured 3.7% of the oracle gap |
| **Post-retrieval cascade, no training at all** | **72.2%** |

The cascade is `Hybrid → query-expansion → HyDE`, escalating only when retrieval
comes back empty, with a deferral policy that scores minimum rather than
generating unsupported text. It beat every router while also cutting latency
31.8%, because most queries stop at the cheap first stage.

**This kills the semantic-routing plan as the primary fix.** Deciding where to
look before looking is the hard problem; looking and escalating is the easy one.
Our own fallback experiment already said the same thing from the other
direction: once allowed to search, retrieval found the right passage easily —
manzanita 0.877, bigleaf maple 0.799, prairie falcon 0.775, dead reckoning
0.689.

Fred still has a reason to route — 53 packs, state scoping, a phone CPU — so
routing stays as an *optimisation*. What changes is that **routing must never be
able to return nothing.** It narrows the search when it is confident and gets
out of the way when it is not.

## 2. Contextual retrieval at ingest — the best available deal

Anthropic's contextual retrieval writes a 50-100 token preamble for each chunk
placing it in its document, and prepends that before embedding. Reported: **35%
fewer top-20 retrieval failures** with contextual embeddings, **67%** combined
with contextual BM25 and a reranker. 2026 chunking surveys put the hybrid of
contextual retrieval and late chunking at **35-67% below naive fixed-size
chunking** on retrieval failure.

The reason this is the best deal available to Fred specifically: **the preamble
is generated at ingest, on a desktop, by a large model. The phone pays nothing.**
Every other technique here costs device latency. This one costs disk and a long
overnight ingest.

It also happens to attack both of our problems at once:

- **Vocabulary mismatch.** A preamble gives *tick*, *manzanita* and *paracord*
  chunks more surface for FTS5 to match, which is precisely the Stage-1 recall
  failure behind 11 of our 15 losses.
- **The inversion defect.** A chunk whose preamble reads *"lists actions to
  AVOID when treating a snakebite"* cannot be read as an instruction to perform
  them. We already carry headers into chunks (`tools/ingest/src/chunk.ts`) after
  the `results-alpha.md` defect; this is the general form of that fix.

**Cost to check before committing:** 186,855 chunks across 53 packs. At ~100
output tokens each that is a large but finite local-model job, and it is
embarrassingly parallel. Phase it — core first aid and survival are small and
carry all the safety-critical content.

## 3. Negation is a known small-model weakness, and prompts will not fix it

*Negation Neglect: When models fail to learn negations in training*
(arXiv 2605.13829) finds models encounter negation far less often than positive
assertion in training, so they default to answering about the base concept
rather than its negation. **Larger models are better; none are fixed by scale.**

Fred is 1.7B — the bad end of that curve. So `hf-woundpack-01`, where the source
says *"Do not pack hemostatic dressings into the abdomen or chest"* and Fred
answered *"Yes, but only if it is a deep wound"*, is an **expected failure mode
of the model class**, not bad luck. It will recur, and no amount of prompt
wording reliably prevents it.

That argues for a structural fix rather than a prompt one: flag prohibition
content at ingest (the source text is full of `Do not -` and `Avoid`), and check
a generated answer only when its context carried such a flag. Far cheaper than
verifying every sentence, and aimed at the one class that can hurt someone.

## 4. Our over-refusals and our inversions are the same dial

*Prompt-Based Abstention Fails Under Misleading Context: A Controlled Study of
Small Frozen RAG Models* (arXiv 2608.22228, Aug 2026) is the closest thing in
the literature to Fred's exact configuration — small, frozen, abstaining by
prompt. On 3.8B-8B models (Fred is smaller):

- Under **explicit abstention prompting** models still answer **41.6%** of
  misleading questions, and **63%** of those echo the planted wrong entity
  verbatim. Prompt-based abstention tests whether context is *sufficient*, never
  whether it is *correct*.
- **Generator-side conflict checking** cut wrong answers to **13.3%** — but
  "eliminated many correct answers."
- **An NLI verifier** recovered the lost coverage, but fails when the model's
  own parametric memory agrees with the misleading passage.
- Chain-of-thought: minimal benefit.

Their conclusion is that neither verification route closes the sufficiency /
correctness gap "without trading coverage for safety."

This reframes two of our findings as one. Fred declining `hs-orientmap-01` at
U=0.610 with four citations is the *same dial* as Fred saying yes to packing an
abdomen — over-refusal and inversion are opposite ends of it, and at 1.7B you do
not get both. Notably our declines cluster on medical and foraging questions
(pelvic fracture, marsh edibility), which is where safety training bites; the
related over-refusal work (arXiv 2510.10452) attributes exactly that to
surface-pattern caution rather than context evaluation.

**Practical consequence: stop spending effort on the abstention prompt.** It is
a dial, not a bug, and we have already been burned once moving it (refinement D,
`results-akr2.md`, took declines 1→16). The gains have to come from retrieval
and ingest, which do not trade off.

## 5. Sufficient context, as a signal rather than a prompt

*Sufficient Context: A New Lens on RAG* (arXiv 2411.06037, ICLR 2025) formalises
"could these snippets plausibly answer this question", separating retrieval
failure from utilisation failure. Two findings worth carrying:

- RAG **reduces** a model's willingness to abstain, because added context raises
  confidence — so our gate is fighting the architecture, not just the model.
- Using a sufficient-context signal lifts **selective accuracy by 2-10 points at
  the same coverage**. HALT-RAG-style lightweight classifiers report F1
  0.78-0.98 with calibrated probabilities suitable for thresholding.

2-10 points is real but second-order next to the 15 questions that never
retrieve. Keep it; do not lead with it.

## What this changes

| Was planned | Now |
|---|---|
| Semantic routing as the main fix | **Demoted.** Pre-retrieval routing is the hard problem; cascade instead. Routing stays, but may never return nothing. |
| Fallback + raised threshold | **Promoted** to the actual architecture, as a cascade with deferral. |
| Sufficient-context classifier | Kept, but ranked below ingest work. Worth 2-10 points. |
| NLI verifier over every answer | **Narrowed** to a prohibition check on flagged chunks only. |
| — | **Contextual retrieval at ingest. New, and the best value on the list.** |
| Fix the abstention prompt | **Dropped.** It is a coverage/safety dial, not a defect. |

Ranked by measured value per unit of device latency:

1. **Contextual retrieval at ingest** — 35-67% fewer retrieval failures, zero
   device cost, attacks vocabulary mismatch and inversion together. Phase it:
   core packs first.
2. **Retrieval cascade with deferral** — replaces route-or-die. 72.2% vs 13-38%
   in the source study, and lower latency because most queries stop early.
3. **Bug 2** — `needs-location` firing on a word's domain tag rather than on
   whether the answer is state-specific. Small, isolated, ~4 questions.
4. **Prohibition flags + targeted check** — the only thing that catches the
   safety class, at a fraction of full NLI cost.
5. **Sufficient-context signal** — 2-10 points, after the above.
6. **Nothing on the abstention prompt.**

Unchanged and still required: new tuning questions with unfamiliar vocabulary,
before any threshold is fitted. Every technique above has a knob, and we have
one honest measurement left to spend.

## Sources

- The Coverage Illusion — arXiv 2605.27220
- Negation Neglect — arXiv 2605.13829
- Prompt-Based Abstention Fails Under Misleading Context — arXiv 2608.22228
- Steering Over-refusals Towards Safety in RAG — arXiv 2510.10452
- Sufficient Context: A New Lens on RAG — arXiv 2411.06037 (ICLR 2025)
- Contextual Retrieval — anthropic.com/engineering/contextual-retrieval
- Lightweight Query Routing for Adaptive RAG (RAGRouter-Bench) — arXiv 2604.03455
- Chunking strategy surveys, 2026 — firecrawl.dev, aiworkflowlab.dev
