# Plan: a battery estimate before sending (US-13, #80)

2026-10-06. Ryan: "This needs to be accurate to a user's specific advice, not
just in general. Do some research on how to do this/if this is possible, and
if things look doable in a wise way, build a plan."

**Status: written down for later review. Not approved, nothing built.**

Read here as: the estimate should be specific to the user's own phone and to
the question they typed, not a general average. Not confirmed with Ryan.

## The story

US-13 (stretch, RC): while a question is typed but not yet sent, the app shows
a rough estimate of the battery answering it will use. #80 is done when battery
drain per answer is measured on the phone (field card vs model-written answer,
short vs long) and the app shows an estimate from that before sending.

## What the research says

- **Android lets an app measure its own drain.** `BatteryManager` reports
  instantaneous current (`BATTERY_PROPERTY_CURRENT_NOW`), a charge counter and
  the battery voltage. Current times voltage, sampled while an answer runs,
  gives the energy that answer used on that phone.
- **The readings are inconsistent between phone makers.** The documented unit
  is microamperes, but some firmware reports milliamperes, and the sign
  convention differs. Resolution and refresh rate depend on the fuel-gauge
  chip (one documented chip: current every 176 ms, charge counter in 500 µAh
  steps). Readings need sanity checks and a fallback.
- **Nothing can be measured while charging.** Current then is the charger's.
  Every measurement has to be taken off the cable (adb over Wi-Fi, or the app
  logging to a file).
- **iPhone has no equivalent.** An app sees only the battery level, in coarse
  steps. An iPhone estimate would come from time and a table, not from live
  measurement. Fred is not on an iPhone yet (#28).
- **Cost depends mostly on which kind of answer Fred gives.** On the Nothing
  Phone (3) a card answer takes about 1 s and a model-written answer 8-19 s
  (`docs/METRICS.md`). Studies of llama.cpp on phones find generating a token
  usually costs more energy than reading a prompt token, and that sustained
  inference heats the phone until the CPU slows (one reports the clock nearly
  halved by the 99th round).
- **One answer is a tiny slice of battery.** Rough arithmetic, not a
  measurement: 8-19 s at the 5-10 W studies report for CPU inference is
  40-190 J, against a battery of roughly 20 Wh: around a tenth of a percent
  for a written answer, and a small fraction of that for a card. "This will
  use X%" would read "under 1%" every time.

## What to show

Because a single answer is so small, the bare percentage the story asks for
says nothing. Proposed instead: the percentage to one decimal plus how many
more answers like it the current charge allows, e.g. "about 0.1% · roughly 80
more like this on your current charge". Both numbers come from the phone's own
measured drain and its current battery level. Wording to be settled after the
measurements (step 2). **Open question for Ryan.**

## Plan

1. **Quick check on the phone (about an hour, go/no-go).** Off the cable,
   read current, voltage and the charge counter while Fred gives a card answer
   and a written answer. Confirm the units and sign, that the refresh rate can
   time a 10 s answer, and that the size of the reading is plausible. If the
   Nothing Phone's readings are not usable, stop and report.
2. **Measure.** Energy for card vs written answers, short vs long, cool vs
   warm phone, and the idle draw with the screen on. Fit the simplest model
   that holds, starting from energy = power while the model runs × model time,
   with prompt and generated tokens as the finer split if it earns its place.
   This is #80's first "done when" and gives the shipped defaults.
3. **Built-in meter (Android).** A small native module that samples current
   and voltage during each real answer, subtracts the idle draw sampled just
   before, and keeps a running average for that phone, so the estimate follows
   the device, its battery wear and its temperature. Skipped while charging;
   readings outside a plausible range are thrown away and the defaults from
   step 2 used. `apps/mobile/android` is generated, so this is a local Expo
   module, not an edit there.
4. **Predict before sending.** When the user pauses typing, run the search
   step only (under a second, no generation) to tell whether this will be a
   card answer, a written answer or a decline, and keep the result so sending
   does not search again: the estimate must not cost the battery it reports
   on. The intent and understanding steps use the model and are not run early,
   so the prediction is of the likely path, not a guarantee. Measured on the
   desktop first, against the existing run files (which path each question
   actually took), before it goes near the phone.
5. **Show it.** One quiet line under the text box. No estimate until the
   pause; none while Fred is answering.
6. **Check it is honest.** Per answer: estimate against the meter's reading.
   Over a long unplugged session: the sum of the estimates plus idle draw
   against the real fall in the charge counter. Results doc, `metrics.json`,
   board.

## Limits and risks

- **Rough, not exact.** How long a written answer runs is not known until it
  is written, so the estimate is a range, widest for long answers.
- **Other phones are unverified.** Only the Nothing Phone is measured. Other
  Androids rely on the built-in meter and its sanity checks.
- **The early search has a cost** in battery and in code: `ask()` has to
  accept a search already done. If reuse is not clean, the estimate falls back
  to the phone's average written-answer cost with no early search.
- **No ground-truth meter.** Without a hardware power monitor the check in
  step 6 is the phone's fuel gauge against itself over a long session.
- **Needs the phone**, off the cable and on Wi-Fi, for steps 1, 2 and 6: a few
  hours in total.
- **Size.** A guess of two to three working days, for a stretch item due with
  the RC release (2026-12-09), competing with the A-KR2 work due 2026-10-12.

## Open questions for Ryan

- Go-ahead, or changes.
- "Percent plus answers left" in place of a bare percentage?
- Start now, or after the 2026-10-12 accuracy work?

## Sources

- Android power measurement, fuel-gauge properties: https://source.android.com/docs/core/power/device
- `BatteryManager` reference: https://developer.android.com/reference/android/os/BatteryManager
- Why battery apps show different readings (units, sign): https://androxus.com/blogs/why-battery-apps-show-different-readings
- Measuring Android energy use, Scott Logic (current × voltage at 1 s; not while charging): https://blog.scottlogic.com/2024/05/01/measuring-android-energy-use.html
- Understanding Large Language Models in Your Pockets (prefill vs decode energy, throttling): https://arxiv.org/html/2410.03613v5
- The Battery Price of edge AI (18 models, two phones): https://arxiv.org/abs/2609.11940
- PowerInfer-2 (llama.cpp 0.672 J/token on a phone): https://arxiv.org/pdf/2406.06282
- Apple, analyzing your app's battery use: https://developer.apple.com/documentation/xcode/analyzing-your-app-s-battery-use
- Apple developer forum, energy monitoring for iOS apps: https://developer.apple.com/forums/thread/777046
