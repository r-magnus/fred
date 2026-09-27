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

## The fix: decide intent as well as topic (adopted)

Search already finds the topic: for casual messages the right card is usually
ranked first (the choking card at 0.189 for "he's choking... can't make a
sound"). What was missing was intent. `intent.ts` sorts each message into
**now** (an emergency), **question**, **prevent** or **chat**, with the model
answering one word, plus two word rules the model needed:

- **Prevention wording** ("avoid", "prevent", "tips to keep ... off", "what
  should I bring") skips the model: it called all six practice prevention
  questions QUESTION, and a stronger instruction made chat worse instead.
- **A message that asks something is never chat**: on the tuning set the model
  called "how can I find north without a compass?" CHAT (the first version fell to 66/104 on tuning: `graded-runs-intent-first.jsonl`).

`ask()` (option `intent`, on in the app) then:

- **now**: opens the leading field card even under the gate (the best card,
  if it scores at least 0.15 and within 15% of the top result), except when a
  pet is the patient: veterinary care is out of scope.
- **chat**: a fixed reply (no model-written advice), with the leading card
  offered folded in the app.
- **question** and **prevent**: the normal path. Forcing cards for questions
  opened the cuts card for "talk me through stitching a cut closed"; hiding
  cards from prevention questions lost three good prevention cards (staying
  warm, staying healthy, river crossing).

### Measured

| | Before | With intent |
|---|---:|---:|
| Tuning (104): outcomes and cards | 90 | 90, **no answer changed** |
| Held-out (40): outcomes and cards | 34 | 34, **no answer changed**; 72.5% stands |
| Practice casual set: emergencies helped | 3 of 10 | 7 of 10 (+1 card offered) |
| Practice casual set: chat answered with a reply | 0 of 12 | 11 of 12 |
| **Sealed casual set (30, run once): emergencies helped** | **5 of 12** | **9 of 12** |
| Sealed casual set: chat firing a card | 0 of 8 | 0 of 8 |
| Sealed casual set: chat answered with a reply | 0 of 8 | 6 of 8 |

Still missed on the sealed set: "sliced my thumb open and it won't stop
bleeding" (classed a question, just under the gate), "my wife just collapsed
and her arms and legs are jerking" (search does not find the seizure card),
"we ran out of water and only have a muddy pond" (classed chat). On the
practice set, "I have no idea where I am and it's getting dark" is classed
chat: it gets the lost card offered, not opened.

Known limit: "how can I avoid getting bitten by a snake?" still gets the
snakebite treatment card, because prevention questions keep the normal path.

**Cost:** one short generation per message, about 1.9 s on the desktop; not
yet measured on the phone, where it will be more.
