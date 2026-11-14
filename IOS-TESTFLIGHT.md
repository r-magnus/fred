# Handoff to the Mac session — first TestFlight build, 2026-11-14

From the Linux session. Ticket #28 (RC-KR1: Fred answers a question on a real
iPhone using installed packs). Branch: **`ios-testflight`**. Work on that
branch, not main. Read `IOS-HANDOFF.md` too: its traps (log streaming, llama.rn
native artifacts, npm upgrades) all still apply.

Ryan wants status in plain words, no unexplained jargon.

## The short version

The iPhone build should match the current Android build with no new code. Every
feature Fred has on Android lives in shared code, and the two Android-only
native modules load as optional, so on iPhone they do nothing instead of
crashing. What is left is **building on a real iPhone, checking it, and
uploading it**. Nobody has run Fred on a real iPhone yet, so expect surprises
in steps 3 and 4, not in the code.

The Android team's own signing, the field-test "debuggable" patch and the
swipe-back module (`fred-edge`) have no iPhone counterpart and need none.

## What changed since your last session (main was at `fd7c687`)

- 47 merged PRs: the setup wizard, the UI revamp, the side drawer, the compass,
  reply formatting, battery estimate (Android), drive-test work, many answer
  fixes. All JavaScript except as below.
- **New native dependency: `expo-keep-awake`** (keeps the screen on while a
  download runs). This is why a full prebuild + `pod install` is needed, not the
  quick rebuild in `IOS-HANDOFF.md`.
