# Handoff: building Fred for TestFlight on the Apple account owner's Mac, 2026-11-14

For a coding agent running on the Mac of the person who owns the Apple
developer account (called **the account owner** below). Ryan owns the Fred
project; the account owner is helping by signing and uploading the iPhone build.
You have no other context, so this note is meant to be enough on its own.

The full step-by-step is `IOS-TESTFLIGHT.md` on the same branch. Read it after
this note. This note covers getting a fresh Mac ready, what has already been
checked, and the rules.

## The goal

Get Fred (an offline trail-guide app: React Native + Expo, with an AI model
running on the phone) onto a real iPhone, check that it works, and upload it to
TestFlight so Ryan and others can install it. Ticket: GitHub issue #28 on
`r-magnus/fred`.

## Rules

- Work on the branch **`ios-testflight`**. Do not merge it into `main` and do
  not push to `main`.
- **Never commit the team ID**, `ExportOptions.plist`, signing certificates or
  anything else from the account owner's Apple account. Pass the team ID on the
  command line or set it in Xcode only.
- Do not change the bundle ID (`dev.fred.app`), the app name, the version
  (`0.2.0`) or any app settings in `apps/mobile/app.json` without asking Ryan.
  The one exception is `buildNumber`, which goes up by one for every upload
  after the first (see `IOS-TESTFLIGHT.md` step 4).
- Do not switch the AI model to the GPU (Metal). Fred runs on the CPU only on
  purpose.
- Explain things to people in plain words, with no unexplained jargon.
- If a step says to ask Ryan, stop and ask. Don't guess.

## Already checked on Ryan's Mac today

On `ios-testflight` at `0d7d749`, with Xcode 27.2, Node 24.21, npm 11.19 and
CocoaPods 1.17.0:

- `npm ci`, the llama.rn native download, `expo prebuild --platform ios` and
  `pod install` all worked.
- SQLite was built with full-text search (FTS5). Search on the phone needs it.
- The generated `Info.plist` has every setting it needs: no export-encryption
  question at upload, Fred's folder visible in the Files app, and Fred's own
  wording on the location prompt. Version 0.2.0, build 1.
- `npm test` (410/410) and `npm run typecheck` pass.
- A Release build for the **iPhone simulator** compiled with no errors.

So the code builds. Nobody has run it on a **real iPhone** yet, and nobody has
signed it. That is your part.

## Part A · Things the account owner does by hand

Ask the account owner to do these, and confirm each before going on:

1. **Xcode**, installed from the App Store (27.x; 27.2 is known to work), opened
   once so it finishes installing its parts. Then Xcode › Settings › Accounts:
   sign in with the Apple ID that owns the developer account and check that
   the team shows up.
2. **The team ID.** It is 10 characters, shown in Xcode › Settings › Accounts
   (select the team) or on developer.apple.com › Account › Membership. Keep it
   in the session only and never write it into the repo.
3. **The iPhone:** plugged in with a cable, unlocked, "Trust This Computer"
   accepted, and **Developer Mode** turned on (Settings › Privacy & Security ›
   Developer Mode; the phone restarts). It needs about 3 GB free.
4. **The App Store Connect app record**, needed only before uploading:
   appstoreconnect.apple.com › Apps › + › New App. Platform iOS, bundle ID
   `dev.fred.app`, SKU `fred`. For the name, **try "Fred" first**. The name
   must be unique across the whole App Store, and App Store Connect says at
   once if it is taken. If it is, check with Ryan before using a backup such
   as "Forest Fred". The name under the app icon stays "Fred" either way.
5. If Xcode says `dev.fred.app` belongs to someone else, stop and tell Ryan.

## Part B · Getting the Mac ready (you can do these)

Check what is already installed first, and only install what is missing.

```bash
xcode-select -p             # should point inside Xcode.app, not CommandLineTools
                            # if not: sudo xcode-select -s /Applications/Xcode.app
node -v                     # 24.x
npm -v                      # 11.x
pod --version               # CocoaPods 1.16 or newer
git --version
```

- Node: install Node 24 (from nodejs.org, Homebrew `brew install node@24`, or
  nvm). npm comes with it.
