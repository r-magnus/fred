# Handoff from the Mac session — first iOS build

Reply to `IOS-SESSION.md`, 2026-09-22. The full write-up is
`docs/results-ios-build.md`; this is what the next session needs to act on.

## The short version

**Fred runs on iOS.** On an iOS 27 simulator it launches, loads Qwen3-1.7B and
the ONNX encoder, passes the embedder parity check at load, opens all four
knowledge packs and reaches the question screen. With a simulated California
position and `map-CA-z14.pmtiles` staged, **the offline map renders on iOS**
(confirmed by the owner in the simulator; MapLibre + PMTiles work on iOS too).

It took one config change, and **the owner chose to take it before the drive
test**: Expo 57.0.20 → 57.0.24 plus iOS scene support. **Android has not been
rebuilt since.** This Mac has no Android SDK.

## What changed in the repo

| File | Change |
|---|---|
| `apps/mobile/package.json` | `expo` ~57.0.24, `expo-file-system` ~57.0.7, adds `expo-build-properties` ~57.0.21 and `babel-preset-expo` ~57.0.12 |
| `apps/mobile/app.json` | `expo-build-properties` plugin with `ios.enableSceneSupport: true` |
| `package-lock.json` | Regenerated from scratch. 55 packages moved, including **op-sqlite 18.1.4 → 18.2.5** |
| `docs/results-ios-build.md` | New: what ran, what broke, why, how to roll back |
| `HANDOFF.md` | New entry under the traps, pointing here |
| `docs/metrics.json`, `docs/METRICS.md` | RC-KR1 note updated |

`npm run typecheck` passes. `npm test` passes 152/152.

## What you need to do

1. **Before any new APK is driven: rebuild Android and give it a quick pass.**
   Check that packs load, a question answers, and the map and location chip
   render. The APK already on the phone predates the upgrade and is unaffected.
   To roll back:
   `git checkout fec91f0 -- package-lock.json apps/mobile/package.json apps/mobile/app.json && rm -rf node_modules && npm ci`
2. **On npm ≥ 11, run llama.rn's native download after every clean install**:
   `node node_modules/llama.rn/install/download-native-artifacts.js`. npm now
   blocks install scripts by default. llama.rn's npm tarball ships a partial
   iOS framework (device slice only, no simulator), and the same script also
   fetches Android's `jniLibs`, so assume both platforms depend on it. Same for `onnxruntime-node` and `node-llama-cpp` if you run
   ingest or eval.
3. **Do not upgrade with `npm install <pkg>` in place.** It nested expo's
   dependencies under `node_modules/expo/node_modules/`, where Metro's
   `disableHierarchicalLookup` cannot see them. The symptom is
   `Cannot read properties of undefined (reading 'transformFile')`, and the
   real error sits earlier in the log as `Failed to construct transformer`.
   Only a lockfile regenerated from scratch fixed it.
4. **Small app fix, both platforms:** `loadEngine` calls
   `new Directory(BASE, 'packs').list()`, which throws when `packs/` is
   missing. So a fresh install shows a raw `UnexpectedException` instead of
   `No knowledge packs installed`.
5. **Worth deciding:** ONNX Runtime floats on both platforms. CocoaPods
   resolved `onnxruntime-c` 1.30.0, and Android pulls `latest.integration`,
   against JS bindings at 1.24.3. Parity passed today, but nothing pins it.

## Traps from this session

- **Xcode 27 will not launch an app without the UIKit scene life cycle.** The
  app starts and dies at once with nothing on the console, which looks exactly
  like the h3-js crash. It was not h3: the bundle had no `utf-16le`. The
  simulator's unified log said so in one line:
  `xcrun simctl spawn <udid> log show --last 5m --predicate 'process == "Fred"'`.
- **Xcode 27 has no Simulator.app.** The simulator window is
  `Xcode.app/Contents/Applications/DeviceHub.app`.
- **A new simulator has no location.** Permission is granted, then
  CoreLocation reports "location unavailable" and Fred shows
  `No location fix within the time limit`. Fix:
  `xcrun simctl location <udid> set 37.7456,-119.5936`.
- **Files go in the app's Documents folder**, the same layout as Android's
  `files/`: models at the root, packs at `packs/<id>/` with the version
  stripped, maps at `map-<STATE>-z14.pmtiles`. On a simulator that folder is
  `xcrun simctl get_app_container <udid> dev.fred.app data` + `/Documents`.

## State of the Mac

Everything below is outside git, so nothing here needs committing.

- **Models** in `~/models/`, byte-identical to the documented ones:
  `Qwen3-1.7B-Q4_K_M.gguf` from `unsloth/Qwen3-1.7B-GGUF` (1,107,409,472 B)
  and `gte-small.onnx` = `Supabase/gte-small` `onnx/model.onnx`
  (133,093,490 B), plus `vocab.txt`. `verify-embedder.ts`: PARITY OK. The
  repo never recorded these sources; now it does.
- **Corpora** in `corpora/`: all three PDFs checksum-match their publishers,
  and FEIS is cached (1,092 reviews).
- **Packs rebuilt here** with `CONTEXTUALIZE=1`: core-firstaid 1.1.0 (668
  chunks), core-survival 1.2.0 (563), core-firstaid-army 1.2.0 (410),
  state-CA-flora-fauna 1.0.0 (5,773). **Not byte-identical to the Linux packs**,
  because contextualizing is generative. Do not compare accuracy across them.
- **Map** `~/maps/map-CA-z14.pmtiles` is 641,305,918 B from the same
  `20260920` Protomaps build. The docs say 598 MB, and the gap is unexplained.
- **Simulator** "FredTest", iPhone 18 Pro, iOS 27.0, located in Yosemite
  Valley, with all of the above staged.
- **Not staged: coverage.** `coverage-CA-lte.bin` needs FCC BDC downloads,
  and the API credentials live in `~/.config/fred/fcc.env` on the Linux
  machine only.

## Still unknown

- **A real iPhone.** Signing, sideloading 1.8 GB over Finder, and Metal
  inference on device are all untested.
- **Answer quality and latency on iOS.** The question screen was reached, but
  no answers were measured.
- **Whether the upgrade is safe on Android** (item 1 above).
