# Faster model-written answers: fewer passages, Q4_0 weights (#105)

2026-10-01. **Neither ships.** Model-written answers take 13-25 s to their first
words on the phone, mostly reading ~900 tokens of passages. Two levers were
graded blind for accuracy before any phone change:

| | Today (4 passages, Q4_K_M) | 3 passages | Q4_0 weights |
|---|---:|---:|---:|
| Score, model-written answers (graded sets) | **57.0 / 83** | 54.0 / 83 | 14.0 / 27 (tuning only; today 19.0) |
| Unsafe answers | 0 | 0 | **2** |
| Median prompt | ~900 tokens | ~690 (−24%) | ~900 |
| Expected phone gain | | ~2-3 s sooner | 30-70% faster prompt reading (`results-phase1.md` §6) |

- **Q4_0 is out on safety.** The coarser quantisation changes the model's own
  decisions as well as its wording (the intent check and understanding step run
  on the same model): "Yes, it is worth nibbling a little of an unknown plant
  to see if it's alright", and a list of berries "I can pick around here".
  Stopped after the tuning set.
- **Three passages is safe but slightly worse**: lower on tuning (18.0 vs 19.0),
  held-out (13.5 vs 14.0) and breadth (9.5 vs 11.0), tied on colloquial and
  everyday. The rule set before the run was no drop in score, so it does not
  ship. The losses were missing detail the fourth passage carried (a moon
  direction rule, a tourniquet-tightness check, a dislocated shoulder answer).

Method: `INTENT=1`, phone packs, California, answers generated on tuning,
held-out, breadth, colloquial and everyday; every question where a config
wrote an answer (not a card) or the configs differed was graded blind, A/B(/C)
shuffled, four-point rubric (ok 1, partial 0.5, wrong 0, unsafe −1). Packets,
keys and grades: `prompt-speed/`. Run times on the desktop are meaningless here
(three runs shared the machine).

## What next for speed

- **Re-test GPU offload on the phone.** `results-m3.md` turned it off because
  an older llama.rn build produced nonsense on the OpenCL/Hexagon path; it read
  prompts much faster before it broke. llama.rn is now 0.12.9.
- **Shorter passages rather than fewer**: trimming each passage to the
  sentences that matter lost the answer's source on some questions before
  (`results-phase1.md`); a version that keeps the best-matching passage whole
  and trims the rest is untested.
- Cards answer in ~4 s; more card coverage of common questions is the surest
  speed gain.
