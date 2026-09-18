# A-KR2 — would an NLI grounding verifier fix the lost points?

`docs/METRICS.md` puts an "NLI grounding verifier (~1 day)" against the 14 judged
questions Fred answers badly. This is desk research on that claim, done 2026-09-18,
before any code. **Short version: the technique is real and well studied, but it can
see about 4 of the 14 failures, not 14.** Worth a cheap desktop test before building.

## What it is

A second, small model run after generation. The answer is split into sentences
(or claims); each is paired with the retrieved chunks and classified as supported or
not. Unsupported sentences are flagged. It catches fabrication and inversion —
content the source does not say, or says the other way round.

## What the literature says

| Model | Size | License | Result |
|---|---|---|---|
| MiniCheck-Flan-T5-L | 0.8B | MIT | 75.0 balanced acc., LLM-AggreFact |
| FactCG-DeBERTa-L | 0.4B | — | 75.6, LLM-AggreFact |
| MiniCheck-RoBERTa-L / DeBERTa-v3-L | 0.4B | MIT | slightly below Flan-T5-L |
| Bespoke-MiniCheck-7B | 7B | different license | 77.4 (top); too big for the phone |
| Vectara HHEM-2.1-Open | 0.1B | Apache 2.0 | 74.3 on RAGTruth-QA; ~1.5 s per 2k tokens, desktop x86 CPU |
| *Claude 3.5 Sonnet, for scale* | — | — | 77.2, LLM-AggreFact |

- Small verifiers match frontier LLMs on this task, but the ceiling is ~75%:
  roughly one call in four is wrong.
- **They degrade off-benchmark.** Auto-GDA (arXiv 2410.03461) finds pre-trained NLI
  models underperform on realistic RAG inputs until adapted to the domain.
- **They disagree with each other.** "Verify with Caution" (arXiv 2501.14883) finds
  factuality metrics inconsistent, biased against heavily paraphrased outputs, and
  weak when evidence is spread across a document. Its advice: validate in your own
  domain first.

HHEM is the practical on-device candidate: smallest, permissive license, long
inputs. Extrapolating its desktop figure by the ~1.3x phone slowdown in
`docs/METRICS.md` suggests **~2 s added per answer** — an estimate, not a
measurement, and A-KR3 is already over 10 s.

## Fred's 14 failures, by type

From `docs/graded-verdicts-1.7B.json` (variant H).

| Type | n | Questions | NLI can see it? |
|---|---:|---|---|
| Fabricated or inverted | 4 | `ff-bear-02` (badger/bear reversed), `sv-hypo-prevent-01` ("avoid additional layers"), `fa-bleed-01` (invented 30-min wait), `fa-choke-01` (advises against abdominal thrusts) | **Yes** |
| Declined on a covered question | 4 | `ff-bear-01`, `ff-berry-01`, `sv-water-02`, `sv-food-01` | No — nothing to check |
| Grounded but wrong focus or incomplete | 6 | `sv-fire-01` (metal match), `sv-nav-01` (no sun/stars), `sv-cold-01` (never names immersion foot), `fa-snake-01` (antivenom), `fa-fracture-01` (no joints above/below), `fa-ankle-01` (treated as fracture) | No — the sentences are supported, just not useful |

Detection is also not correction. A flagged answer only scores if the flagged
sentence is dropped (or regenerated) and what remains is acceptable; declining a
flagged answer scores the same zero. **Realistic gain: 2-4 questions, about +3-6
points.** Still worth having as a safety net on first-aid answers, but not the
primary A-KR2 lever. The other 10 look like retrieval and prompt problems
(`fa-ankle-01` retrieving fracture material, `sv-fire-01` assuming kit the user
lacks, four refusals despite coverage) and fixing them costs no latency.

## The desktop test to run next

Validates the verifier on Fred's own data before any app work. Roughly 3 hours on a
machine where the eval harness already runs.

1. **Re-retrieve chunks for the 46 judged questions.** `graded-runs-1.7B.jsonl`
   stores citation labels, not passage text. Retrieval runs before generation and
   has no sampling, so re-running it under variant H reproduces the same chunks.
2. **Run HHEM-2.1-Open and MiniCheck-Flan-T5-L** over (chunks, answer sentence)
   pairs.
3. **Compare against the verdicts.** Does it flag the 4 fabrications (recall)? How
   many of the 32 acceptable answers does it flag (false alarms)? For each flagged
   fabrication, would dropping the sentence make the answer acceptable?

With only 4 positives this is a go/no-go signal, not a precise accuracy figure.

## Also to fix

The "What would fix it" row in `docs/METRICS.md` credits the verifier with all 14
points. It is generated from `docs/metrics.json`; correct it there once the test
gives a measured number.

## Sources

- MiniCheck — arXiv 2404.10774; model card `lytang/MiniCheck-Flan-T5-Large`
- LLM-AggreFact leaderboard — llm-aggrefact.github.io
- HHEM-2.1-Open — `vectara/hallucination_evaluation_model`
- Auto-GDA — arXiv 2410.03461
- Verify with Caution — arXiv 2501.14883
- Background: SummaC (arXiv 2111.09525), TRUE (arXiv 2204.04991), AlignScore
  (github.com/yuh-zha/alignscore)
