# For the Mac: iOS build 17 (same code as Android 0.2.0-4)

Written 2026-11-22 on the Linux machine. Ticket #278. This replaces build 16
for the tester links. Android 0.2.0-4 is built from the same commit.

## What to build

**`main` at `1f6cbfa`** (PR #279). Build from that exact commit, so iOS and
Android match. If `main` has moved on, check out `1f6cbfa` rather than the tip.

## What changed since build 16 (`4f78756`)

All JavaScript. **No native changes:** `package.json`, `package-lock.json`,
plugins and pods are the same as build 16. The only `app.json` change is
Android's `versionCode` (3 → 4), which iOS ignores.

- **Map pass (UX iteration 9)**, from `ux-map-cleanup`:
  - teardrop pin;
  - compact route card: label, time · distance · climb, warning tags, Start
    and Details, with the full text behind Details;
  - one large growing tree in the middle of the map while it finds you, in
    place of the dots, the button's small tree and the badge;
  - "Finding you" is said once, on the card; screen readers hear "Found you";
  - route numbers wrap between parts, never leaving a lone dot;
  - the camera stops following you only for a real finger drag.
- **Answer fixes:**
  - #268: a card the matcher is sure of, found by the search, is shown on a
    first situation message;
  - #240: the card just shown isn't shown whole again when the next message
    moves on, except for a danger that lasts (neck or head injury, altitude,
    bear, …).
- **The NuGet onnxruntime-c plugin** is now on `main`
  (`apps/mobile/plugins/with-onnxruntime-nuget.js`), not only on the
  `ios-onnxruntime-nuget` branch. Nothing new for the Mac: it's what build 16
  used. Leave it in until download.onnxruntime.ai works again.

## Build

From `apps/mobile`:

```sh
git fetch origin && git checkout 1f6cbfa
npm install
eas build --platform ios --profile production --auto-submit
```

- Answer **no** to every Apple login prompt, as before. The credentials are
  on Expo.
- `autoIncrement` makes this build 17 or later. The version stays **0.2.0**,
  so external testing usually skips a full Beta App Review.
- If `Install pods` fails on onnxruntime-c again, check that the Podfile log
  shows the `# fred: onnxruntime-c from NuGet` line. If it doesn't, the
  plugin didn't run: check that `app.json` lists it under `plugins`.

## Check on Ryan's iPhone (short; build 16's full checks passed)

Install over build 16 from TestFlight (**Team (Expo)** group) so the guides
stay. Screenshot each step.

1. **Still set up:** Fred opens to the chat, not the wizard, and the guides
   are still there.
2. **An answer:** "How do I treat a bee sting?" gets a proper answer.
3. **Follow-up (#240):** ask "I twisted my ankle", then "how far is the
   nearest town?" The ankle card shouldn't be shown whole again.
4. **Map:**
   - open the map: the growing tree shows while it finds you, then "Found
     you";
   - long-press to drop a pin: the pin is a teardrop;
   - route to it: the route card is short (time · distance · climb, Start,
     Details), and Details opens the full text;
   - drag the map: it stops following you; re-centre brings it back.
5. **A rating** still sends (thumbs up on one reply).

## Then

- Add build 17 to the external tester group. Remove build 16 from it, or
  leave it in: testers are offered the newest build either way.
- Note the build number and anything odd in `docs/results-ios-build.md`.
- Ryan sends the tester links.
