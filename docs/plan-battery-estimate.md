# Plan: a battery estimate before sending (US-13, #80)

2026-10-06. Ryan: "This needs to be accurate to a user's specific advice, not
just in general. Do some research on how to do this/if this is possible, and
if things look doable in a wise way, build a plan."

**Status: approved by Ryan 2026-10-07 and built for Android; an iPhone build is written beside it and not yet run. Results: `results-battery-estimate.md`.**

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
- **iPhone: no battery current, but the app can read its own CPU energy.**
  Corrected 2026-10-07; this line used to say "iPhone has no equivalent".
  See "iPhone" below.
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

## iPhone (research, 2026-10-07)

Asked for by Ryan after the first version of this note wrote the iPhone off.
Nothing here has been run: Fred has only launched on the simulator (#28), and
the simulator reports no energy.

**What an iPhone app can and cannot see**

| Source | What it gives | Use for the estimate |
|---|---|---|
| `UIDevice.batteryLevel` | The charge, rounded to 5% steps since iOS 17. Apple: "expected and intended behavior." | Too coarse to measure an answer (about 0.1%). Good enough for "answers left on this charge". |
| Battery current or voltage | Not available to an app. No equivalent of Android's `BatteryManager`. | None. |
| The kernel's energy counter for the app's own threads | Energy in nanojoules, kept per thread on Apple chips (A14 and later tested) and readable for the app's own process without special permission: `task_info(TASK_POWER_INFO_V2).task_energy`, or per thread through `proc_pidinfo(PROC_PIDTHREADCOUNTS)`. | **The iPhone's meter.** Read before and after an answer; the difference is that answer's CPU energy. |
| MetricKit | Daily totals of CPU time and similar, delivered about once a day. | Too slow and too coarse. A cross-check at best. |
| Xcode's Power Profiler (2025) | CPU, GPU, display and network "power impact" for the app, recorded on the phone itself from Developer settings, unplugged, for hours. | Development only: the reference to check our own numbers against. Not available inside a shipped app. |

**The energy counter, in more detail**

- It is an estimate the chip's power controller keeps (Apple's "digital power
  estimator"), not a current sensor. The open-source PowerMetricsKit package
  reads it on iOS and reports that with one app in the foreground, and the
  idle draw subtracted, it "correlate[s] well with wall power"; on a Mac it
  is "almost identical" to Apple's `powermetrics` tool.
- **It counts CPU work in the app's own threads only.** Not the screen, not
  the GPU, not work the kernel does on the app's behalf. Fred runs the model
  on the CPU (GPU offload is off, `device-pack.ts`), so the model's energy is
  the part it does count. The screen is the larger miss: it would be added
  from a fixed figure per second, or left out and the estimate described as
  "for the answer itself".
- **It is undocumented.** The structures are in the public part of Apple's
  open-source kernel headers, but Apple's developer support said of
  `task_energy` on iOS: "In the absence of detailed documentation, I think
  the only thing you can safely do is compare values between runs on the same
  hardware", and a second Apple engineer was "surprised to hear that this
  worked on iOS". So: usable, could change or go to zero in any iOS release,
  and not confirmed to pass App Store review. The per-thread route needs the
  header copied into the app, which is a larger review risk than `task_info`,
  a long-standing public call.
- Turning joules into a percentage needs the battery's capacity, which iOS
  does not report: a small table by iPhone model, and it ignores battery
  wear. The Android meter does not have this problem.

**What it would cost on an iPhone, roughly**

Published figures, none measured on Fred: about 0.7 J per generated token
for llama.cpp on a phone CPU (PowerInfer-2, an Android phone); one benchmark
on an iPhone 16 Pro reports about 0.15 J per token on the GPU, taken from
battery steps over 20 runs. A written answer of 100-150 tokens is then
15-100 J against roughly 45-60 kJ in an iPhone battery: 0.03% to 0.2%, the
same size as the Android arithmetic above. The "percent plus answers left"
display fits both platforms.

**In the plan:** each step of "Plan" below now has its iPhone part. One point
behind the fallback: Low Power Mode and a hot phone slow the chip, so an
answer takes longer at lower power. A meter read per answer follows that by
itself; a time-based fallback would not, and should say less when either is
on (`ProcessInfo.isLowPowerModeEnabled`, `thermalState`).

**Risks specific to iPhone**

- No real iPhone has run Fred yet, so every figure above is from other
  people's hardware and models.
- An undocumented counter in a shipped app: Apple could reject it or change
  it. The fallback keeps the feature alive either way.
- Whether an Expo app can call `task_info` from a small local module is
  untested; it is plain C, so it should.

## What to show

Because a single answer is so small, the bare percentage the story asks for
says nothing. Proposed instead: the percentage to one decimal plus how many
more answers like it the current charge allows, e.g. "about 0.1% · roughly 80
more like this on your current charge". Both numbers come from the phone's own
measured drain and its current battery level. Wording to be settled after the
measurements (step 2). **Open question for Ryan.**

## Plan

Updated 2026-10-07 to cover both platforms. Android can start now; every
iPhone step waits on Fred running on a real iPhone (#28).

1. **Quick check on the phone (about an hour each, go/no-go).**
   - *Android:* off the cable, read current, voltage and the charge counter
     while Fred gives a card answer and a written answer. Confirm the units
     and sign, that the refresh rate can time a 10 s answer, and that the
     size of the reading is plausible. If the Nothing Phone's readings are
     not usable, stop and report.
   - *iPhone:* read the app's own energy counter (`task_info`,
     `TASK_POWER_INFO_V2`) before and after a card answer and a written
     answer. Check it grows, that a written answer costs clearly more than a
     card, and that the size is plausible (tens of joules). If it reads zero
     or nonsense, the iPhone gets the time-based fallback in step 3 and no
     meter.
2. **Measure.** Energy for card vs written answers, short vs long, cool vs
   warm phone, and the idle draw with the screen on. Fit the simplest model
   that holds, starting from energy = power while the model runs × model
   time, with prompt and generated tokens as the finer split if it earns its
   place. This is #80's first "done when" and gives the shipped defaults.
   - *iPhone:* the same runs recorded with Xcode's Power Profiler on the
     phone, unplugged, to see how far the counter is from Apple's own figure
     and how much the screen adds; and a watts figure for the fallback.
3. **Built-in meter.** One small local Expo module per platform behind the
   same interface (start, stop, joules used, or "no reading"), keeping a
   running average for that phone so the estimate follows the device and its
   temperature. Readings outside a plausible range are thrown away and the
   defaults from step 2 used.
   - *Android:* samples current and voltage during each real answer and
     subtracts the idle draw sampled just before. Skipped while charging.
     `apps/mobile/android` is generated, so this is a local module, not an
     edit there.
   - *iPhone:* the energy counter read before and after each answer. It
     counts the processor only, so the screen is added from the step 2
     figure or left out and the line worded as "for the answer itself".
     Works while charging. **Fallback**, if the counter fails the check, is
     rejected in review or disappears in an iOS release: seconds the model
     ran × the measured watts for that iPhone model, reduced when Low Power
     Mode or a hot phone slows the chip.
   - Joules become a percentage from the battery's capacity: read from the
     system on Android, from a small table by model on iPhone (which ignores
     battery wear).
4. **Predict before sending.** When the user pauses typing, run the search
   step only (under a second, no generation) to tell whether this will be a
   card answer, a written answer or a decline, and keep the result so sending
   does not search again: the estimate must not cost the battery it reports
   on. The intent and understanding steps use the model and are not run early,
   so the prediction is of the likely path, not a guarantee. Measured on the
   desktop first, against the existing run files (which path each question
   actually took), before it goes near a phone. The same on both platforms.
5. **Show it.** One quiet line under the text box. No estimate until the
   pause; none while Fred is answering. "Answers left on this charge" uses
   the battery level, which an iPhone reports only in 5% steps, so there it
   is worded as a rough figure.
6. **Check it is honest.** Per answer: estimate against the meter's reading.
   Over a long unplugged session: the sum of the estimates plus idle draw
   against the real fall in charge (Android: the charge counter; iPhone: the
   battery level, which needs a session of several hundred answers to move
   enough, and a Power Profiler recording beside it). Results doc,
   `metrics.json`, board.

## Limits and risks

- **Rough, not exact.** How long a written answer runs is not known until it
  is written, so the estimate is a range, widest for long answers.
- **Other phones are unverified.** Only the Nothing Phone is measured. Other
  Androids rely on the built-in meter and its sanity checks.
- **The iPhone meter rests on an undocumented counter** and has never been
  run on a real iPhone; see "Risks specific to iPhone" above. The fallback
  keeps the feature alive without it.
- **The early search has a cost** in battery and in code: `ask()` has to
  accept a search already done. If reuse is not clean, the estimate falls back
  to the phone's average written-answer cost with no early search.
- **No ground-truth meter.** Without a hardware power monitor the check in
  step 6 is the phone's fuel gauge against itself over a long session.
- **Needs the phone**, off the cable and on Wi-Fi, for steps 1, 2 and 6: a few
  hours in total. The iPhone half needs a real iPhone and the Mac.
- **Size.** A guess of two to three working days for Android, and one to
  two more for the iPhone once Fred runs on one, for a stretch item due with
  the RC release (2026-12-09), competing with the A-KR2 work due 2026-10-12.

## Open questions for Ryan

- Go-ahead, or changes.
- "Percent plus answers left" in place of a bare percentage?
- Start now, or after the 2026-10-12 accuracy work?
- Build Android first and the iPhone when #28 lands, or hold both until
  then?
- Is an undocumented counter acceptable in the iPhone app, or should the
  iPhone ship with the time-based fallback only?

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
- Apple developer forum, `task_info` and `TASK_POWER_INFO_V2` on iOS (Apple's replies): https://developer.apple.com/forums/thread/738608
- Apple developer forum, battery level in 5% steps is intended: https://developer.apple.com/forums/thread/788911
- xnu, `task_info.h` (`task_power_info_v2`, public part of the header): https://fergofrog.com/code/codebrowser/xnu/osfmk/mach/task_info.h.html
- xnu, how the kernel counts energy per thread ("recount"): https://newosxbook.com/src.php?file=%2Fdoc%2Fobservability%2Frecount.md&tree=xnu
- PowerMetricsKit, per-thread CPU energy on Apple platforms: https://github.com/Androp0v/PowerMetricsKit
- Apple, WWDC 2025, Profile and optimize power usage in your app (Power Profiler): https://developer.apple.com/videos/play/wwdc2025/226
- iPhone on-device LLM benchmarks and the limits of measuring energy on an iPhone: https://github.com/john-rocky/apple-silicon-llm-bench
