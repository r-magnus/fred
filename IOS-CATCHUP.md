# For the Mac: build main for iPhone and test it on Ryan's iPhone

Written 2026-11-19 on the Linux machine. This is **step 1 of
RELEASE-HANDOFF.md §5** ("Build on the Xcode 27 image and test on Ryan's
iPhone as an internal tester"). Everything else in §5 now waits on it.

## What changed since build 12 (`2b4fcec`, 2026-11-18)

All merged to `main` in PR #249 (`d3b819d`):

- **Rating replies (#247).** Thumbs up/down under each finished reply; a thumbs
  down opens "What can Fred do better?". Ratings are written to
  `feedback-outbox.json` on the phone and sent to a Cloudflare Worker,
  `https://fred-feedback.ryan-magnuson.workers.dev/feedback`. A rating leaves
  the phone only once the server says `200`. The server code and the queries
  for reading ratings are in `tools/feedback-worker/README.md`.
- **Beta notice (#248).** The last setup page has a notice with an agreement
  tick, and Start waits for it. "Skip setup" lands on that page too. A phone
  set up before the notice existed sees it once, on its own screen.
- **Deep thinking hidden (#21).** `DEEP_OFFERED = false` in `App.tsx`.
- **Privacy policy** at `https://r-magnus.github.io/fred/privacy/` (source in
  `site/`). This is the URL App Store Connect asks for.

**No native changes:** `package.json`, `package-lock.json` and `app.json` are
the same as build 12. It's JavaScript only, so the Xcode 27 image is the only
new risk.

All of it was checked on Android (Ryan's Nothing phone). **None of it has run
on iOS.**

## Build

From `apps/mobile` on an up-to-date `main`:

```sh
git checkout main && git pull
npm install
eas build --platform ios --profile production --auto-submit
```

- Answer **no** to every Apple login prompt. The signing credentials and the
  App Store Connect API key are stored on Expo (project
  `@fred-model-team/fred`), and Ryan's Apple ID is not on the Apple team.
- `autoIncrement` is on, so this becomes build 13 or later.
- This is the **first build on `macos-tahoe-26.6-xcode-27.2`** (#245). If the
  image fails, record the error. Don't switch to `latest`, which moves, and
  don't remove `ios.enableSceneSupport`: Xcode 27 won't launch the app without it.

## Get it onto Ryan's iPhone

Internal testing needs no Apple review. In App Store Connect, the **account
holder** (not Ryan) must:

1. Add Ryan under **Users and Access** (the Developer or Marketing role is
   enough), if he isn't there yet.
2. In **TestFlight › Internal Testing**, create a group (e.g. "Team"), add
   Ryan, and add the new build once it shows "Ready to Submit" or "Testing".

Ryan accepts the email invite, installs **TestFlight** from the App Store, and
installs Fred from there.

## Check on the iPhone, in this order

Screenshot each step. Start with Fred freshly installed, not over an old build.

1. **Setup:** the welcome page, then the guides download (~1.45 GB on Wi-Fi)
   and pick a state. Note how long the download takes and whether it survives
   the screen locking.
2. **Beta notice:** on the last page, Start is greyed out until the box is
   ticked. Then go back to the welcome page and use "Skip setup": it should
   land on the notice, not in the chat.
3. **A question is answered:** e.g. "How do I treat a bee sting?" (op-sqlite
   FTS5, #243).
4. **Rating:** thumbs up on one reply. On another, thumbs down, type a comment,
   and tap Send **once with the keyboard up**. Check:
   - the box scrolls fully into view when it opens, and again when the keyboard comes up;
   - Send works on the first tap;
   - the keyboard goes away after Send;
   - both ratings arrive. Query them from any machine logged in to Ryan's
     Cloudflare account (`tools/feedback-worker/README.md › Read the ratings`),
     or in the Cloudflare dashboard (Storage & Databases › D1 › fred-feedback).
     The `platform` column should read `ios …`.
5. **No signal:** turn on airplane mode, thumbs-down a reply, close Fred
   completely, turn airplane mode off, then open Fred again. The rating should
   arrive within a few seconds of opening.
6. **No deep thinking:** while you type a question, nothing about "Deep
   thinking" should appear above the Ask box.
7. **Still from build 12's list:** "i’m lost" opens the map (curly apostrophe,
   #243); the location prompt shows Fred's own wording; an offline route plans;
   memory holds (no crash on a long answer) with the increased-memory
   entitlements.

Delete the test ratings afterwards:
`npx wrangler@4 d1 execute fred-feedback --remote --command "DELETE FROM feedback WHERE comment LIKE 'TEST%'"`
(start test comments with "TEST" so this catches them).

## Record

Add a section **"Xcode 27 build on a real iPhone"** to
`docs/results-ios-build.md`. Include the build number, the commit, the iPhone
model and iOS version, the result of each step above with screenshots, and
anything that differed from Android. Then tick "Xcode 27 EAS build checked on
Ryan's iPhone" under "Done looks like" in `RELEASE-HANDOFF.md`, open a PR, and
merge it.

If something only breaks on iOS, fix it on a branch off `main`, rebuild, and
note the fix in the same results section.
