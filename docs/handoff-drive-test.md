# Handoff: the drive test and where the project stands

Written 2026-10-08, the night before Ryan's trip to Cambria, CA. For Ryan on
the road, and for whoever (or whichever Claude session) picks this up next.

## Where the project stands

- **Alpha is done: 16 of 16 tickets closed.** Due 2026-10-19.
  - Knowledge packs: done.
  - Accuracy: 73.8% on the held-out questions against a 70% target. An A
    needs over 80%; Ryan chose on 2026-10-08 to bank the B.
  - Speed: 15.3 s mean on the phone against a 20 s target.
- **Beta is next, due 2026-11-16.** It is about location. Open tickets:
  - #20 the drive test (this note).
  - #77 Fred says how far and which way to signal. Not built; waits until
    after the trip.
  - #152, #100, #112 conversation quality: wrong card for some plain
    statements and follow-ups. They share a cause, how an unsure but right
    card pick is used.
  - #27 test on an older phone. Needs a second device.
  - #21, #23 accuracy. Parked with the B.
- **Merged on 2026-10-08:** #175 (follow-up replies stay on the right card;
  "the rangers carried him out" is no longer an emergency) and #176 (Fred
  declines dose questions on purpose; card matcher retrained). Write-ups:
  `results-follow-up-replies.md`, `results-card-matcher-2.md`.

## The drive test (#20)

One trip checks three goals:

| Goal | What is checked | How |
|---|---|---|
| B-KR1 | Fred knows where you are and shows it on the map | the recorded track, and map screenshots against where you really were |
| B-KR2 | Fred's answers fit where you are | location questions asked with WiFi off |
| B-KR3 | The shaded signal zones are right, within 2 km for an A | real signal bars against the coverage map |

### On the phone already

- California map, terrain and signal coverage; carrier set to T-Mobile.
- All knowledge packs, including California plants and animals.
- A field-test build from the branch `drive-live-position` (installed
  2026-10-09): the screen stays on while recording, and the position on the
  map and in answers follows you while recording. Before this the position
  watch stopped when the phone locked, and the dot moved only on a tap.

### On the road

1. **Start recording:** open the map, long-press the location button. It
   says "Recording…". Long-press again to stop; it then shows a summary.
2. **Keep Fred open on screen and the phone on a charger.** The screen stays
   on by itself. If you switch apps, come back to Fred.
3. **Start a fresh recording each day.** Each one is its own file, saved
   reading by reading, so a flat battery or a crash loses nothing already
   written.
4. **At stops in different kinds of place** (town, highway pullout, coast,
   canyon or forest; five or more over the trip):
   - screenshot Fred's map (while recording it follows you by itself; with
     no recording running, tap the location button first), and note where
     you really are (a pin in another
     maps app, or a named landmark);
   - with WiFi off, ask one or two questions that depend on the place ("what
     snakes are around here?", "what plants should I avoid here?") and
     screenshot the answers;
   - screenshot the coverage map and note your real signal bars.
5. **When you lose signal or get it back, note the time.** The time is
   enough; it is matched to the track afterwards.
6. **One stretch in airplane mode,** fifteen minutes or so with the recorder
   running, to show GPS holds with no signal.

The minimum that still makes the trip count: the recorder running, and at
each stop a map screenshot and a note of the signal bars.

**Do not uninstall Fred or clear its data during the trip.** The recordings
live inside the app.

### Afterwards

Plug the phone in at the desktop. The tracks are pulled with:

```bash
adb shell run-as dev.fred.app ls files            # the bkr1-<date>-<time>.csv files
adb exec-out run-as dev.fred.app cat files/bkr1-2026-10-09-091500.csv > bkr1-2026-10-09-091500.csv
```

Screenshots are in the phone's own Pictures/Screenshots folder
(`adb pull /sdcard/Pictures/Screenshots`). Then: compare track and
screenshots against the true places, grade the three goals on the bands in
README §07, write `docs/results-drive-test.md`, close #20.

## Checking in from another machine

Not needed, and limited in what it can do. The other machine has none of the
models, packs, Android toolchain or run history, so it cannot build the app
or run the test sets.

What it can usefully do:
- **Back up the recordings** each evening with the two `adb` commands above.
  This needs only `adb` (Android platform-tools) and a USB cable.
- **Read and plan:** clone the repo, read this note and the write-ups, look
  at the board, file tickets for anything odd seen on the road.

If something in the app breaks on the trip, note what happened and when, and
keep recording. Do not try to rebuild from the other machine.

## Connecting the phone to WSL

The phone reaches WSL through `usbipd-win`, which hands a Windows USB device
to Linux.

On the phone, once: Settings > About phone > tap "Build number" seven times,
then Settings > System > Developer options > turn on "USB debugging".

In Windows PowerShell, as administrator:

```powershell
winget install usbipd          # once per machine
usbipd list                    # find the phone's BUSID, e.g. 2-4
usbipd bind --busid 2-4        # once per device
usbipd attach --wsl --busid 2-4
```

In WSL:

```bash
sudo apt install adb           # once; the desktop also has ~/toolchain/platform-tools/adb
adb devices                    # the phone asks "Allow USB debugging?": tap Allow
```

`adb devices` should list `000463575000316  device`.

Things that go wrong:
- **"unauthorized":** the prompt on the phone was not accepted. Unplug, plug
  back in, tap Allow.
- **Nothing listed:** run `usbipd attach` again. It has to be repeated after
  every unplug, and after the phone or Windows sleeps.
- **Large transfers stall** over this link. Use `tools/eval/install-apk.sh`
  to install a build; it sends the file in checked pieces.

## For the next Claude session

- Run notes and standing instructions are in the memory folder
  (`MEMORY.md`); eval and sweep scripts are in `~/fred-runs/`.
- The build on the phone was made from `drive-live-position` with
  `tools/eval/build-apk.sh --field-test`.
- Never run `expo prebuild` without backing up `apps/mobile/android/` first.