- CocoaPods: `brew install cocoapods` (or `sudo gem install cocoapods`).
- Homebrew, if it is missing and needed: ask the account owner before
  installing it, because it needs their password.

Get the code. The account owner already has access to the private repo:

```bash
git clone https://github.com/r-magnus/fred.git   # or the SSH URL
cd fred
git checkout ios-testflight && git pull
```

If cloning asks for a login, use `gh auth login` (GitHub CLI) or the account
owner's usual GitHub login. Never put a token into a file in the repo.

## Part C · Build and test on the iPhone

Follow `IOS-TESTFLIGHT.md` from **step 1**. Short version:

```bash
npm ci                                                    # at the repo root
node node_modules/llama.rn/install/download-native-artifacts.js   # always, after npm ci
cd apps/mobile
npx expo prebuild --platform ios                          # iOS ONLY
cd ios && pod install
grep FTS5 "Pods/Target Support Files/op-sqlite/op-sqlite.release.xcconfig"
# must print a line containing SQLITE_ENABLE_FTS5
```

Then build the **Release** configuration for the plugged-in phone. A Debug
build would try to load its code from this Mac and fail on its own.

```bash
xcrun devicectl list devices          # find the iPhone's identifier
xcodebuild -workspace Fred.xcworkspace -scheme Fred -configuration Release \
  -destination 'generic/platform=iOS' -derivedDataPath build \
  -allowProvisioningUpdates DEVELOPMENT_TEAM=<team id> build
xcrun devicectl device install app --device <id> \
  build/Build/Products/Release-iphoneos/Fred.app
```

Or in Xcode: open `ios/Fred.xcworkspace`, target Fred › Signing & Capabilities ›
Automatically manage signing › pick the team. Then set Product › Scheme › Edit
Scheme › Run › Build Configuration to **Release**, choose the iPhone and press
Run.

- The first launch may say "Untrusted Developer". On the phone: Settings ›
  General › VPN & Device Management › trust the team.
- Prebuild resets the Xcode project, so set the team again after every
  prebuild.
- **Logs from a real phone:** `log stream` on the Mac only sees the simulator.
  Use Console.app, select the iPhone on the left, turn on Action › Include Info
  Messages, and search for `[fred]`.

The account owner then goes through the phone checks in `IOS-TESTFLIGHT.md`
**step 3**: setup, the 1.45 GB download, background download, answers, typing
"i’m lost", the map and compass, reopening, the Files app. Write down what
happens for each one. If the app vanishes while loading the model, follow "If
it dies loading the model" in that file. Don't add the memory setting unless
that actually happens.

## Part D · Upload and TestFlight

Only after the step 3 checks pass, and only once the app record from Part A.4
exists. Follow `IOS-TESTFLIGHT.md` steps 4 and 5: archive, upload, then watch
the account owner's email for Apple's automatic notices (ITMS-91053 "Missing
API declaration" is the likely one; the fix is in that file). Then add Ryan as
an **internal tester** in TestFlight. Internal testing needs no Apple review.
External testing does, and Ryan supplies the description, feedback email and
privacy policy link. Don't make any of them up.

## Known traps

- After **every** `npm ci`, run the llama.rn native download. Without it the
  build is missing the AI engine's iPhone files.
- Don't upgrade packages with `npm install <pkg>`. It breaks the bundler. Leave
  dependencies alone.
- `expo prebuild` without `--platform ios` would also generate Android files.
  Always pass `--platform ios`.
- `pkill -f <pattern>` run from a command that contains the same pattern kills
  its own shell. Use process IDs.
- If `pod install` builds SQLite without FTS5, check that the root
  `package.json` still has its `op-sqlite` block.

## Report back

1. Tell Ryan (or have the account owner pass on) in plain words: the iPhone
   model and iOS version, each step 3 check passed or failed with what was
   seen, the two timings, and any email from Apple after upload.
2. If you can push to the repo: add a dated section to
   `docs/results-ios-build.md` with the same information, commit on
   `ios-testflight` and push. Leave out the team ID and anything else private
   to the account owner. Don't merge to `main`, and don't close #28.
