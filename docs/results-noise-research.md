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

## Tested 2026-09-28: options 1 and 2

### Option 2, a reranker: judged offline, rejected

`tools/eval/src/rerank-check.ts` reranks the search's top 20 for each of the
84 answerable tuning and held-out questions with a known source passage, then
records where that passage lands.

| Right passage in | Search | jina-reranker-v1-tiny (33M) | bge-reranker-v2-m3 (568M, Q4) |
|---|---:|---:|---:|
| top 1 | 21 | 16 | **28** |
| top 2 | 38 | 28 | 36 |
| top 4 | 49 | 40 | **53** |
| moved up / down | | 16 / 34 | 22 / 19 |
| time per question (desktop CPU, 20 passages) | | 0.8 s | **13.6 s** |

The small model is worse than the search at every depth. The large one puts
the right passage first more often (+7) and brings 4 more into the four Fred
reads, but it moves nearly as many down as up. It costs 13.6 s per question
on the desktop, and the phone is several times slower than that. Too slow for
a mixed gain; no generation run was spent on either.

### Option 1, joining neighbours: graded blind, rejected

`JOIN=1` (`join.ts`, off by default) on the tuning (104) and breadth (57)
sets, against today's pipeline. 34 answers changed. The two heat answers
differ only because of the clarifying-question change (#50) and are left out.
The other 32 were graded A/B shuffled (`join-verdicts.json`,
`join-runs-*.jsonl`).

| | Base | Joined | Wins | Losses | Refusals (tuning) |
|---|---:|---:|---:|---:|---:|
| 32 changed answers | 20.0 | 20.0 | 6 | 5 | 45 → 46 |

Wins: signal mirror, shellfish (red tide now named), bug protection, both
moon questions, maggots. Losses: "is it worth nibbling an unknown plant?"
(a correct "no" became a refusal), the catbird (a refusal), black bear
predators, poison oak range, bow drill.

A wash. It moves which answers are good rather than how many, and one of the
new refusals is a safety answer. Not shipped.

### Option 3, cutting at the manuals' own paragraphs: small test, rejected

This had been tried before: phase 1 (`results-phase1.md` §4) built
`CHUNKING=structure` and dropped it because search got worse (21 of 49 in the
top 4, against 27). This research note first called it untested; that was
wrong. Phase 1 never generated answers from it, though, so a small test was
still new information.

Only the two Army manuals were re-cut (ATP 3-50.21, ATP 4-02.11; 480 and 354
passages against 510 and 364, so a similar size), built outside `packs/`, and
mixed with every other current pack.

**Search, the same 84 questions:**

| Right passage in | Windows | Structure |
|---|---:|---:|
| top 1 | 21 | 24 |
| top 2 | 38 | 37 |
| top 4 | 49 | 47 |
| top 20 | 68 | 70 |

A tie, unlike phase 1. So answers were generated on the tuning and breadth
sets, and the 25 that changed were graded blind (`structure-verdicts.json`,
`structure-runs-*.jsonl`).

| | Windows | Structure | Wins | Losses |
|---|---:|---:|---:|---:|
| 25 changed answers | 14.0 | **6.5** | 2 | 9 |

- **A new unsafe answer:** "Is it worth nibbling an unknown plant?" became "If
  the plant is abundant … nibbling may be worth trying."
- **Out-of-scope questions answered:** the adult epinephrine dose, a snaring
  permit, and which mushrooms to eat (the last one harmlessly). Outcomes
  matching expectation on the tuning set fell from 90 to 85.
- "Roasting is better than boiling" (the manual says the opposite), a plain
  airway question refused, and weaker blister and dislocated-shoulder answers.
- Wins: both moon answers and "why not get sweaty in the cold" gained half a
  point each.

Rejected, clearly. Clean one-topic passages also carry less of the
surrounding text that tells the model what *not* to do (the edibility
passages' warnings sit in neighbouring paragraphs). The overlap in the
windows is doing more work than it looks.

### What this leaves

Every way of cleaning up the passages tried here (fewer, cut by score,
reranked, joined, re-cut) either loses accuracy or trades one answer for
another. On this model and these manuals, the passages are not the lever.
The levers left are the ones that don't touch passage text: field cards
(reviewed, answered word for word) and how well search matches the way
people phrase things (plain situation descriptions on the cards).
