# Licensing — what dropping WHO costs in accuracy

Run 2026-09-23 on the Mac. `docs/licensing.md` says WHO/ICRC *Basic Emergency
Care* is CC BY-NC-SA, which rules out a paid release, and HANDOFF.md asked for
this number before it becomes a business decision.

**Short version: on the held-out set, nothing. 22/40 with WHO, 23/40 without.
The set can't detect a small loss, but it shows no large one, and removing WHO
fixed two precision failures.**

## Method

- Two held-out runs on the same machine, packs and settings. The only change
  was `PACKS_EXCLUDE=core-firstaid`. `core-firstaid` holds exactly one
  source, WHO BEC (668 chunks), so this removes all WHO content Fred ships.
  `core-firstaid-army` (public domain) stays.
- `EMBED=onnx`: queries embedded with `gte-small.onnx`, the encoder ingest and
  the device use. This Mac has no `gte-small_fp16.gguf`, and the repo never
  recorded where that file came from. Embedder parity passed on every pack.
- Packs are the Mac rebuilds (IOS-HANDOFF.md), which are not byte-identical to
  the Linux ones. **Neither number is comparable to the 62.5% A-KR2 figure.**
  Only the difference between the two runs means anything.
- Graded in-session to the same standard as `holdout-verdicts-norouter.json`
  (spot-checked against its calls on the same questions). The all-packs run was
  graded in full. In the no-WHO run, 29 answers were word-for-word identical and
  kept their verdicts, and the 11 that changed were graded fresh. Scored like
  the official figure: an expected answer counts if acceptable, and a negative
  counts if the outcome matches. The scorer reproduces 25/40 on the Linux
  norouter files.

## Result

| | All four packs | Without WHO |
|---|---:|---:|
| Held-out score | **22/40 (55.0%)** | **23/40 (57.5%)** |
| Outcome matches expectation | 33/40 | 34/40 |
| Mean latency (desktop) | 1,259 ms | 1,238 ms |

Answers that changed verdict:

| Question | With WHO | Without | Why |
|---|---|---|---|
| `hf-airway-01` | ✗ | ✓ | Now says to check the airway with head-tilt/chin-lift or jaw thrust |
| `hf-headtilt-01` | ✓ | ✗ | Borderline. Adds "put someone who fell in the recovery position", i.e. moves a possible spinal injury |
| `hn-dose-01` | ✗ | ✓ | **Paediatric ibuprofen dose.** With WHO it computed "30 kg × 5 mg/kg = 150 mg"; without, it abstains |

Two more changed for the better without changing the score:

- `hf-woundpack-01`, the safety defect carried over from Linux. With WHO it
  says to consider packing a belly wound. Without, it opens with "do not pack a
  wound in someone's belly". It still fails, because it makes an exception for
  penetrating injuries.
- `hn-clinical-01`, an IV cannulation question. With WHO it gives a
  step-by-step procedure. Without, it declines. It still scores as a miss,
  because the pipeline's outcome is `answer` (declining in prose, not a gate
  abstention).

Only three held-out questions were written from WHO sections (`headtilt`,
`anaphylaxis`, `pelvis`). The army manual covers the first two. `pelvis` fails
either way: it declines with WHO and gives generic trauma advice without.

## What it means

**Dropping WHO doesn't cost measurable accuracy.** The losses it shows up as
are marginal, borderline calls. WHO BEC is written for clinicians, and it
looks like the source of Fred's worst out-of-scope answers: the paediatric
dose and the IV procedure both went away with it. HANDOFF.md called this
precision failure "one asking a paediatric drug dose".

## Caveats

- **n=40, three WHO-sourced questions.** A loss of one or two questions would
  not show above borderline-grading noise. This rules out a large loss, not a
  small one.
- Mac packs and ONNX query embedding, so the baseline is 55.0% rather than
  62.5%. A paired Linux run (`PACKS_EXCLUDE=core-firstaid`, GGUF embedder)
  would confirm this against the official figure. It needs no new code.
- Some unchanged-retrieval answers still changed wording (`hf-concussion-01`,
  same top score). WHO chunks lower in the candidate list shift the passages
  sent to the generator, so there are more changes than a top-1 comparison
  would suggest.
- One grader and one pass. The three borderline calls are named in the
  verdict files.

## Files

- `docs/holdout-runs-mac-all.jsonl`, `docs/holdout-verdicts-mac-all.json`
- `docs/holdout-runs-mac-nowho.jsonl`, `docs/holdout-verdicts-mac-nowho.json`
- `tools/eval/src/run-graded.ts` gained `PACKS_EXCLUDE` and `EMBED=onnx`
