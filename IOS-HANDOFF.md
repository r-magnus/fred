# Handoff from the Mac session — iOS, 2026-10-07

Supersedes the 2026-09-22 note (the first iOS build). The full write-up is
`docs/results-ios-build.md`, which now ends with a 2026-10-07 section; this is
what the next session needs to act on.

## The short version

**Main runs on the iOS simulator.** Main at `fd7c687` plus PR #153 builds for
the iOS 27 simulator with no native changes, loads Qwen3-1.7B and
EmbeddingGemma, passes parity on every pack, and answers: field cards, a
model-written answer with its opening line, a decline, the map card for "i’m
lost". The full map and the offline-maps panel open and draw.

**The simulator still has the 2026-09-30 packs**: six, `core-fieldcards` 0.5.0,
no sentence index. The twelve that main was measured on are in
`~/fred-packs-g-all` on the Linux machine and are not on this Mac.

**Nothing here is a measurement.** The simulator runs the generator on the
Mac's CPU; it is for checking that things work, not for timing or accuracy.
By the owner's decision (2026-10-07), metrics are not redone on the simulator.

## What changed in the repo (PR #153, branch `ios-curly-apostrophes-fts5`)

| File | Change |
|---|---|
| `package.json` (root) | The `op-sqlite` block (`fts5`, `performanceMode`). **iOS reads it from here, not from `apps/mobile/package.json`** |
| `apps/mobile/App.tsx`, `packages/rag-core/src/map-intent.ts` and its test | Curly apostrophes read as straight ones. The iOS keyboard types `’`, and "i’m lost" opened no map |
| `tools/ios/tap.swift` | New: taps the simulator from the command line |
| `docs/results-ios-build.md` | 2026-10-07 section: what ran, what was seen |

`npm run typecheck` passes. `npm test` passes 342/342. `pod install` leaves
`Podfile.lock` unchanged.

## What you need to do

1. **Merge #153, then rebuild Android with it and give it a quick pass.** The
   root `package.json` block is new to Android's build; the same block has been
   in `apps/mobile/package.json` all along, so no change is expected, but it has
   not been built. This Mac has no Android SDK.
2. **When the simulator should match main, bring the twelve packs over** and
   replace `Documents/packs/` wholesale (an old pack left beside new ones fails
   the load). Not urgent: it matters for seeing current behaviour, not for any
   number.
3. **A real iPhone** is still the open item for RC-KR1: signing, getting 1.8 GB
   of models and packs onto it, Metal inference, and the first iOS timings.
4. **A bundle download on iOS, start to finish.** The panel lists every state
   and shows California as partly downloaded; no download was started.

Carried over from 2026-09-22 and still open:

- `loadEngine` lists `packs/` without checking it exists, so a fresh install
  shows a raw `UnexpectedException` instead of `No knowledge packs installed`.
- ONNX Runtime floats on both platforms (`onnxruntime-c` 1.30.0 against JS
  bindings at 1.24.3). Unused while the packs are EmbeddingGemma.

## Seen on the old packs, not chased

Both are recorded in the results doc. Neither has been seen on the current
packs or on the phone, so they are notes, not bugs.

- "what is a good sourdough recipe?" asked straight after the bleeding question
  got the bleeding card again. In its own session it was declined.
- "is it safe to eat fish that smells a little off?" got the wild-plants card,
  with fish passages ranked first.

## How to rebuild and run

```bash
cd apps/mobile/ios && pod install          # expect no change to Podfile.lock
xcodebuild -workspace Fred.xcworkspace -scheme Fred -configuration Release \
  -sdk iphonesimulator -destination 'id=<udid>' -derivedDataPath build build
xcrun simctl install <udid> build/Build/Products/Release-iphonesimulator/Fred.app
xcrun simctl launch <udid> dev.fred.app
```

No prebuild and no `npm ci` unless `apps/mobile/package.json`, `app.json` or
the lockfile has moved. FredTest's udid is
`85C3306D-FBBB-4538-8A0C-09C20BB81DD1`.

