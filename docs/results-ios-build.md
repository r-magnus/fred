# RC-KR1 — the first iOS build

Attempted 2026-09-22 on an Apple Silicon Mac (macOS 26.6.2), **Xcode 27.0
(27A266a)**, iOS 27.0 simulator runtime (24A434), Node 26.9.0, npm 11.19.1,
CocoaPods 1.17.0. Branch `bkr1-location` at `fec91f0`. Followed
`IOS-SESSION.md`.

**Fred launches on an iOS simulator.** The native stack (llama.rn, op-sqlite,
onnxruntime-react-native, MapLibre, Hermes, Expo modules) compiles, links and
starts, and the app renders its own error screen for missing packs. The desk
assessment was right that the code is not the problem.

**The tree as it was at `fec91f0` did not launch, and the fix touches shared
config.** Xcode 27 refuses to launch any app that has not adopted the UIKit
scene life cycle, and Expo SDK 57 only supports that from `expo@57.0.23`. That
upgrade changes the lockfile the Android build uses.

> **Decision, 2026-09-22: the upgrade was taken now, before the drive test**, at
> the owner's call. It was first proven locally and reverted, then reapplied
> exactly as tested and verified again (Release build, launch, pack screen).
> **Android has not been rebuilt against it**; this Mac has no Android SDK. See
> "What this means for the drive test" below.

## What ran, in order

| Step | Result |
|---|---|
| `npm install` | Clean. `patch-h3-hermes` patched 6 files; the four Android scripts said `android/ not generated` or `already patched`, as expected. |
| llama.rn native artifacts | **Silently skipped** — see below. Fixed by running the package's own script. |
| `npx expo prebuild -p ios` | Clean. `ios.bundleIdentifier` was already in `app.json`. |
| `pod install` | Clean. 93 pods, no conflicts, no `--repo-update` needed. |
| `xcodebuild` Debug, simulator | **BUILD SUCCEEDED** |
| `xcodebuild` Release, simulator | **BUILD SUCCEEDED**, 174 MB `.app` |
| Launch | **Killed by UIKit before any JavaScript ran** — see below. |
| With the scene-support fix | Launches. Screenshot evidence: Fred title, red pack error. |

## Problem 1: npm 11 skips llama.rn's native download

npm 11.19 gates package install scripts behind `allowScripts`, and printed:

```
npm warn install-scripts   llama.rn@0.12.9 (postinstall: node ./install/download-native-artifacts.js)
```

The npm tarball of llama.rn ships a **partial** `ios/rnllama.xcframework`. Its
`Info.plist` declares simulator and tvOS slices, but only `ios-arm64` is on
disk. The skipped postinstall is what fetches the full framework (sha256
`ae9a37ae…`, checked by the script). Without it, a simulator build would fail at
link time with a missing-slice error that points nowhere near npm.

Fixed by running it directly:

```bash
node node_modules/llama.rn/install/download-native-artifacts.js
```

The same script fetches `android/src/main/jniLibs`, so the Linux machine is
either on an npm that does not gate scripts, or has these cached. **Anyone on
npm ≥ 11 with a clean cache will hit this on both platforms.** Not fixed in the
repo. `npm install-scripts approve llama.rn` would make it permanent but writes
to `package.json`, which is shared config.

The other two gated packages, `node-llama-cpp` and `onnxruntime-node`, belong
to the eval tooling and were left alone.

## Problem 2: Xcode 27 requires the UIKit scene life cycle

The Release build installed, started (pid assigned) and was gone within a
second, straight back to the home screen. Nothing on the console. Exactly the
symptom `IOS-SESSION.md` says to blame on h3-js, so that was checked first:

- The shipped `main.jsbundle` (Hermes bytecode v98) contains **zero** occurrences
  of `utf-16le`.
- h3 is in it (`latLngToCell`, `cellToLatLng`, `polygonToCells` present), so the
  zero is meaningful.

**It was not h3.** The simulator's unified log had the actual cause:

```
Application failed to launch: UIScene life cycle is required for apps built
with this SDK.
... exited with ... signal(2) code:SIGTRAP(5)
```

