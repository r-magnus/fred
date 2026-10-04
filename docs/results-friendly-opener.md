# A friendly opening line: results (#130)

2026-10-04. Plan: `plan-friendly-opener.md`. Probe: `tools/eval/src/opener-probe.ts`.

**Short version: a model-written opening line before model-written answers,
kept only when built from the hiker's own words plus a fixed vocabulary of
feelings. Answers after it are word-for-word unchanged (113 of 113). On the
second sealed set 11 of 35 messages got one, none with advice, a fact or
reassurance. On the phone it fails the speed bar: the answer's own first
words come about 5 s later on average, and most of the time the opener is
then dropped, so the hiker waits longer for nothing. Not merged.**

## What was built

- `opener.ts`: one sentence from the hiker's message and their last two
  messages; it never sees the passages. Its own model lane, generated just
  before the answer (the phone runs one model call at a time).
- The check: one sentence of 3-18 words; no digits, number words or
  question; no advice, judgment of risk, or talk about Fred; every word is
  the hiker's or from a fixed vocabulary (feelings, setting, weather, body,
  gear, glue words), with at least one feeling word.
- Left off for a danger sign, card and reviewed replies, declines, and with
  guards off. App: `opener: true`; harnesses: `OPENER=1`, recorded apart.

## How the check got there

The first sealed set (46 messages) ran with a blocklist only. Of 27 lines it
kept, several gave advice or facts, some wrong:

| Message | Line the blocklist kept |
|---|---|
| "how should i store food at camp" | "Food at camp should be stored in a cool, dry place." (wrong in bear country) |
| "what does poison oak look like" | "Leaves with a rough texture and a white or yellowish sap." (wrong) |
| "my friend is panicking after we lost the trail" | "...we need to find another way forward." (against the stay-put card) |
| "i got stung by a bee on my arm" | "...but it's usually not too bad." |
| "the lake has green scum on it, is it ok to swim" | "Green scum on a lake can be harmful to swim in." |

So the check was turned around: only allowed words, not banned ones. Those
lines are now unit tests. That set was then seen, so a second set was
written and sealed before any run (`opener-2.json`).

## Results

| | Sealed set 2 (39) |
|---|---:|
| Emergencies skipped (danger sign) | 4 |
| Opener kept | 11 of 35 |
| Kept with advice, a fact or reassurance | 0 |

Dropped, rightly: "Deer can be scary to pet, but it's worth trying.", "Clear
water can be risky, but it's not always unsafe.", "Mushrooms can look similar
to chanterelles, but it's best to identify them before cooking."

Kept, for example: "Red, itchy eyes from the dust are tough.", "Stiff back
after sleeping on the ground is tough.", "Soaked and cold, it's tough right
now." Plain and repetitive ("X is tough"), sometimes awkward ("Burned finger
on the stove feels tough."). "she fell and her arm is bent the wrong way" has
no danger sign and got "...painful and frustrating."; in the app a card
answers it, and card replies get no opener.

Generated runs with the opener on (everyday, colloquial, phone chats): every
answer identical to the run without it, 113 of 113; openers on 10 of 31
model-written answers ("Sweaty then freezing is tough on the body.",
"Storms on the mountain can be frustrating for a hike.").

## Phone

2026-10-04, Nothing Phone (3). The same four questions as one session (the
opener's model context set up once, as in real use), opener off (two runs,
within 0.3 s of each other) and on:

| Message | Off: first words | On: first words | On: answer's own first words |
|---|---:|---:|---:|
| "how do i make rope from plant fibers" | 16.9 s | 20.7 s (dropped) | 20.7 s |
| "i've had diarrhea all morning on the trail, what should i do" | 9.3 s | **3.6 s** (opener) | 11.2 s |
| "hiking in the desert next week, any tips for the heat" | 7.8 s | 12.7 s (dropped) | 12.7 s |
| "how should i dress for a cold hike, i always end up sweaty then freezing" | 11.0 s | 19.8 s (dropped) | 19.8 s |

The answer comes 1.9-8.8 s later (about 5 s on average); the opener was
kept on one of four. Asked alone (app restarted each time) the rope question
once came back empty, with no error logged, and answered normally on two
repeats: not explained.

Ship bar: answers' first words no later on model-written answers. Not met.
