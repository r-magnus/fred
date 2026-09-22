# A-KR2 — the grounding verifier does not earn its place

The desktop test `results-nli-research.md` specified, run 2026-09-22 against the
current held-out results rather than the stale variant-H set it was written for.

**Short version: it flags a third of the failures while flagging a tenth of the
good answers, and flagging is not fixing. This is not the A-KR2 lever.**

## Method

- `tools/eval/src/dump-context.ts` re-runs retrieval only over
  `docs/holdout-runs-norouter.jsonl`. The run files store citation labels, not
  passage text, so nothing downstream could check an answer against what it was
  given. Retrieval is deterministic and runs before generation, so this
  reproduces the same passages in seconds instead of a ten-minute run.
- Each answer is split into sentences and each sentence scored for entailment
  against its retrieved passages. An answer is scored by its **least supported**
  sentence, which is the standard aggregation and the one that favours the
  technique.
- Model: `onnx-community/deberta-small-long-nli`, q8, via Transformers.js. **Not
  HHEM-2.1-Open**, which the research named — see caveats.
- 31 graded answers: 22 acceptable, 9 failures, 2 of them safety defects.

## Result

| Threshold | Failures flagged | Acceptable answers flagged |
|---:|---:|---:|
| 0.30 | 3 / 9 | 2 / 22 |
| 0.40 | 4 / 9 | 6 / 22 |
| 0.50 | 6 / 9 | 9 / 22 |
| 0.60 | 7 / 9 | 13 / 22 |
| 0.70 | 8 / 9 | 16 / 22 |

There is no operating point worth having. Catching two thirds of the failures
means flagging four in ten good answers.

**The ranking is the damning part.** The two least-supported answers in the
whole set are *acceptable* ones — `hff-manzanita-02` at 0.174 and
`hs-spoiledfish-01` at 0.209 — below every failure. The verifier is not
separating grounded from ungrounded; it is largely measuring how closely an
answer's wording tracks its source, and Fred's good answers paraphrase.

## Why this kills it as an accuracy lever

**Detection is not correction**, which the research said and this makes
concrete. For a question that expects an answer, declining scores the same zero
as answering wrongly. Flagging a failure therefore adds **no A-KR2 points**
unless the flagged sentence is dropped and what remains is still acceptable.
Meanwhile every false alarm turns a correct answer into a decline, which
*costs* a point.

At the only sane threshold, 0.30: 3 failures flagged for no gain, 2 acceptable
answers flagged for a loss of 2. **The expected effect on A-KR2 is negative.**

## The one thing it might still be worth

Safety. Turning a dangerous wrong answer into a decline is worth something even
at zero accuracy points. But the two safety defects rank 7th and 14th lowest:
`hf-woundpack-01` at 0.332 and `hf-cpr-infant-01` at 0.473. A threshold catching
both flags 13 of 22 acceptable answers. That is not a safety net, it is a
blanket.

## Caveats, because this is a negative result on a small sample

- **One model, and not the one named.** HHEM-2.1-Open is FLAN-T5-based and
  purpose-built for this; the ONNX export available is untested
  (`FamiliarTools/HHEM-2.1-Open-onnx`, zero downloads). A purpose-built verifier
  may separate better. The gap here is wide enough that it looks structural
  rather than like a tuning problem, but that is a judgement, not a measurement.
- **Nine failures.** A go/no-go signal, not an accuracy figure, exactly as the
  research warned.
- **q8 quantisation** may cost some discrimination.

## What this leaves

`results-nli-research.md` shelved the verifier on latency, and the owner has
since withdrawn that objection. It is now shelved on **efficacy**, which is the
better reason and does not come back if the latency budget changes.

Every remaining held-out failure is a generation failure with good retrieval in
hand, the generator lever is closed (SmolLM2 lost, Qwen3.5-2B declined), and
prompting does not reach the inversions. **A-KR2 has no cheap lever left**, and
the honest next step is to say so in the report rather than to keep buying
lottery tickets.