The iOS 27 SDK will not start an app that uses the AppDelegate-and-window life
cycle, which is exactly what Expo SDK 57's prebuild template generates. No
`UIApplicationSceneManifest` in `Info.plist`, no scene delegate. This is Expo's
known issue [expo/expo#46664](https://github.com/expo/expo/issues/46664). SDK 57
officially supports Xcode 26.4+, and Xcode 27 is newer than that.

**The lesson generalises the h3 one:** "dies instantly, nothing logged" has more
than one cause. The generic check is
`xcrun simctl spawn <udid> log show --last 5m --predicate 'process == "Fred"'`.
It found this in one command.

### The fix Expo ships

Expo backported scene support to SDK 57 in **`expo@57.0.23`** as an opt-in
([expo/fyi: ios-scene-lifecycle](https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md)):

```jsonc
// apps/mobile/app.json → expo.plugins
["expo-build-properties", { "ios": { "enableSceneSupport": true } }]
```

The setting itself is iOS-only. Expo states Android is unaffected.

### What it actually took in this monorepo

The `app.json` line was trivial. Getting npm to produce a tree that bundles was
not:

1. `npm install -w apps/mobile expo@~57.0.24 expo-build-properties@~57.0.21`
   installs cleanly. Then the JavaScript bundling phase fails with
   `Cannot read properties of undefined (reading 'transformFile')`.
   That message is a symptom. Metro swallows the real error earlier in the log:
   `Failed to construct transformer: Error: Cannot find module 'babel-preset-expo'`.
2. The upgrade moved `babel-preset-expo`, `expo-asset`, `expo-constants`,
   `expo-font`, `expo-keep-awake`, `@expo/cli`, `@expo/metro-config` and 14
   others from the root `node_modules` to `node_modules/expo/node_modules/`.
   `metro.config.js` sets `disableHierarchicalLookup: true`, and
   `babel.config.js` names `babel-preset-expo` without the app ever declaring
   it. **Both have only ever worked because npm happened to hoist these.**
3. Declaring `babel-preset-expo` and aligning `expo-file-system` to `~57.0.7`
   (`expo install --check` flagged it) fixed Babel, then Metro failed on
   `expo-asset` for the same reason.
4. `npm dedupe`, deleting the nested lock entries, and deleting the stale root
   entries all left the nesting in place. npm's incremental placement against
   the committed lockfile kept reproducing it.
5. **A lockfile resolved from scratch hoists correctly**, and with it the app
   bundles, builds and launches. But a fresh resolution drifts **55 packages**
   against the committed lockfile, including a native Android dependency:

   | Package | Committed | Fresh |
   |---|---|---|
   | `@op-engineering/op-sqlite` | 18.1.4 | **18.2.5** |
   | `expo-modules-core` | 57.0.16 | 57.0.18 |
   | `expo-modules-jsi` | 57.0.8 | 57.1.0 |
   | `expo-modules-autolinking` | 57.0.12 | 57.0.13 |
   | `onnxruntime-node` (eval only) | 1.29.0 | 1.30.0 |
   | `node-llama-cpp` (eval only) | 3.20.0 | 3.21.1 |

The change is this in `apps/mobile/package.json`:

```diff
-    "expo": "~57.0.20",
-    "expo-file-system": "~57.0.6",
+    "babel-preset-expo": "~57.0.12",
+    "expo": "~57.0.24",
+    "expo-build-properties": "~57.0.21",
+    "expo-file-system": "~57.0.7",
```

Plus the `expo-build-properties` plugin in `app.json`, and the from-scratch
lockfile. `babel-preset-expo` is declared because `babel.config.js` names it;
it should always have been.

After the launch was first proven, all of it was reverted pending a decision.
It was then **reapplied as-is**. `op-sqlite` 18.2.5 was kept rather than pinned
back to 18.1.4, because 18.2.5 is the combination that was actually tested.
Checks on the final tree: `npm run typecheck` passes, and `npm test` passes
152/152 once `~/models/` exists (`tokenizer.test.ts` reads the vocab from it).

### What this means for the drive test

The APK already on the phone is unaffected, because it was built before this
change. **Any Android build made from this branch from now on is a different
app:** newer Expo modules and a newer op-sqlite. If the drive test runs on
the existing APK, nothing changes. If the APK is rebuilt first, rebuild, run the
app through a quick pass (packs load, a question answers, the map and location
chip render) *before* driving, so a failure can be pinned on the upgrade
rather than on the field. To get the old build back:

```bash
git checkout fec91f0 -- package-lock.json apps/mobile/package.json apps/mobile/app.json
rm -rf node_modules && npm ci
```

## What the launched app showed

```
Fred
UnexpectedException: The file "packs" couldn't be opened because there is no
such file. (at ExpoModulesCore/SyncFunctionDefinition.swift:96)
```

This is the expected "no packs" failure, arriving one line earlier than
predicted. `loadEngine` in `apps/mobile/src/engine.ts` calls
`new Directory(BASE, 'packs').list()`, which throws when the directory does not
exist. So the friendlier `No knowledge packs installed` check below it never
runs. Android always had the directory because `adb push` created it. This is
not iOS-specific: a fresh Android install would show the same thing. Left
unfixed, since it is app code and out of scope for this session. *Fixed
2026-09-23: `loadEngine` checks `exists` first. Verified on the simulator.*

No other errors in the log. UIKit notes that `statusBarStyle` and
`statusBarFrame` are no-ops on iOS 27, which is harmless and comes from React
Native, not Fred.

## Problem 3: FTS5 was off on iOS (found 2026-09-23)

The question screen was reached, but the first question asked failed:
`no such module: fts5`. Lexical retrieval queries the packs' `chunks_fts`
tables, so no question on iOS could be answered.

op-sqlite reads its build options (`fts5`, `performanceMode`) from the app's
`package.json`, and the two platforms find that file differently:

- **The podspec** walks up from `node_modules/@op-engineering/op-sqlite/`. In
  this workspace, the first `package.json` it reaches is the **repo root's**,
  which had no `op-sqlite` block. So FTS5 was silently off, with no warning
  at `pod install`.
- **Android's Gradle** starts from `apps/mobile/android/`, whose path has no
  `node_modules`, so it reads `apps/mobile/package.json`. That's why Android
  always had FTS5.

Fix: the same `op-sqlite` block now sits in the root `package.json`. Android
never reads that file, so Android is unaffected. **Keep the two blocks
identical.** Check after `pod install`:
`grep SQLITE_ENABLE_FTS5 "apps/mobile/ios/Pods/Target Support Files/op-sqlite/"*.xcconfig`.

## Other notes

- **ONNX Runtime floats on both platforms.** `onnxruntime-react-native`
  1.24.3's podspec depends on `onnxruntime-c` with no version, so CocoaPods
  resolved **1.30.0**. Android does the same thing with
  `onnxruntime-android:latest.integration`. The JS binding and the native
  runtime are six minor versions apart on both. Given `docs/results-m3.md`
  (two runtimes that agree on metadata and still embed differently), pinning
  both is worth considering, but it is a change for both platforms.
- `llama.rn`'s `forceCxx20` plugin makes CocoaPods warn that the `Fred` target
  overrides `CLANG_CXX_LANGUAGE_STANDARD`. Expected, and harmless in this build.
- op-sqlite warns about an uninitialised `errorMessage` at `OPBridge.cpp:213`.
  An upstream warning, not an error.
- The `xcodebuild -downloadPlatform iOS` run reported
  `Registering simulator runtime with CoreSimulator failed`, yet the runtime
  registered and worked. Ignore that message if it appears.
- No `debuggable`-equivalent was added on iOS, per `IOS-SESSION.md`.

## What is still unknown

- **A real device.** Everything here is the simulator. Code signing, a
  provisioning profile, and sideloading the 1.8 GB of models over Finder are all
  untested. Nothing past the pack error has run on iOS: model load, Metal
  inference in llama.rn, ONNX encoder parity, MapLibre rendering.
- **Whether Xcode 26.x avoids Problem 2 with no config change.** SDK 57 supports
  Xcode 26.4+, and the scene requirement arrived with the iOS 27 SDK. A
  26.x install would probably launch the committed tree unchanged. That would
  be enough for RC-KR1 on the simulator, but would not survive the first App
  Store submission after Apple requires the iOS 27 SDK.
- **Whether the expo upgrade breaks Android.** Expo says scene support is
  iOS-only, but the upgrade itself moves `expo-modules-core` and friends, and
  op-sqlite. Untested: this Mac has no Android SDK.

## Next steps

1. **Rebuild Android on the Linux machine and give it a quick pass.** Do this
   before the next APK goes anywhere, and certainly before the next drive test.
2. Future dependency changes: an incremental `npm install <pkg>` can reproduce
   the nesting described above. If Metro fails with `transformFile` of
   undefined, look for `Failed to construct transformer` in the log and check
   `node_modules/expo/node_modules/`.
3. On a fresh clone with npm ≥ 11, run
   `node node_modules/llama.rn/install/download-native-artifacts.js` after
   `npm install`, or builds on both platforms will lack llama.rn's native
   libraries.
4. Fix the `packs/` directory check in `engine.ts` so both platforms show the
   intended message.
5. A real iOS device: signing, Finder sideload of the models, engine load.
