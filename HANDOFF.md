# Handoff — 2026-09-20

Written for whoever picks this up next, on a different machine. Everything
measured here is in `docs/`; this file is only the state of play and the next
decision.

## The one thing to understand first

**A-KR2 was reported as 70.6% for weeks. It was 35%.**

The 70.6% was measured on the same 68 questions the scope gate, the lay
lexicon, the prompt shape and the abstention threshold had all been fitted
against. A held-out set of 40 questions — nothing tuned on them — scored 35%.
That set now exists (`tools/eval/data/holdout-*.json`, `EVAL_SET=holdout`) and
**it is the number to quote.**

The tuning set is still useful for iterating. It is not evidence.

**Do not fit anything to the held-out set.** `calibrate.ts` and
`fit-fallback.ts` both refuse by default. The rules are in
`docs/results-holdout.md` and they have already paid for themselves once — see
"the trap that was avoided" below.

## Where A-KR2 is

| | Held out (40) | Tuning (100) |
|---|---:|---:|
| Before routing change | 35.0% | — |
| **Now** | **62.5%** | 71/100 outcome |

Target is 80% (lowered from 90% by the project owner on 2026-09-18; on the
proposal rubric 80% is a B). Due **2026-10-12**.

The gain came from one change: **routing narrows the search, it may no longer
empty it.** Measured justification — searching every pack on the device with no
routing at all costs **1.88 ms** against a **14,700 ms** answer, while refusing
to search cost 15 of 31 answerable questions. Recall went 16/31 → 31/31.

The bill: out-of-scope questions correctly declined dropped **6/8 → 3/8**. Fred
now answers "how many milligrams of ibuprofen for a 30 kg child". That is the
open problem.

## The decision waiting for you

The sufficiency check (`SUFFICIENCY=1`, default **off**, committed but not
shipped) asks the model whether retrieved passages contain what the question
needs. Measured: +4 outcome points, blocks seven out-of-scope questions the
scalar gate could not — **and fails the criteria it was built against.**

- It does **not** block drug dosing: paracetamol, epinephrine and paediatric
  ORS are all still answered, 0 of 3. The model cannot separate "the sources
  mention ibuprofen" from "the sources state a dose".
- It costs **+4.8 s** (14.5 → 19.3 s desktop, ~25 s on device), which drops
  A-KR3 from B to C.

Two independent rescues, neither attempted:

1. **Cost — do this first.** Run the check on **Qwen3-0.6B**, already staged on
   the device at `/data/data/dev.fred.app/files/`. A 0.6B prefill is far
   cheaper and yes/no classification is within its range. If the check cannot
   be made cheap, its accuracy barely matters.
2. **Accuracy — one attempt only.** A prompt variant making "a request for a
   number requires the number to be present" explicit. Kill it if it does not
   block ≥2 of 3 dosing questions. Do not chain prompt tweaks; refinement D
   (`docs/results-akr2.md`) took declines 1→16 that way.

If both fail, the research points at **swapping the generator** —
`docs/results-accuracy-research-2.md`. Qwen3-1.7B is a generation behind
(Qwen3.5 shipped March 2026, Gemma 4 April), and SmolLM2-1.7B is reported as
the most grounded model at that size. That is an afternoon and no architecture
change, and it targets the failures routing did not touch.

## What routing did NOT fix, and will not

These are generator failures. They survived every retrieval change:

- **`hf-woundpack-01`** — asked whether to pack an abdominal wound, answers
  *"Yes, but only if it is a deep wound"*. ATP 4-02.11 p.63 says **do not**.
- **`hf-cpr-infant-01`** — step 1 says two or three fingers for a baby, step 3
  says the heel of one hand. Following the steps in order does the dangerous
  thing.
- Three questions still decline with good retrieval in hand, including
  `hs-orientmap-01` at U=0.610 with four citations.

`docs/results-improvement-research.md` has the literature: negation failure is
a known, size-dependent weakness (arXiv 2605.13829) and prompting will not fix
it. Over-refusal and inversion are two ends of one dial at this model size
(arXiv 2608.22228) — **do not spend time on the abstention prompt.**

## The trap that was avoided, so it is not walked into again

The held-out data suggested a fallback threshold of **0.50** separated cleanly:
8 of 15 genuine recovered, 0 of 7 out-of-scope admitted. It was tempting.

Fitted properly on tuning data (`graded-unknown-vocab.json`, built for exactly
this), **0.50 keeps 4 of 11**, and no threshold separates at all — the
arithmetic best, 0.730, blocks every out-of-scope question by abstaining on ten
of eleven genuine ones. The clean separation was an artifact of seven easy
negative points.

Adopting it would have shipped a number fitted to noise and spent the one
measurement able to catch it. **This is why the holdout rules exist.**

## Things that are done

- **B-KR1 location** — works, graded B. Offline state lookup from bundled
  Census boundaries (`packages/geo`), never `reverseGeocodeAsync`, which needs
  network and would fail in exactly Fred's situation. ±33.5 m median indoors.
  **Owes an outdoor drive test** — the proposal verifies this KR by driving.
  The owner wanted to run it over USB so ADB survives airplane mode; airplane
  mode also tests whether GPS holds up with no signal, which could shrink
  B-KR2 a lot.
- **The app** — rebuilt, `expo-location` and `react-native-safe-area-context`
  linked, real insets, chat screen, US-03 sources, US-07 stop.

## Things that were tried and did not work

- **Contextual retrieval** (`CONTEXTUALIZE=1`, `tools/ingest/src/contextualize.ts`).
  Committed and working, but **measured no recall benefit** — our failure was
  routing, and a preamble cannot help a query that never reaches the index.
  Costs 4.5 s/chunk, so all 186,855 chunks would take ~10 days. Keep it only
  for the prohibition labels. **Read the label code before re-enabling**: the
  first version stamped "Lists actions to AVOID" on a passage of burn treatment
  because one line said "never place a tourniquet around the neck". Fixed, with
  tests, but it is the kind of bug that ships silently.

## State of the repo

- Branch **`bkr1-location`**, **17 commits ahead of `main`**, and at the time of
  writing **not pushed**. Check `git log origin/main..HEAD` before assuming.
- `CS-195 Project Proposal.pdf` is untracked on purpose; nobody has said whether
  it belongs in the repo.
- Packs on disk are the **baseline** ones. The contextualized survival pack was
  built, inspected, found to have the mislabelling bug, and discarded.
- `docs/METRICS.md` is generated — edit `docs/metrics.json` and run
  `npm run metrics`, never the markdown.

## Commands

```
npm test                                            # 113 tests
EVAL_SET=holdout node tools/eval/src/run-graded.ts docs/holdout-runs.jsonl
EVAL_SET=holdout node tools/eval/src/grading-packet.ts docs/holdout-runs.jsonl
node tools/eval/src/fit-fallback.ts                 # tuning only; refuses holdout
npm run metrics
```

Ingest and measurement must not share a machine — a build at 1504% CPU once
turned a 5 s eval question into 98 s (`docs/results-m2.md`).
