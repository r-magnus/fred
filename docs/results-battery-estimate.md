# A battery estimate before sending: results

2026-10-07. US-13, #80. Plan: `plan-battery-estimate.md`. Phone logs and the
prediction check: `battery-estimate/`.

**Short version: on the Nothing Phone (3) a written answer costs about 135
joules, roughly 0.2% of a full battery, and a quick reply (a field card,
small talk, a decline) about 10 joules, 0.015%. The app now measures every
answer on the phone it runs on, and shows one line under the text box while
a message is typed, such as "~0.2% battery · ~400 more like it". The iPhone
half builds and meters answers in the simulator (2026-10-09); it has never
run on a real iPhone.**

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
- **The line** under the text box, never while Fred is answering. Since
  2026-10-08 (#161) it is there from the first character as a ceiling with
  no search ("up to ~0.2% battery · at least ~300 more", a written answer's
  cost), and narrows to the predicted kind 0.3 s after typing pauses (it was
  0.8 s). The two figures are set larger and in green; the words are fewer.
  Only one search runs at a time, and a message typed over is not searched.
  Send waits for a search in progress: on the phone, plugged in, one send
  tapped mid-search waited 0.86 s and then searched in 0.35 s with the
  vector reused, about what a search from scratch takes. Not checked
  unplugged, where the first estimate in five minutes also reads the idle
  draw for 1.5 s.
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

### In the simulator, 2026-10-09

Branch `ios-main-2026-10-09`, Xcode 27.0, the "FredTest" simulator (iOS 27.0)
on an Apple M5 Mac. **Nothing here is an iPhone's figure**: the simulator runs
the model on the Mac's processor. It shows that the code works, not what an
answer costs.

- **The simulator does report energy.** This note used to say it does not. A
  3 s one-core loop read 14.7 J inside the simulator. On the Mac the same
  call returned exactly what `proc_pid_rusage` gives as `ri_energy_nj`
  (16.055 J both ways), and the kernel accepted the struct as written (26
  words), so the layout in the Swift is right.
- **`task_info` is the call to keep.** It compiles against the public iOS
  SDK. `proc_pid_rusage` does not: its header is not in the SDK.
- **The module is now linked into iOS builds** (`expo-module.config.json`:
  `apple` beside `android`). The Swift compiled unchanged; Release build
  succeeded.
- **Answers were metered.** Snakebite card (9.1 s of model time on the Mac):
  87.9 J. A written answer (about 46 s): 446.5 J.
- **A fallback by time is built** (`timedJoules`, `energy.ts`): when the
  iPhone's counter gives nothing, the answer is costed as the seconds it took
  times 10 W, times 0.6 in Low Power Mode or when the phone reports a serious
  thermal state. **Both figures are placeholders.** 10 W is the Nothing
  Phone's net draw while writing; 0.6 is a guess. The table by iPhone model
  is empty until one is measured. Run in the simulator with the counter
  hidden: a 3.3 s card was costed at 32.7 J, `source=time`.
- **Two field-test switches**, beside `devhooks`: `devhooks-battery` (a level
  from 0 to 1, for a phone that reports none) and `devhooks-no-counter`
  (hides the iPhone's counter). With the level set to 0.8 the estimate was
  computed (`percent=0.0214 left=3744`). **The line itself has not been seen
  on an iOS screen**: typing into the simulator from the command line did
  not reach the text box.
- The log line now ends with `source=counter|gauge|time|none`.

### Still to do on a real iPhone (#28)

1. Ask a card question and a written one. `[fred] energy ... source=counter`
   should show a few joules for the card and clearly more for the written
   answer. `source=time` means the counter gave nothing.
2. One unplugged session to calibrate. The counter is the processor only:
   no screen, no GPU, no kernel work. Android's figure is the whole phone
   less idle, so the iPhone will read low until scaled. Either record with
   Xcode's Power Profiler on the phone, or time the gaps between the 5%
   battery steps over a long run (one public iPhone 17 Pro benchmark does
   this and claims about ±10%).
3. From the same session, the watts for `IPHONE_ACTIVE_WATTS` and the real
   cut in Low Power Mode.

Known gaps: the battery sizes are published figures by model, stop at the
iPhone 16 family and ignore wear; the level comes in 5% steps, so "answers
left" is worded "very roughly"; if Metal offload is ever switched on for the
iPhone, the counter misses the GPU and only the timed figure applies. The
counter is undocumented (Apple's staff: "the only thing you can safely do is
compare values between runs on the same hardware"), and no public replacement
was found for iOS 26 or 27.

## Open

- Only one phone is measured.
- The estimate is not shown for a follow-up differently from a first
  message, though a follow-up's path depends on the conversation.
- A cool phone and a warm one were not measured apart; the phone warmed
  through the runs and the per-answer cost did not move with it.
