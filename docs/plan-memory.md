# Plan: conversation memory, measured as accuracy

2026-09-26. Builds on `results-memory-research.md` (the design) and
`results-phase3.md` (where accuracy stands). Tickets: #60 (this), #50
(clarifying questions), A-KR2.

## What memory can and cannot do for A-KR2

The held-out score (66.3%) is 40 single questions. Its losses are 6 wrongful
declines of *clearly worded* questions that search cannot match ("my friend
fell and has pain around his hips"), 7 partly-right answers, and 1 unsafe
answer. None of those is a missing-context problem, so **memory will not move
the headline number**, and a plan that claimed it would would be grading
itself.

What memory does fix is an accuracy failure the held-out set never asks about:
every follow-up is answered as if it were the first thing the hiker said. "It's
still bleeding" after a bleeding answer is searched alone, scores low, and is
declined or answered about something else. In real use that is the most
common second message a first-aid assistant gets.

So the work is: measure multi-turn accuracy with the same four-part rubric,
add memory, and **prove the single-question score does not move**.

## Design (from the research, with two additions)

1. **Retrieval sees the previous question.** For every turn after the first,
   search twice: the message alone, and the previous question joined to it.
   Keep whichever has the higher top fused score. A topic switch keeps the
   standalone search because it scores higher, so no follow-up detector has
   to be right.
2. **The generator sees the previous question only when the joined search
   won.** One line, `EARLIER QUESTION: ...`, above `QUESTION:`. Never the
   previous answer, never the previous sources. *(Addition: when the
   standalone search won, the message is on a new topic and the earlier
   question would only be a distractor.)*
3. **A guard against admitting out-of-scope follow-ups** *(addition)*. The
   rejected second search (phase 3, step 4) failed because a rewritten query
   carried out-of-scope questions over the gate. A joined query can do the same:
   "how do I stop bleeding?" then "can I stitch it myself?" borrows the
   bleeding match. Measured first; if it happens, the joined result must also
   clear a floor on the new message alone.
4. **Card repeats.** A follow-up that lands on the card just shown would repeat
   it word for word. Safe, but not an answer to "what if that doesn't work?".
   Measured first: count how often it happens, then decide.

No change to single-question behaviour: with no previous question, `ask()`
takes exactly today's path. Verified by byte-identical tuning answers, which
spares a held-out re-run.

## Measurement

All new sets are two turns, graded on the second answer with the four-part
rubric (safe first). Written before any code, from tuning-set material:

| Set | n | Second turn | Pass |
|---|---:|---|---|
| **follow-up** | ~20 | only makes sense with the first ("what if it's still bleeding?") | answered correctly, in context |
| **switch** | ~10 | unrelated to the first | answered as if alone, no trace of the first topic |
| **out-of-scope follow-up** | ~10 | follow-up that Fred must decline or refer ("can I stitch it?") | declined or referred |
| **regression** | 100 | every tuning question, with an unrelated earlier question | same answers and **same in-prose refusal count** as single-turn |

Plus a **held-out multi-turn set** (~12 pairs, all three kinds), written now,
sealed, and run once at the end.

## Steps

1. Write the four tuning sets and the held-out set. *(Before code.)*
2. `tools/eval/src/run-conversations.ts`: two-turn runs through `ask()`.
   Baseline with no memory: this is the number memory must beat.
3. Retrieval memory (design 1) in `@fred/rag-core`. Measure all sets.
4. Prompt memory (design 2). Measure.
5. The out-of-scope guard and card repeats (design 3, 4), only as the
   measurements require.
6. Regression: byte-identical single-turn tuning answers; the regression set's
   refusal count unchanged.
7. The app passes the previous question (in-session only; saving
   conversations is US-10, #31). Check on the phone with devhooks.
8. Held-out multi-turn run, once. Results in `docs/results-memory.md`,
   METRICS updated.
9. **Then #50**: Fred asks one clarifying question where a card answers
   several cases (burn depth, what stung you) and uses the reply. It needs
   step 7, and it touches the partly-right answers that do cost held-out
   points. Graded as a two-turn set, with the reply written into the set.

## Risks

- **Refusals move.** Any prompt change has moved them before (18 → 22 from an
  instruction that never mentioned abstaining). The regression set counts them.
- **Grader bias.** One grader (Claude, in session) who wrote the change, as
  in every phase. Verdicts are saved with a reason each.
- **Time.** A tuning run is ~20 minutes of CPU generation per set variant.
  Runs go one at a time, at low priority, and never beside an ingest.
