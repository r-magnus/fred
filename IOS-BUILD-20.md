# For the Mac: iOS build 20 (usage counts; same code as Android 0.2.0-5)

Written 2026-11-22 on the Linux machine. Ticket #285. Android 0.2.0-5 is
built from the same commit.

## What to build

**`main` at `c64a830`** (PR #287). Build from that exact commit, so iOS and
Android match.

## What changed since build 19 (`4208f7f`)

JavaScript only. **No native changes:** `package.json`, `package-lock.json`,
plugins and pods are the same as build 19. The only `app.json` change is
Android's `versionCode` (4 → 5), which iOS ignores.

- **Builds 18 and 19 are now on `main`** (PR #284), so nothing from them is
  lost.
- **Usage counts (#285).** Fred now notes a few events, at most once a day
  each, and sends them to the same Worker as ratings (`POST /usage`):
  - setup: `setup_started`, `guides_ready`, `area_ready`, `setup_done`, or
    `setup_found` on a phone that was set up before counting began (every
    current tester, after this update);
  - `model_ready` or `model_failed`;
  - `open` and `ask` (only that a question was asked that day, never the
    question).

  Each row is the event, the day, the app version, the OS, and a random
  install ID that Fred makes the first time (`usage.json`, in the iCloud
  keep-list). It is never sent with a rating. Code:
  `apps/mobile/src/usage-log.ts` (rules) and `src/usage.ts` (file and send).
- **Privacy policy updated** to say so, live at
  `https://r-magnus.github.io/fred/privacy/` (effective 23 November 2026).

## Before external testers get it: App Privacy in App Store Connect

The account holder should update **App Privacy** to match, because Fred now
collects something besides ratings:

- **Usage Data › Product Interaction:** collected, *not* linked to the
  user's identity, *not* used for tracking. Purpose: Analytics.
- **Diagnostics › Other Diagnostic Data** (`model_failed`): same answers.
- The random install ID: Apple's categories don't fit it cleanly. It is made
  by the app, not read from the device, and isn't tied to a person. Read the
  "Identifiers" wording in App Store Connect. If it asks about an ID that lets
  data from one install be grouped, list it as **Identifiers › Device ID**,
  not linked to identity and not used for tracking. When unsure, declaring
  more is the safe side.
- No App Tracking Transparency prompt is needed: nothing is shared with
  other companies or used across apps.

## Build

From `apps/mobile`:

```sh
git fetch origin && git checkout c64a830
npm install
eas build --platform ios --profile production --auto-submit
```

Same as build 17: answer **no** to every Apple login prompt. The version stays
**0.2.0**. The NuGet onnxruntime-c plugin is still in place.

## Check on Ryan's iPhone

Install over build 19 from TestFlight, so the guides stay.

1. **Fred still opens set up** and answers "How do I treat a bee sting?".
2. **The counts arrive.** Wait a minute with signal, then on any machine
   logged in to Ryan's Cloudflare account (`tools/feedback-worker`):

   ```sh
   npx wrangler@4 d1 execute fred-feedback --remote --command \
     "SELECT install_id, event, day, platform FROM usage WHERE platform LIKE 'ios%' ORDER BY received_at DESC LIMIT 10"
   ```

   Expect `setup_found`, `open`, `model_ready` and `ask` from one
   `install_id`, with platform `ios …`.
3. **Ratings still send:** thumbs up on one reply.

## Then

- Add build 20 to the external tester group.
- Note the build number and the check in `docs/results-ios-build.md`.
