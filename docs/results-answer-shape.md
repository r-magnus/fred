# A-KR2 — answer-shape prompting, tried and rejected

Measured 2026-09-22 on the 100-question tuning set. **Rejected: it fixed one
target failure, turned a correct safety answer into a refusal, and moved the
abstention dial I predicted it would not touch.**

## The idea

Three of the nine remaining held-out failures answer *about* the topic instead
of answering the question: asked "what is this", Fred gives sound care advice
and never names snow blindness; asked what people used sagebrush for, it answers
with pronghorn forage.

The base prompt already says "Answer the question itself", and the model obeys
it as it understands it, so `SYSTEM_PREFIX_LEAD` names the shapes instead of
exhorting harder:

> Give the thing the question asks for, first. If it asks what something is,
> name it. If it asks how two things differ, state the difference. If it asks
> what something is used for, give the use. Advice about the topic is not an
> answer to the question.

Held-out questions cannot be tuned against, so this was measured on the tuning
set's examples of the same failure class.

## Result

| Question | Failure | After |
|---|---|---|
| `sv-cold-01` | asked "what is that", never named immersion foot | **fixed** — now opens "Recognize immersion foot or trench foot" |
| `sv-nav-01` | asked to find north without a compass, answered with map orienting | **worse** — now refuses outright |
| `uv-smoke-01` | asked for a use *besides* signalling, answered signalling | unchanged |
| `uv-tongue-airway-01` | asked why unconsciousness impairs breathing, never mentions the tongue | unchanged |
| `fa-ankle-01` | sprained ankle answered with fracture splinting | unchanged |

One of five. The bar set before the run was two of three.

## The part that matters more

**In-prose refusals rose 18 → 22.** Newly refusing: `sv-nav-01`,
`sv-fire-01`, `ff-bear-encounter-01`, `uv-neg-surgery-01`, and — the one that
settles it — **`fa-snake-02`**, which previously answered *"Do not use a
tourniquet"* to a snakebite question and graded a clear pass. A correct,
safety-relevant answer became "I don't have reliable information on that."

**The prediction in the code comment was wrong.** It claimed this was "deliberately
NOT the abstention dial" because it touches neither over-refusal nor inversion.
It moved the dial anyway. Telling a small model to lead with a specific kind of
answer apparently makes it likelier to conclude it does not have one — which is
the same two-sided knob `docs/results-holdout.md` and arXiv 2608.22228 describe,
reached from a direction that did not look like it.

That is the more useful finding than the one-of-five. **Instructions that do not
mention abstention can still move abstention**, so future prompt changes should
count refusals before and after regardless of what they appear to be about.

## Kept, off

`ANSWER_SHAPE=lead` stays in the tree, default off, like `CONTEXTUALIZE=1` and
`SUFFICIENCY=1`. The code is inert when unset and the measurement is the point.
`sv-cold-01`'s fix is real and someone may want it later in a narrower form —
naming the condition when the question is "what is this" is a smaller change
than this prefix makes.

## Where A-KR2 stands

Four approaches have now been measured and rejected: a generator swap
(`results-map-research.md`'s sibling, `docs/graded-runs-smollm2.jsonl`), the
numeric sufficiency wording on dosing, the grounding verifier
(`results-verifier-test.md`), and this.

62.5% held out against a target of 80%, due 2026-10-12. **There is no cheap
lever left.** The remaining failures are three refusals with good retrieval in
hand, three inversions, and three wrong-focus answers — and the honest report is
that a 1.7B model plateaus here, with four measurements behind the claim rather
than an assertion.
