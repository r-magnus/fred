# A battery estimate before sending: results

2026-10-07. US-13, #80. Plan: `plan-battery-estimate.md`. Phone logs and the
prediction check: `battery-estimate/`.

**Short version: on the Nothing Phone (3) a written answer costs about 135
joules, roughly 0.2% of a full battery, and a quick reply (a field card,
small talk, a decline) about 10 joules, 0.015%. The app now measures every
answer on the phone it runs on, and once typing pauses it shows one line
under the text box, such as "A written answer: about 0.2% of battery ·
roughly 400 more like it on this charge". The iPhone half is written but has
never been compiled or run.**

## What was built

- **A meter** (`apps/mobile/modules/fred-energy`, a local native module).
  Android reads the battery's current and voltage every 0.2 s while an
  answer runs. The iPhone version reads the app's own processor-energy
  counter before and after.
- **The arithmetic** (`packages/rag-core/src/energy.ts`, 9 tests): energy
  from the readings with the idle draw taken off, a running average per kind
  of reply kept on the phone (`Documents/energy.json`), the battery's size
  (from the charge counter on Android, a table by model on iPhone), and the
  line shown.
- **A prediction** (`predictCost`): while the hiker is still typing, the
  search alone (no model) says whether the reply will be written or quick.
  The search vector is kept, so sending the same words does not make it
  again.
- **The line** under the text box, 0.8 s after typing pauses, never while
  Fred is answering.
- Nothing is learned while charging on Android (the current is then the
  charger's), from an answer that was stopped, or from a reading no phone
  could give.

## Step 1: can the phone be read? Yes

Plugged in, one card and one written answer: current comes in microamperes,
positive while charging and negative while discharging, with 67 readings in a
13.5 s answer. Reading the battery files directly over adb is refused; the
app's own `BatteryManager` call works.

## Step 2: what an answer costs

Unplugged, over Wi-Fi debugging, screen on, 16 questions three times
(`battery-estimate/phone-run-{2,3,4}.txt`). A first attempt gave nothing: the
app was not ready within three minutes of the cable coming out.

| Kind of reply | n | Mean | Range | Of a full battery |
|---|---:|---:|---:|---:|
| Written answer | 21 | **135 J** | 92-194 J | about 0.19% |
| Quick reply | 27 | **10 J** | 5-17 J | about 0.015% |

- The phone drew 0.9-1.4 W idle with the screen on (rising as it warmed
  from 29 to 39 °C) and 9-13 W while the model wrote.
- A full battery by the phone's own counter: about 70.6 kJ (5.09 Ah).
- These are the shipped starting figures; each phone then replaces them with
  its own.
- Not split by prompt and answer length: the simple per-kind average was
  within the range the line claims ("about").

## Step 4: the prediction

| | Right |
|---|---:|
| Desktop, every recorded reply in 19 sets (847) | 750 (88.5%) |
| Phone, three runs of 16 | 45 of 48 |

On the desktop, 74 of 240 written answers were predicted quick and 23 quick
replies predicted written (`battery-estimate/prediction-check.txt`). The
prediction sees the message alone: not the conversation, and not the model's
reading of what the hiker wants. A wrong prediction shows the other kind's
figure, a factor of about 13.

## Step 6: is it honest?

- **Per answer.** After the first answers taught the average, the estimate
  for a written answer was off by 14-22% on average per run, 42% at worst
  (expected 134 J, measured 194 J).
- **Over a session.** Runs 3 and 4, about 3.5 minutes each: the charge
  counter fell 88 and 92 mAh, about 1,270 and 1,320 J. The meter's total for
  the answers was 1,128 and 1,222 J, with about 70 s per run it does not
  cover (starting the app, loading the model, the estimate itself). Over the
  three runs the battery level fell 6 points, about 4,200 J; the counter
  about 4,000 J; the meter 3,560 J for the answers alone. The three agree to
  within about 15%.
- In run 2 the counter lagged (it read about 1,050 J against the meter's
  1,207 J); over the longer span it caught up.
- There is no hardware power monitor, so this is the phone's fuel gauge
  against itself.

## The iPhone

`modules/fred-energy/ios` reads `task_info(TASK_POWER_INFO_V2).task_energy`
(the app's own processor energy, nanojoules) and the battery level.
**Not compiled, not run**: this machine has no Xcode, and the simulator
reports no energy. To test on a real iPhone once Fred runs on one (#28):

0. Switch it on. So that untested Swift cannot break the iOS build, the
   module is linked into Android builds only. In
   `apps/mobile/modules/fred-energy/expo-module.config.json` set
   `"platforms": ["apple", "android"]` and add
   `"apple": { "modules": ["FredEnergyModule"] }`, then `pod install`.
   Until then the iPhone shows no estimate.
1. Build. If the Swift does not compile, the module is the first suspect.
2. Ask a card question and a written one. The log line
   `[fred] energy kind=... joules=...` should show a few joules for the card
   and clearly more for the written answer. `joules=none` means the counter
   gave nothing: the line then uses the shipped figures.
3. Compare with Xcode's Power Profiler recorded on the phone.

Known gaps: the counter covers the processor only, not the screen; the
battery sizes are published figures by model and ignore wear; the level
comes in 5% steps, so "answers left" is worded "very roughly". The
time-based fallback in the plan (seconds × watts per model) is not built:
with no reading the iPhone shows the Android-measured figures.

## Open

- Only one phone is measured.
- The estimate is not shown for a follow-up differently from a first
  message, though a follow-up's path depends on the conversation.
- A cool phone and a warm one were not measured apart; the phone warmed
  through the runs and the per-answer cost did not move with it.
