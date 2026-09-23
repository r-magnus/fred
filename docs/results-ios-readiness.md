# RC-KR1 — what stands between Fred and an iOS build

Desk assessment, 2026-09-22, before any Mac work. **RC-KR1 grades `iOS && Android`
as an A and `iOS || Android` as a B**, due 2026-11-25. Android exists; iOS has
never been built.

**Short version: every native dependency already ships iOS support, so the code
is not the problem. Getting 1.8 GB of models onto an iPhone is.**

## The dependencies are fine

| Package | iOS sources | Podspec |
|---|---|---|
| `llama.rn` | yes | `llama-rn.podspec` |
| `@op-engineering/op-sqlite` | yes | `op-sqlite.podspec` |
| `onnxruntime-react-native` | yes | `onnxruntime-react-native.podspec` |
| `@maplibre/maplibre-react-native` | yes | `MapLibreReactNative.podspec` |

All four are the parts that would plausibly be Android-only — the inference
engine, the database, the encoder runtime and the map. None is.

The MapLibre config plugin exists *specifically* for iOS: on Android it only
applies customisations, while on iOS it adds `$MLRN.post_install(installer)` to
the Podfile. That path is already wired.

## What is actually missing

1. **`app.json` has no `ios` key at all.** No `bundleIdentifier`, which
   `expo prebuild` requires. One line.
2. **No `apps/mobile/ios/` directory.** Never prebuilt.
3. **Every patch script under `scripts/` is Android-only** — gradle properties,
   the ABI filter, the debuggable flag, the onnx autolink fix. The h3-js Hermes
   patch is JavaScript and applies to both. Whether iOS needs equivalents is
   unknown until a build is attempted; the onnx autolink bug cost days on
   Android (`docs/results-m3.md`) and there is no reason to assume its iOS side
   is clean.
4. **A Mac with Xcode and CocoaPods**, which the owner has.

## The real problem: 1.8 GB of models

Android stages models and packs with `adb push` into the app's documents
directory — 1,796 MB measured after cleanup: Qwen3-1.7B at 1,056 MB, the ONNX
encoder at 127 MB, a 598 MB state basemap, and the knowledge packs.

**iOS has no `adb push`.** Three options, none free:

| Approach | Cost |
|---|---|
| Bundle in the IPA | App Store allows large apps but warns hard above 200 MB, and cellular download limits apply. A ~1.8 GB app is hostile to install and slow to review. |
| Download on first run | The honest one for a shipping product, and mildly ironic for an offline app. Needs hosting, resumable transfer, and a first-run experience that is a long wait. |
| Xcode / Finder file sharing | Fine for a graded demo on the owner's own phone. Not a product. |

**For RC-KR1 specifically, file sharing is enough.** The KR asks for an app that
exists on both platforms, not for a distribution story. That should be stated
explicitly rather than discovered during grading.

The per-state map is the biggest single item at 598 MB and is the most
defensible thing to fetch on demand, since it is the one piece a user in another
state would need to swap anyway.

## Also owed before any store build

`scripts/patch-android-fieldtest.mjs` sets `debuggable true` on release builds so
`adb run-as` can retrieve drive-test data. **That flag must come off before
anything is submitted anywhere.** It is recorded in the script and here.

## Recommended sequence

1. Add `ios.bundleIdentifier` to `app.json` — can be done here, no Mac.
2. On the Mac: `npx expo prebuild -p ios`, then `pod install`.
3. Build to a simulator first. It will fail on the models, which is expected —
   it proves the native stack compiles, which is the actual unknown.
4. Build to a real device, side-load the models over Finder, and confirm the
   engine loads.

Steps 1 and 2 are where unknown-unknowns live. Nothing beyond step 2 can be
predicted from here, and step 2 is the one worth doing early: an architecture or
pod conflict found in September is an inconvenience, and the same conflict found
in late November is a missed KR.
