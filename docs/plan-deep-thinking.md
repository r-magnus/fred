# Deep thinking: more time for a better answer (#21)

Written 2026-11-15, before any strategy was run. Ryan: "try some more deep
thinking tests, with a different strategy ... ultimately allowing more
compute time. The option should be presented as the user is typing their
query, allowing them to select it before sending."

The person turns it on before sending. Normal answers don't change. Deep
thinking is for when someone has a moment and wants the better answer:
plant facts, planning, "what's the difference between...". It isn't for
emergencies. A message read as urgent with a danger sign keeps its
get-help-now reply, deep or not.

## What has already failed, and why

| Tried | Result | Lesson |
|---|---|---|
| Qwen3 thinking mode (#36, `results-thinking.md`) | -3.5 rubric on tuning, 1 new unsafe ("campfire smoke ... water purification"), 2x time | Free reasoning lets a 1.7B model wander from its sources |
| Bigger generator, Qwen3.5-2B (#37) | 32/61 vs 38/61, red flags 3 -> 8 | Not a size problem we can buy on a phone (#27: 1.4 GB of 2 GB) |
| Second search in manual wording (phase 3 step 4) | +9 answerable recovered, **14 out-of-scope admitted** | Rewriting makes anything sound in scope; no score threshold separated them |
| Answer-shape prompting (`results-answer-shape.md`) | 1 of 5 fixed, refusals 18 -> 22 | Prompt wording moves a two-sided dial |

## Research, in one line each

- Majority voting (self-consistency) **hurts** small models when the vote is
  thin: it flips right answers wrong on 3-10.5% of prompts (arXiv 2611.11201).
- Small models gain from extra time when a **tool verifies** rather than the
  model judging itself (T1, arXiv 2504.04718; verifier survey 2508.16665).
- Checking each sentence against the sources (CoNLI 2310.03951, VeriCite
  2510.11394) and verifying before revising (CoVe 2309.11495, CoV-RAG
  2410.05801) cut unsupported claims.
- Pulling the evidence sentences out first, then writing from them, separates
  "find" from "write" (Ext2Gen 2503.04789, SEER 2410.11315). Small models
  struggle to use what they retrieve (2603.11513).
- Corrective RAG: judge the retrieval, rewrite and search again when weak
  (CRAG). Its weak link is the judge; ours is the trained scope scorer.

So the extra time goes to **searching and checking with tools Fred already
has** (sentence vectors, the scope scorer, the number check), not to letting
the model think longer.

## Strategies

Each is a switch, so they can be measured alone and together.

1. **Search harder** (`search`). When the first search falls under the gate,
   the model restates the question in a manual's words and that is searched
   too. New: only when the scope scorer says the message is in scope and it
   isn't a medicine or procedure. That is the phase-3 failure's fix, if it
   works. Targets #23's leftovers (paracord, wild vs hospital).
2. **Evidence first** (`evidence`). From the passages found, the sentences
   closest to the question (sentence vectors, no model) are put first and
   marked as the evidence; the model writes from them. Targets answers that
   respond to another part of the passage (#21).
3. **Check every step** (`check`). The whole answer is written, then each
   sentence is compared with the source sentences; one with no close source
   sentence is dropped (the "explosions" line). If more than half goes, the
   reply is the closest quote instead. Targets invented lines (#21).
4. **Best of three** (`drafts`). Three drafts at the model card's sampling
   settings; the one whose sentences are best supported by the sources (the
   check's own score, a tool, not a vote) is shown. Targets #21 by choice
   rather than repair. Costs about 3x.

## Sets and order

Tuning (104) and `assembled` (45) to develop on; they may be looked at.
Then one run each, unseen until then, on held-out (40), `assembled-sealed`
(45) and breadth (57). Every run with written answers, the phone's packs
(`~/fred-runs/phone-1018/packs`), state CA, against a baseline from the
same commit with deep thinking off.

## Pass rule (written before any run)

A strategy, or a combination, is adopted for deep thinking only if, against
normal mode on the confirmation sets:

1. **No new unsafe answer.** One is a fail.
2. **No more out-of-scope questions answered** than normal mode
   (the held-out and tuning negatives, and every `neg-` question).
3. **Rubric score up** on the changed answers, graded blind (A/B in random
   order), and **no fully right answer made wrong**.
4. **Time** reported (desktop mean and p95; phone estimated from the #27
   ratio and checked on the phone for the winner). No limit, since the person
   chose to wait, but a strategy that wins nothing doesn't earn its time.

A strategy that only helps on tuning and `assembled` isn't adopted.
