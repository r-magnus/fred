# From the main machine: answers for the Mac

Written 2026-11-20 on the Linux machine, in reply to `MAC-SYNC.md` (main was
at `e630092`; that note is in git history there). Everything in it checked out
except one detail about the core download, corrected under Q4 below.

## Short version

- **Merge #252.** The keep-list is complete.
- **Build 15:** wait for build 14's approval and do the iPhone checks first.
  Then build #252 plus any fixes the checks turn up, and nothing else.
- **`fred-energy` on iOS:** leave it out of build 15.
- **The core download tick is right.** But it wasn't built from
  `~/fred-packs-g-all`, and `RELEASE-HANDOFF.md` was wrong to say it must be
  (fixed in this PR).
- **Old notes:** `IOS-HANDOFF.md`, `docs/testflight-draft.md` and
  `MAC-SYNC.md` are deleted in this PR. `IOS-SESSION.md` stays because
  `docs/results-ios-build.md` cites it.
- **Nothing on main changes the iPhone checks.** No app code has changed
  since `53f8714` (build 14).

## Answers

### 1. #252: merge as is? Yes.

I went through every file the app writes to Documents on `main`:

| File | What it is | Backed up? |
| --- | --- | --- |
| `chats.json`, `feedback-outbox.json` | the hiker's chats, ratings not sent yet | yes |
| `setup.json`, `agreement.json`, `theme.json`, `carrier.json`, `energy.json` | small settings | yes |
| `regions-<ST>.json`, `coverage-*`, map `.pmtiles`, route files | downloads | no |
| models, `packs/`, encoder files, `lane-*.session` | downloads | no |
| drive-test recordings (`src/location.ts`) | locations, test only | no, and that's right |
| `devhooks*` | desk test switches | skipped |

Nothing the hiker makes or chooses is missing. Saved routes and favourite
places don't exist. Which maps are on the phone is worked out from the files
themselves, so after a restore the phone simply has no maps until they're
downloaded again.

**What a restore looks like,** checked in the code: `setup.json` comes back
but the guides don't. The wizard isn't shown, so the engine fails to load, and
the loading screen shows **"Set up Fred"** because `guidesOnPhone()` is false
(`App.tsx` around line 707). That's an acceptable path for a beta. If it's
cheap, check it on the simulator before merging: delete the model and
`packs/`, keep `setup.json`, launch, and expect the button.

Two small points, neither one blocks the merge:

- A `.partial` file at the top level isn't marked until the piece it belongs
  to finishes (at most about 100 MB, because big files come in pieces). A
  backup that starts mid-download could pick it up once. That's harmless.
- If a pack update deletes and re-creates `packs/`, the new folder is unmarked
  until the download's next finished file. `downloadBundle` already calls
  `keepDownloadsOutOfBackup()` after each file, so this is covered.

Merge it yourself (merge commit, per the usual rule) once its tests pass.

### 2. Build 15: when? Your plan is right, with the iPhone checks first.

The order:

1. Ryan installs build 14 from **Team (Expo)** and runs the checks in
   `IOS-CATCHUP.md`. These are the real gate: if something breaks only on iOS,
   the fix should go into build 15.
2. Build 14 is approved and the public link goes live. Hold off sharing it
   until step 1 has passed.
3. Build 15 (still 0.2.0) gets #252 plus any fixes from step 1, then goes to
   "Beta Testers". A later build of the same version usually skips full
   review.

Keep build 15 small: one new native module (`fred-backup`) is enough new risk
for one build. **Leave Expo at 57.0.24.** A patch bump changes native code, so
it gets its own build later, not one going to strangers.

### 3. `fred-energy` on iOS: not in build 15.

The iPhone shows no battery line at all right now, which is harmless.
Untested Swift that crashes at launch is not. The simulator reports no energy,
so the only real test is a real iPhone (`docs/results-battery-estimate.md` ›
"The iPhone" has the steps). After the first round of testers:

- Link it on a branch (`"platforms": ["apple", "android"]` and
  `"apple": { "modules": ["FredEnergyModule"] }`) and confirm it compiles.
- Ship it to **Team (Expo) only** and check the `[fred] energy` log line on
  Ryan's iPhone.
- Only then put it in an external build.

If you'd like to confirm it compiles now, on a branch with nothing merged,
that's fine and useful.

### 4. The section 2 tick: right, but the reasoning needed fixing.

I compared every core pack file in release `core-2026-11` with the folders
here:

- 8 of the 10 core packs match `~/fred-packs-g-all` byte for byte.
- **Field cards are 0.10.0** (built 2026-11-14 04:25 UTC, matching
  `~/fred-runs/cards214/final`). `g-all` has 0.8.0.
- **Hazards are 1.2.0** (the wildfire pages). `g-all` has 1.1.0.

So the download has the newest packs, which is what "shipped" should mean.
`g-all` is the older 2026-10-07 set behind the 73.8% score, kept only so that
run can be repeated. `RELEASE-HANDOFF.md` said "every bundle build must use
`g-all`", which was wrong. It's corrected in this PR.

**One known gap, not urgent:** main's field cards are now **0.11.0**
(`07d9f08`, after the release). The card text and the search data are
byte-identical to 0.10.0. Only the licence credit changed: spine and pelvis no
longer quote WHO. Testers get the same answers either way. Rebuild the core
download with 0.11.0 the next time it's rebuilt for any reason. That matters
only for a paid release, and the WHO pack still ships in a free one.

The two #198 items (resume after a dropped download, and a fresh install on
the Nothing phone) are still open. They're Android checks, so they belong to
this machine, not the Mac.

### 5. Old notes

Done in this PR: deleted `IOS-HANDOFF.md`, `docs/testflight-draft.md` (Ryan's
own wording is in App Store Connect) and `MAC-SYNC.md` (answered here). Kept
`IOS-SESSION.md`, because `docs/results-ios-build.md` cites it, and
`IOS-CATCHUP.md`, because its checks haven't been done yet. Delete
`IOS-CATCHUP.md` and this file once the results are in
`docs/results-ios-build.md`.

### 6. What's on main, or on this machine, that the Mac doesn't know

None of it changes the iPhone checks:

- **No app code since build 14.** Since `53f8714` there have only been notes
  (#251, #253, this PR).
- **Regional map downloads (#224) are only in the UX test app**, not on main.
  The iPhone offers whole-state maps only. Publishing regions waits on Ryan.
- **Deep thinking stays hidden** (`DEEP_OFFERED = false`).
- **Next on this machine, once the iPhone is sorted:** accuracy work (#23,
  #21, #152). Two research write-ups are drafted locally, not committed and
  with no code yet: "Fewer false declines in Fred" and "Safe conversation
  understanding" (moving the conversation's memory out of the model). The
  current accuracy (73.8%) is accepted for now.
- **Parked ideas, not to build:** a "Call 911" button, and reduce-motion for
  the drawer.
- **Ratings:** test ratings from the iPhone should start with "TEST", so the
  delete command in `IOS-CATCHUP.md` catches them.

## For the next note from the Mac

Reply with the iPhone results (in `docs/results-ios-build.md`, as
`IOS-CATCHUP.md` says), say whether #252 was merged, and give build 15's
number and status.
