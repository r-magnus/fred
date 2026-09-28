# Noisy passages: what would actually help

2026-09-27. Research only; no pipeline change. Follows `results-thin-answers.md`,
which found the model often blends unrelated passages into its answer
(hand-drill steps in the bow-drill answer, rawhide in plant rope).

Everything below is measured on retrieval alone, with no generation, on the
tuning and held-out answers Fred gave (83), 71 of which have a known source
passage (the answer sheet's `cite.quote`).

## The obvious fixes lose accuracy

**Fewer passages.** Where the right passage sits among the four Fred reads:

| Rank | 1st | 2nd | 3rd | 4th | not in the four |
|---|---:|---:|---:|---:|---:|
| Questions | 19 | 16 | 8 | 1 | 27 |

Keeping two would lose the right passage 9 times, and keeping one, 25 times.

**A score cutoff** (drop passages scoring well under the top one). The right
passages at ranks 2-4 score from 0.54 to 1.12 of the top, spread across the
same range as the noise:

| Cutoff | Right passages dropped | Other passages dropped |
|---|---:|---:|
| 0.70 × top | 9 of 40 (22%) | 57 of 173 (33%) |
| 0.80 × top | 19 of 40 (48%) | 93 of 173 (54%) |

Score can't tell them apart. Both fixes are rejected without spending a
generation run.

## Where the noise comes from

1. **Fixed-size windows.** Passages are 300-token windows with a 50-token
   overlap, cut regardless of structure. 56-68% of the Army-manual passages
   start mid-sentence (`results-strategy-research.md` §1d). One window holds
   the end of one topic and the start of the next: the bow-drill passage
   begins with the fire plow and runs into the hand drill.
2. **Duplicated text.** In 55 of 83 answers (66%), two of the four passages
   are neighbouring windows, so their 50-token overlap appears twice.
3. **The right passage missing entirely** (27 of 71). That's search recall,
   not noise; no filter helps it.

This matches the research: small models are hurt most by passages that are
*related but wrong* (Cuconasu et al., "The Power of Noise", SIGIR 2024), and
they read the start and end of the context better than the middle (Liu et
al., "Lost in the Middle", TACL 2024).

## Options, in order of risk

1. **Join neighbouring windows** (low risk). When two of the four passages are
   neighbours, give them as one passage without the repeated overlap. No text
   is removed, and the topic reads in one piece (the bow-drill steps were
   split this way). Affects 66% of answers, so every change gets graded.
2. **Re-rank before choosing the four** (medium). A small cross-encoder reads
   question and passage together, which a similarity score can't. It can be
   judged offline first: does the right passage move to 1st more often, on
   the same 71 questions? Only if it does is a generation run worth it.
   Phone cost: a second small model (tens of MB for the smallest usable ones)
   and a few hundred ms.
3. **Chunk by the manuals' own structure** (higher effort, fixes the cause).
   The Army manuals number every paragraph (`5-53.`, `13-37.`) and titles every
   section. Cutting there gives passages about one thing. It means re-building
   and re-embedding the core packs, and it changes every answer, so it's
   judged in two steps: search recall on the 71 questions first (no
   generation), then the full graded runs.

Each option is kept only if it wins more than it loses on the tuning and
breadth sets, graded blind, with no new unsafe answers, and is confirmed once
on held-out.
