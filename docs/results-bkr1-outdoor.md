# B-KR1 — the first outdoor reading, and what it does to Beta

Measured 2026-09-21 on the Nothing Phone (3), **airplane mode on**, outdoors
with partial sky obstruction (the building was visible from every test point).
Five fix attempts, eight readings.

**Median 9.5 m, best 5.6 m, every attempt met the ±10 m target.** Against the
33.5 m indoor median this moves B-KR1 from a B to an **A**, and it was measured
with no WiFi and no cell signal at all.

## The readings

| Attempt | Accuracy, in order | Target met |
|---:|---|---|
| 1 | 5.6 m | first reading |
| 2 | 9.2 m | first reading |
| 3 | 16.7 → 11.8 → 9.8 m | after 2.0 s |
| 4 | 10.3 → 9.0 m | after 1.4 s |
| 5 | 6.1 m | first reading |

Summary computed by `summariseTrack` in `packages/geo/src/fix.ts`, the same code
the app shows on screen, rather than by hand. `mocked` was false on every
sample, and `stateForCoords` returned `CA` for all eight.

The raw track is **not in this repo** — it holds real coordinates. It lives at
`~/fred-tracks/bkr1-2026-09-21-outdoor-airplane.csv`, described by the README
beside it, and `.gitignore` refuses `bkr1-*.csv` so one cannot be committed by
accident.

## What it settles

**The 15 s refine window is generous, not tight.** Three of five attempts met
the target on their first reading and the slowest took 2.0 s. The prediction
before this run was the opposite: with no network there is no assisted-GPS
almanac, so a cold fix was expected to take 30-60 s and the window was expected
to be too short. It was not close. Nothing here argues for lengthening it, and
there may be battery in shortening it.

**Indoors was the whole story.** `docs/METRICS.md` records six consecutive
indoor calls at 20, 64, 74, 75, 75, 76 m — WiFi positioning settling on its own
floor, with the 10 m early exit never firing. Outdoors the early exit fired in
every attempt. The indoor figure was never a measurement of GPS.

## What it does to B-KR2

B-KR2 asks for the user's position within **±1 km with WiFi off**, and the
handoff calls it "the harder half of Beta". This run is the WiFi-off case, and
it produced **9.5 m** — roughly a hundred times inside that target.

On this evidence the location half of B-KR2 is close to free, and what remains
is the map it has to be displayed on: *"the user can access a map with an
estimated location zone"*. That is `results-map-research.md`, not a positioning
problem.

Stated as a prediction so it can be wrong: the drive will confirm this, and
B-KR2's difficulty is UI, not GPS.

## What it is not

One location, five attempts, ten minutes. The proposal verifies B-KR1, B-KR2 and
B-KR3 by **driving to different physical locations**, and none of that has
happened. This does not close any KR. It says the drive is likely to confirm
rather than surprise, and that the recorder works well enough to be worth
driving with.

Two limits of the recorder this run exposed:

- It only captures during a fix attempt, so the tester has to tap at each stop.
  Fine for stops, not for continuous recording while moving. A drive wanting a
  track rather than a set of points needs an always-on mode.
- Attempts are separable only by timestamp gaps, because `elapsedMs` restarts
  per attempt. Grouping by elapsed silently merges two attempts into one; the
  analysis above groups on gaps over 5 s.
