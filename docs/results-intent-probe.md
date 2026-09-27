# When do cards fire, and on what wording? (intent probe)

2026-09-27. Prompted by a concern that cards assume how people talk: "I thought
I burned myself but I think it's okay" should not produce burn-treatment steps.
34 conversational messages (`tools/eval/data/intent-probe.json`, written before
measuring), labelled by what should happen, run through `ask()` without
generation (`tools/eval/src/intent-probe.ts`; runs in `intent-probe-runs.json`).

| Label | n | Card shown | Model answer | Declined |
|---|---:|---:|---:|---:|
| Chat, past or resolved (no card wanted) | 12 | 1 | 1 | 10 |
| Prevention ("how do I avoid...") | 6 | 3 | 2 | 1 |
| **Casual real emergency (card wanted)** | 10 | **3** | 0 | **7** |
| Ambiguous | 6 | 3 | 0 | 3 |

**The concern is real but small.** One chat message fired a card ("found a
tick on my dog yesterday and got it off, all good" → tick removal). Prevention
questions get the treatment card half the time ("how can I avoid getting bitten
by a snake?" → the snakebite treatment card).

**The bigger problem is the reverse: casually worded emergencies are
declined.** "My buddy slipped on a rock and his leg is bleeding a lot, help",
"he's choking on a granola bar and can't talk", "something bit my ankle in the
grass, I think it was a snake", "she's shaking and slurring words after we got
soaked", "I have no idea where I am and it's getting dark" are all declined;
"I just grabbed the hot pot handle and my palm is red and stinging" asks for
the hiker's state. They score 0.18-0.29, the same range as small talk, so the
gate cannot tell them apart.

Every tuning and held-out question is written in manual-like wording, which is
why the accuracy number never showed this. It is the most important finding of
the week for a first-aid app.