- **The guides and models now download inside the app** (#219, #220). The live
  index at `https://raw.githubusercontent.com/r-magnus/fred-maps/main/index.json`
  has a `core` entry (checked 2026-11-14): about 1.45 GB, most of it the
  1.11 GB generator model. A fresh iPhone should need no files copied by hand.
- **The `loadEngine` crash on a fresh install** (listing `packs/` that does not
  exist), carried over in `IOS-HANDOFF.md`, is fixed on main.
- On this branch:
  - PR #153 merged (curly apostrophes; FTS5 block in the root `package.json`).
    Android checked: its op-sqlite build reads `apps/mobile/package.json`, which
    already had the same block.
  - `app.json` iOS settings: `buildNumber` "1";
    `ITSAppUsesNonExemptEncryption: false` (Fred only uses the system's HTTPS,
    so App Store Connect skips the export-compliance question);
    `UIFileSharingEnabled` + `LSSupportsOpeningDocumentsInPlace` (Fred's
    Documents folder shows in the Files app, which replaces `adb push` for
    testers and for you).
  - `locationWhenInUsePermission` set. Before, the iPhone prompt would have
    shown iOS's generic "Allow Fred to access your location", because Fred only
    asks for while-in-use permission and only the "always" text was set.
- `npm test` 410/410 and `npm run typecheck` pass on the branch.

## Step 0 · Things only people can do (stop and ask Ryan if any are missing)

The Apple developer account belongs to **Ryan's friend**, not Ryan.

1. **Who signs and uploads?** Either the friend adds Ryan's Apple ID to their
   team in App Store Connect (Users and Access, role **App Manager** or
   **Admin**: Developer cannot create the app record), or the friend does steps
   4–5 themselves. Ask which, and make sure that Apple ID is signed in to
   Xcode (Settings › Accounts) and the team shows up.
2. **The team ID** (10 characters, shown in Xcode › Settings › Accounts or on
   developer.apple.com › Membership). **Do not commit it**: it is the friend's.
   Pass it on the command line (`DEVELOPMENT_TEAM=...`) or set it in Xcode.
   Prebuild resets the Xcode project, so it has to be set again after every
   prebuild.
3. **A real iPhone**, plugged in, unlocked, with Developer Mode on
   (Settings › Privacy & Security › Developer Mode; the phone restarts). It
   needs about 3 GB free.
4. **The App Store Connect app record** (My Apps › + › New App): platform iOS,
   bundle ID `dev.fred.app`, SKU anything (e.g. `fred`). **The store name must
   be unique across the whole App Store and "Fred" is very likely taken.** Ask
   Ryan for one (e.g. "Fred: Trail Guide"). The name under the icon stays
   "Fred"; that one does not have to be unique. If the upload is later refused
   with ITMS-90129 ("display name already taken"), tell Ryan; do not rename the
   app on your own.
5. If Xcode says `dev.fred.app` is not available, someone else owns that ID.
   Stop and ask Ryan. Changing it means changing `app.json` and every devhook
   instruction that names it.

## Step 1 · Clean install and prebuild

```bash
git fetch origin && git checkout ios-testflight && git pull
npm ci                                   # at the repo root
node node_modules/llama.rn/install/download-native-artifacts.js
cd apps/mobile
npx expo prebuild --platform ios         # iOS ONLY. Never let it touch android/
cd ios && pod install
grep FTS5 "Pods/Target Support Files/op-sqlite/op-sqlite.release.xcconfig"
```

- The last line must print a line with `SQLITE_ENABLE_FTS5`. If it prints
  nothing, search will fail on the phone. Check the root `package.json` still
  has the `op-sqlite` block.
- Check the generated `ios/Fred/Info.plist` has the four keys from `app.json`
  and the Fred wording for `NSLocationWhenInUseUsageDescription`.
- Do **not** edit `modules/fred-energy/expo-module.config.json` yet (step 6).

## Step 2 · Build for the real iPhone

Open `ios/Fred.xcworkspace`, select the target **Fred** › Signing &
Capabilities › tick "Automatically manage signing" › Team = the friend's team.
Choose the plugged-in iPhone and the **Release** scheme configuration (Product ›
Scheme › Edit Scheme › Run › Build Configuration). Release, because a Debug
build loads its JavaScript from a dev server on the Mac. Then Product › Run.

Command-line equivalent, if you prefer:

```bash
xcrun devicectl list devices                     # the iPhone's identifier
xcodebuild -workspace Fred.xcworkspace -scheme Fred -configuration Release \
  -destination 'generic/platform=iOS' -derivedDataPath build \
  -allowProvisioningUpdates DEVELOPMENT_TEAM=<team id> build
xcrun devicectl device install app --device <id> build/Build/Products/Release-iphoneos/Fred.app
```

The first launch may say "Untrusted Developer": Settings › General › VPN &
Device Management › trust the team.

**Reading the log from a real phone:** `log stream` on the Mac only sees the
simulator. Use Console.app with the iPhone selected on the left, Action ›
Include Info Messages, and search for `[fred]`.

## Step 3 · The phone check (this is what closes #28)

On Wi-Fi, from a fresh install. Write down what you see for each line.

1. The setup wizard opens. The location prompt shows Fred's own wording.
2. Download the guides (about 1.45 GB). Watch it finish and pass the size and
   MD5 check.
3. **Background test:** start a state map download, go to the home screen for
   a minute, come back. On iOS, downloads run in a background session by
   default (expo-file-system), so it should still be going. Note what happens.
   Do not lock the phone yet: that is a separate test, and losing a 1.1 GB
   download to it is known (#198 item 2: no resume yet).
4. Fred loads (`[fred] load ready: N packs, M passages` in Console). If the app
   **disappears during the model load** with no error, it was probably killed
   for using too much memory: see "If it dies loading the model".
5. Ask a field-card question (e.g. "how do I stop bleeding?") and a written one
   (e.g. "what should I pack for an overnight hike?"). Both answer.
6. Type "i'm lost" on the iPhone keyboard (it types a curly ’): the map card
   opens. Type "I can't call 911": it is treated as no-signal.
7. Open the map: it draws, your position shows, the **compass turns** when you
   turn the phone (`watchHeadingAsync`; it has never run on a real iPhone).
8. Close Fred fully and reopen: no re-download, it loads straight to chat.
9. Files app › On My iPhone › Fred: the models and `packs/` are visible.
10. Timings, for reference only (not a metric, Ryan's decision 2026-10-07):
    for the written question, seconds to the first word and to the end.
    Fred runs on the **CPU only** on both platforms (`n_gpu_layers: 0` in
    `device-pack.ts`). Do not switch on Metal; that is a separate decision.

If all of 1–9 pass, #28's "done when" is met. Tell Ryan; do not close the ticket.

### If it dies loading the model

Check Settings › Privacy & Security › Analytics & Improvements › Analytics Data
for a `JetsamEvent` at that time. If there is one, iOS killed Fred for memory.
The usual fix is the **increased memory limit entitlement**: add to `app.json`
under `ios`:

```json
"entitlements": { "com.apple.developer.kernel.increased-memory-limit": true }
```

then prebuild again. The App ID also needs the "Increased Memory Limit"
capability ticked on developer.apple.com (Identifiers › dev.fred.app); Xcode's
capability list may not offer it. Apple says the extra memory is only there on
some models, so note which iPhone it is. Do not add it pre-emptively. If the
load works without it, leave it out.

## Step 4 · Archive and upload

Only after step 3 passes.

1. `buildNumber` in `app.json` must be higher than every build already
   uploaded for version 0.2.0. It is "1" for this first upload. Bump it and
   commit it for every later upload (prebuild again after changing it).
2. Product › Archive (Any iOS Device, Release). Organizer › Distribute App ›
   App Store Connect › Upload. Or:
   ```bash
   xcodebuild -workspace Fred.xcworkspace -scheme Fred -configuration Release \
     -archivePath build/Fred.xcarchive -allowProvisioningUpdates \
     DEVELOPMENT_TEAM=<team id> archive
   # ExportOptions.plist: method app-store-connect, destination upload, teamID
   xcodebuild -exportArchive -archivePath build/Fred.xcarchive \
     -exportOptionsPlist ExportOptions.plist -allowProvisioningUpdates
   ```
   Keep `ExportOptions.plist` outside git (it holds the team ID).
3. After upload, App Store Connect processes the build (minutes to an hour).
   **Watch the account's email** for:
   - **ITMS-91053 "Missing API declaration"**: a library uses a system call
     Apple wants a reason for. Expo writes the app's privacy manifest from
     `app.json` › `ios.privacyManifests`. Add the category and reason the email
     names, prebuild, bump the build number, upload again. Only expo-file-system
     and expo-constants ship their own manifests. llama.rn, op-sqlite and
     MapLibre do not, so a hit from one of them is the likely case.
   - ITMS-90129 (name taken): see step 0.4.

## Step 5 · TestFlight

- **Internal testing first.** People on the friend's team (App Store Connect
  users) can test as soon as the build has processed, with no review. Add Ryan.
- **External testing** (anyone with an email or a public link) needs Beta App
  Review, typically 1–2 days, longer for the first build. App Store Connect ›
  TestFlight › Test Information: a beta description, a feedback email, and
  probably a privacy policy URL. Fred collects nothing, but the field may be
  required. Ryan provides all of these; do not invent them. Review notes
  should say no login is needed and the first launch downloads about 1.5 GB.
- Builds expire after 90 days.

## Step 6 · Second build: switch on the battery estimate

Not for the first upload. Android shows "about N answers left"; the iPhone
shows nothing, because `modules/fred-energy/ios` has never been compiled and is
switched off. The steps are in `docs/results-battery-estimate.md` › "The
iPhone". In short, set `"platforms": ["apple", "android"]` and add
`"apple": { "modules": ["FredEnergyModule"] }` in
`modules/fred-energy/expo-module.config.json`, `pod install`, build, and check
the `[fred] energy kind=... joules=...` log line after a card question and a
written one.

## Later, not blocking TestFlight

- **iCloud backup.** Everything lives in Documents (Files app sharing needs
  that), so iCloud backup would include the 1.45 GB of downloads. Full App
  Store review rejects this (guideline 2.23, iOS Data Storage Guidelines).
  The fix is to flag re-downloadable files "excluded from backup". expo-file-system
  has no option for it, so it would need a few lines of native code. Note it on
  #28; do not build it now.
- **Resuming dropped downloads** (#198 item 2) affects both platforms.

## Report back

1. Add a dated section to `docs/results-ios-build.md`: the iPhone model and iOS
   version, each step-3 line passed/failed with what was seen, the timings,
   and any upload emails.
2. Replace `IOS-HANDOFF.md` with a new Mac → Linux note (what's done, what's
   open, state of the Mac), the way the 2026-10-07 one was written.
3. Commit on `ios-testflight` and push. Do **not** merge to main. The Linux
   session rebuilds Android from this branch first.
4. A short comment on issue #28 saying where it stands.
