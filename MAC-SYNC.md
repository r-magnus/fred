# From the Mac: where iOS stands, and questions for the main machine

Written 2026-11-20 on the Mac, in reply to `IOS-CATCHUP.md`. Answer the
questions at the end in a note back (or edit this file), and correct anything
here that's wrong. Main was at `403144f` when this was written.

## What the Mac did

1. **Built build 14 from `main`.** `53f8714`, version 0.2.0 (14), started
   2026-11-19 with `eas build --platform ios --profile production --auto-submit`.
   - EAS build `157fba63-66fa-4062-af75-bf37ca1d14b1`.
   - **First build on `macos-tahoe-26.6-xcode-27.2`.** The build log shows
     `Xcode 27.2` and `iPhoneOS27.2.sdk`, and `** ARCHIVE SUCCEEDED **`, so
     Apple's April 2027 SDK rule is met.
   - It took 2.5 minutes, which seemed short, but EAS restored a cache. No
     errors.
   - Uploaded by EAS submit `7c69bb80-2a86-432a-8340-937dddd69fdf`.
   - No prompts and no Apple login needed: `--non-interactive` worked with
     the credentials and API key stored on Expo.
2. **Build 14 is in external review, submitted by Ryan.**
   - Ryan filled in Test Information (beta description, feedback email,
     review contact) in his own words.
   - He created the external group **"Beta Testers"** and added build 14: it
     shows **Waiting for Review**.
   - Build 14 is also in the internal group **"Team (Expo)"**.
   - Ryan says he now manages TestFlight himself. Builds 13 and 4 show
     "Ready to Submit" (internal only, never sent for review). That's
     expected.
   - The public link has been created or offered. It isn't shared yet; that
     waits for approval.
3. **PR #251 (merged):** `RELEASE-HANDOFF.md` §5 no longer says section 2
   blocks external testing. `index.json` on `fred-maps` has listed `core`
   since 2026-11-14 (release `core-2026-11`, 1,454,566,135 B). I ticked the
   "Core bundle built … published" item under Done looks like. I also added
   `docs/testflight-draft.md`: draft Test Information and review notes. Ryan
   wrote his own, so it may be out of date.
4. **PR #252 (open, not merged):** downloads stay out of the iPhone's iCloud
   backup (guideline 2.23).
   - `modules/fred-backup` is a new iOS-only Expo module. It sets
     `isExcludedFromBackup` on a path.
   - `src/backup.ts` marks everything in Documents except a keep-list in
     `src/backup-list.ts`: `chats.json`, `feedback-outbox.json`, `setup.json`,
     `agreement.json`, `theme.json`, `carrier.json`, `energy.json`. Files
     named `devhooks*` are also skipped.
   - It runs at launch and after each finished download file or piece.
   - Checked on the FredTest simulator (iOS 27). Models, `packs/`, maps,
     contours, encoder files and `lane-*.session` were excluded; the files on
     the keep-list were not.
   - Typecheck passes, and the tests were 487 passed, 0 failed, 1 skipped.
     The simulator build succeeded with no warnings from the new code.
   - **Not in build 14.** Build 14 testers still back up the 1.45 GB.

## Not done yet

- **The iPhone checks in `IOS-CATCHUP.md`.** Ryan can install build 14 from
  Team (Expo) now. Nothing has been recorded in `docs/results-ios-build.md`
  yet.
- **Build 15.** It's waiting on #252, and on build 14 being approved (see Q2).

## Found on the way

- **`fred-energy` is still linked into Android builds only.** Its
  `expo-module.config.json` lists only `android`, on purpose since `4ed6d4e`
  ("until the iPhone module has been built"). So the iPhone shows no battery
  estimate from the module at all, which is probably the "battery estimate is
  off on iPhone" item. The Mac can now compile it (the same setup that built
  `fred-backup`).
- `expo start` offers 57.0.24 → 57.0.33. I didn't touch it.
- `IOS-HANDOFF.md` and `IOS-SESSION.md` (September, simulator only) are
  replaced by `IOS-CATCHUP.md` and this note. They're still in the repo
  root.

## State of the Mac

- `apps/mobile/ios/` was regenerated with `expo prebuild` and `pod install`
  for the simulator check. It's gitignored.
- FredTest (iPhone 18 Pro sim, iOS 27) now has a **Debug** build of the #252
  branch installed. Its Documents (models, packs, CA map) are unchanged
  apart from the backup marks.
- Logged in to EAS as `rmagnus`, Admin on `fred-model-team`.

## Questions for the main machine

1. **#252: merge as is?** Is the keep-list missing any file the hiker makes or
   chooses that should survive an iCloud restore?
   - Drive-test recordings (`src/location.ts`) are excluded on purpose. They
     hold locations, and leaving them out of iCloud seems the safer
     default.
   - `regions-<ST>.json` is treated as a download.
2. **Build 15: when?** My plan is to merge #252, wait for build 14's approval,
   then build 15 (still 0.2.0) and add it to "Beta Testers". A later build of
   the same version usually skips full review. Is there anything else that
   should go in it? Say if you'd rather build 15 right away.
3. **`fred-energy` on iOS:** should the Mac link it (add `apple` to its config),
   compile it, and include it in build 15? Or leave it off until after the
   first round of testers?
4. **The section 2 tick:** is "Core bundle built from the shipped packs and
   published" right to tick? I only checked that `index.json` lists `core`;
   I didn't check which packs it was built from. The two #198 items
   (resume after interruption, a fresh Nothing phone) are still open.
5. **Old notes:** delete `IOS-HANDOFF.md`, `IOS-SESSION.md` and
   `docs/testflight-draft.md`, or keep them?
6. **Anything on main the Mac doesn't know about** that changes the iPhone
   checks in `IOS-CATCHUP.md`?
