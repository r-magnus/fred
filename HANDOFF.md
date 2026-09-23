# Handoff — 2026-09-22

Supersedes the 2026-09-20 note. Sixteen commits since. Everything measured is
in `docs/`; this is the state of play and what to do next.

## The short version

Alpha's accuracy work is **stalled on purpose** — the generator lever is closed
and the remaining failures are all generation quality. Beta went from "not
started" to **mostly built and verified on the device**: position, map and
signal coverage all render offline. The one thing nobody can do from a desk is
the drive test.

## A-KR2 — accuracy, due 2026-10-12

**62.5% held out, target 80%.** Unchanged since the last note, and not for lack
of trying.

- **The generator stays Qwen3-1.7B.** SmolLM2-1.7B was screened and lost 28 to
  38 on graded tuning answers. It is *extractive* — it emits raw document
  fragments with the manual's own numbering ("13-29. Locate the site of the
  suspected fracture"), which is maximally faithful and useless. Qwen3.5-2B was
  dropped as too large by the owner. `docs/graded-runs-smollm2.jsonl`.
- **Dosing is not a prompting problem.** Two independent wordings both scored
  0 of 3. Parked at the owner's request. The numeric wording is otherwise a
  strict improvement (tuning outcome 71 → 79, zero regressions) and is
  committed but still `SUFFICIENCY=1`, default off.
- **Every remaining held-out failure is the generator, not retrieval.** All
  nine have four citations and non-zero scores. Three decline with good sources
  in hand, three invert the source, three answer the wrong question. The
  `paracord` lexical gap the old research flagged is already fixed by the
  routing change.

**The lever with evidence behind it is a verification pass.** `results-nli-research.md`
sized it at +3-6 points and shelved it on latency; the owner has since said
accuracy beats latency, so that objection is gone. It targets the inversion
class, which includes both safety defects.

A methodology trap, recorded because it cost a run: **`outcome matches
expectation` cannot see a generator change.** It measures answer-vs-abstain,
decided by retrieval and the gate upstream. A-KR2 is a graded read of the prose
(README §04 QR-02) and nothing substitutes for it.

## B-KR1 / B-KR2 / B-KR3 — the Beta trio

**B-KR1 is an A outdoors.** First outdoor measurement the project has: median
**9.5 m**, best 5.6 m, five attempts, **airplane mode on**, partial sky
obstruction. Against 33.5 m indoors. The 15 s refine window is generous, not
tight — three of five attempts hit the target on their first reading.
`docs/results-bkr1-outdoor.md`.

**That reprices B-KR2.** It asks for ±1 km with WiFi off; the measurement above
*is* that case, about a hundred times inside target. Recorded as a falsifiable
prediction: B-KR2's difficulty is the map, not positioning.

**All three now render on the device, offline:**

| | State |
|---|---|
| Position | Green ring sized by the GPS's own 68% confidence radius |
| Map | MapLibre + Protomaps PMTiles, **z14, 598 MB for California** |
| Coverage | Amber res-7 hexagons + "carriers report signal about N km north-east" |

**None of this closes a KR.** The proposal verifies all three by driving to
different physical locations, and that has not happened.

## What is owed, in order

1. **The drive test.** Needs a car and nothing else — arm the recorder by
   long-pressing the location chip, drive, long-press to stop. It records
   continuously; the driver never touches the phone. One trip serves all three
   KRs. A reminder routine exists.
2. **Per-state packaging.** Map and coverage packs are staged by hand with
   `adb push`. They should ship like the flora packs do, keyed off
   `stateForCoords`. Coverage is 7.1 KB per state; maps are the real cost.
3. **The verification pass for A-KR2**, per the research above.
4. **Trim the app.** The APK carries four CPU architectures; 195 MB of 350 MB
   is for hardware no modern phone uses. The device also holds ~440 MB of
   models the app never loads (Qwen3-0.6B, the fp16 encoder). ~630 MB of
   avoidable weight before RC-KR1.

## Traps that already bit, so they do not bite again

- **`adb push` silently reports success while writing nothing** for large files
  over the USB/IP link. Small files run at 44-90 MB/s. Split into 40-50 MB
  chunks, verify each by size, retry the failures — typically one or two per
  pass. Restarting the adb server clears some stalls.
- **Gradle reuses a cached JS bundle.** A JS-only fix can be correct and never
  reach the APK. After any such change, grep the bundle *inside* the APK for a
  symbol that should or should not be there. Deleting
  `android/app/build/generated/assets/react/release/index.android.bundle`
  forces a fresh one. This masked a correct fix for most of a morning.
- **h3-js crashes Hermes** via an Emscripten `TextDecoder("utf-16le")` that is
  never used. `scripts/patch-h3-hermes.mjs` neutralises it. Patching only the
  package's `main` is not enough — it ships umd, esm and browser builds and
  remaps entries — and matching a whole line is not enough either, because one
  build is minified.
- **A release build is not debuggable**, so `adb run-as` refuses and drive data
  cannot be read back. `scripts/patch-android-fieldtest.mjs` sets
  `debuggable true`. **That flag must come off before RC-KR1.**
- **Expo was upgraded 57.0.20 → 57.0.24 on 2026-09-22 for iOS**, before the
  drive test, by the owner's decision. Xcode 27 will not launch an app without
  the UIKit scene life cycle, and only 57.0.23+ supports it. The lockfile was
  regenerated, which also moved **op-sqlite 18.1.4 → 18.2.5**. **Android has
  not been rebuilt since.** The APK already on the phone is the old one. Any
  new APK needs a quick pass before it is driven. Details, and how to roll back:
  `docs/results-ios-build.md`.
- **Expo SDK 57 deprecated `writeAsStringAsync`** — it throws at runtime. The
  File/Paths API is the current one. `apps/mobile/AGENTS.md` says to read the
  versioned docs first, and it is right.

## Commercial use is blocked, and it is not the FCC

`docs/licensing.md` has the register. FCC coverage, the Army manuals, FEIS and
Census are all public domain. **WHO Basic Emergency Care and WHO Psychological
First Aid are CC BY-NC-SA** — NonCommercial, with share-alike propagating.

The mitigation is already half-built: `core-firstaid-army` is 410 chunks of
public-domain first aid sitting beside the WHO pack's 667. **Dropping WHO costs
nothing measurable** (2026-09-23, Mac, paired held-out runs): 22/40 with it,
23/40 without, and the paediatric-dose answer went away with it.
`docs/results-without-who.md`. Only 40 questions, so it rules out a large loss,
not a small one.

**Nothing enforces this.** The pack format carries `nonCommercial: true` and no
code reads it.

## Credentials and local files, none of them in git

- `~/.config/fred/fcc.env` — FCC API username and token, mode 600.
- `~/fred-tracks/` — drive-test CSVs. They hold real coordinates;
  `.gitignore` refuses `bkr1-*.csv`.
- `~/fred-known-good.apk` — a working build, if one is ever needed back.
- `~/models/` — the GGUFs and the encoder. Not in git, needed by the eval.

## Commands

```
npm test                                            # 152 tests
npm run typecheck                                   # packages, tools AND the app
EVAL_SET=holdout node tools/eval/src/run-graded.ts docs/holdout-runs.jsonl
node tools/ingest/src/coverage-pack.ts out.bin <fcc.shp.zip>...
```

Ingest and measurement must not share a machine — a build at 1504% CPU once
turned a 5 s eval question into 98 s (`docs/results-m2.md`).
