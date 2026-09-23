# Instructions for the Mac session — first iOS build

You are picking this up cold on a Mac. Everything so far has been built and
tested on Android only. **Your job is to find out whether Fred's native stack
compiles for iOS, and to record what happens.** Nothing else.

Work on branch **`bkr1-location`**, not `main`. Head when this was written:
`dbe4a32`. Node on the Linux machine is v24.15.0.

## Why this is worth an hour today

RC-KR1 (due 2026-11-25) grades **`iOS && Android` as an A** and `iOS || Android`
as a B. Android works. iOS has never been built.

`docs/results-ios-readiness.md` is the desk assessment — read it first. Short
version: all four risky native dependencies (llama.rn, op-sqlite,
onnxruntime-react-native, maplibre-react-native) ship iOS sources and podspecs,
so the code is probably fine. **An architecture or pod conflict found now is an
inconvenience; the same conflict found in late November is a missed KR.** That
is the entire reason for doing this early.

## Read this before writing any app code

`apps/mobile/AGENTS.md` says: **Expo has changed — read the exact versioned docs
at https://docs.expo.dev/versions/v57.0.0/ before writing any code.** It is
right, and it has already paid off twice on Android. `writeAsStringAsync` is
deprecated in SDK 57 and *throws at runtime*; the File/Paths API replaced it.
Do not write Expo code from memory.

## The sequence

```bash
npm install                       # postinstall runs five patch scripts
npx expo prebuild -p ios          # generates apps/mobile/ios/
cd apps/mobile/ios && pod install
```

**On `npm install`:** four of the five patch scripts are Android-only and will
print something like `android/ not generated; nothing to do` on a fresh clone.
That is correct, not a failure. The fifth, `patch-h3-hermes.mjs`, is JavaScript
and **must** report patching files — see "do not skip" below.

**On `prebuild`:** `ios.bundleIdentifier` is already in `app.json`, so this
should not stop on config. It will generate `apps/mobile/ios/`, which is
gitignored like `android/`.

**On `pod install`:** this is where trouble lives. Four native pods, one of them
(`onnxruntime-react-native`) whose Android autolinking needed a patch script
that cost days to find. Expect version conflicts and read errors carefully
rather than reaching for `--repo-update` immediately.

## Then build to the simulator

Open `apps/mobile/ios/*.xcworkspace` in Xcode — **the workspace, not the
project** — and build for any simulator.

**It is expected to launch and fail at "No knowledge packs installed."** That is
success for this exercise. The models and packs are 1.8 GB and are not in the
repo; getting them onto iOS is a separate unsolved problem
(`docs/results-ios-readiness.md` covers the three options). Reaching that error
proves the native stack compiled and linked, which is the actual unknown.

## Do not skip this check

h3-js crashes Hermes. Its Emscripten preamble builds a `TextDecoder("utf-16le")`
that Hermes rejects, and the app dies in under a second with **no JavaScript
error, no crash log and `Status: ok` from the launcher** — the only evidence is a
native tombstone. It cost most of a morning on Android.
`scripts/patch-h3-hermes.mjs` neutralises it, and the decoder is provably never
read.

If the iOS app dies instantly at launch with nothing logged, **that is the first
thing to suspect**, and confirm by checking the built JS bundle rather than the
source — on Android a cached bundle kept shipping the crash after the fix was
correct. Grep the bundle for `utf-16le`; it must be absent.

## What to record

Write `docs/results-ios-build.md` in the same voice as the other results docs:
what you ran, what broke, what you changed, what is still unknown. **Negative
results are the point.** "pod install fails on X and here is why" is a genuinely
useful outcome and belongs in the report; a vague "didn't work" does not.

If you change anything under `scripts/`, keep it idempotent and make it refuse
rather than guess when it cannot find what it expects — that is the pattern every
existing patch script follows.

## Constraints

- **Do not touch anything Android.** The Android build works, the APK is 150 MB
  after an architecture trim, and there is a drive test pending on that exact
  build. Changing shared config risks it.
- **Do not claim iOS works until an app launches on a simulator.** `pod install`
  succeeding is not the same thing.
- **Do not commit `apps/mobile/ios/`.** It is generated, like `android/`.
- **Do not try to run the eval harness.** It needs ~1.2 GB of models in
  `~/models/` that are not in the repo.
- The field-test build sets `debuggable true` on Android release builds so drive
  data can be retrieved. **Nothing equivalent should be added on iOS**, and that
  Android flag must come off before any store submission.

## Where the context is

- `HANDOFF.md` — overall state of the project
- `docs/results-ios-readiness.md` — the desk assessment behind this task
- `docs/METRICS.md` — the scorecard, generated; edit `docs/metrics.json` instead
- `apps/mobile/AGENTS.md` — the Expo warning, which is not boilerplate