**Asking questions without typing.** The same inbox `ask-phone.sh` uses on
Android: create `Documents/devhooks`, then write `question<TAB>state` lines to
`Documents/devhooks-ask.txt`. The app takes one line every two seconds when it
is idle. Questions in one launch share a conversation; terminate and relaunch
for a fresh one. `devhooks` is in place on FredTest now.

**Reading the log.** Start this before launching the app:
`xcrun simctl spawn <udid> log stream --level info --predicate 'process == "Fred" AND eventMessage CONTAINS "[fred]"'`

**Tapping.** `tools/ios/tap.swift`; its header says how to find the point. The
"Fred" title opens the full map; the location chip re-reads the position.

## Traps

- **op-sqlite's podspec reads the first `package.json` above `node_modules`**,
  which is the root one. Without the block there, `pod install` builds SQLite
  without FTS5 and stage-1 retrieval fails. Check with
  `grep FTS5 "Pods/Target Support Files/op-sqlite/op-sqlite.release.xcconfig"`.
- **A Release build's `console.log` is info level**, and `log show` does not
  keep it. Use `log stream --level info`.
- **`screencapture` of the simulator window raises a Screen Recording prompt**
  that sits over the device and takes the clicks meant for it. Use
  `xcrun simctl io <udid> screenshot`.
- **Installing over the app keeps `Documents/`**; `simctl uninstall` does not.
- **`pkill -f` with a pattern that is also in the same command kills the shell
  running it.** It is in `HANDOFF.md`, and it bit again here. Use PIDs.
- **Xcode 27 will not launch an app without the UIKit scene life cycle.** The
  app starts and dies at once with nothing on the console. Already fixed in
  `app.json` (`ios.enableSceneSupport`); the symptom is worth knowing.
- **Xcode 27 has no Simulator.app.** The simulator window is
  `Xcode.app/Contents/Applications/DeviceHub.app`.
- **A new simulator has no location.**
  `xcrun simctl location <udid> set 37.7456,-119.5936`.
- **On npm ≥ 11, run llama.rn's native download after every clean install**:
  `node node_modules/llama.rn/install/download-native-artifacts.js`. Its npm
  tarball ships no simulator slice.
- **Do not upgrade with `npm install <pkg>` in place.** It nests expo's
  dependencies where Metro cannot see them
  (`Cannot read properties of undefined (reading 'transformFile')`).
  Regenerate the lockfile from scratch.

## State of the Mac

Everything below is outside git.

- **Models** in `~/models/`: `Qwen3-1.7B-Q4_K_M.gguf` (1,107,409,472 B) and
  `embeddinggemma-300M-Q8_0.gguf` (333,590,944 B). `gte-small.onnx` and its
  vocabulary are still there and on the simulator, unused.
- **Packs** in `packs/`: the six from 2026-09-30 (`core-fieldcards` 0.5.0,
  `core-firstaid` 1.4.0, `core-firstaid-army` 1.4.0, `core-survival` 1.4.0,
  `core-signaling` 1.0.0, `state-CA-flora-fauna` 1.1.0). Not the current set.
- **Map** `~/maps/map-CA-z14.pmtiles` (641,305,918 B). No bundles on this Mac.
- **Simulator** "FredTest", iPhone 18 Pro, iOS 27.0, located in Yosemite
  Valley. `Documents/` holds both models, the California basemap, a 2.3 MB trial
  `contours-CA.pmtiles`, the six packs, `devhooks`, and the saved lane prompts.
- **Files go in the app's Documents folder**, the same layout as Android's
  `files/`: models at the root, packs at `packs/<id>/` with the version
  stripped, maps at `map-<STATE>-z14.pmtiles`. The folder is
  `xcrun simctl get_app_container <udid> dev.fred.app data` + `/Documents`.

## Still unknown

- **A real iPhone.** Signing, sideloading, Metal inference, timings.
- **The current twelve packs on iOS.**
- **A bundle download on iOS.**
- **Whether the root `package.json` change is neutral on Android** (item 1).
