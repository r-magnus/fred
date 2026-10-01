# Checked answers stream sentence by sentence: results (#103)

2026-10-01. While a condition with forbidden advice is active (snakebite, burn,
frostbite, cold, heat, heavy bleeding), a model-written answer used to be read
in full before anything was shown (#101). Now each complete sentence that
passes the check is shown at once; at the first that gives forbidden advice,
it and the rest are dropped, generation stops, and the condition's card
follows, after "Use this instead, for the burn:" when sentences were already
shown (`streamChecked` in pipeline.ts).

## Accuracy

- **Long chats** (sealed and confirmation, California, answers generated): all
  203 replies word for word the same as #101's final run. The check never
  stepped in there.
- **Round 2's chat sets** (sealed and confirmation): the check stepped in four
  times; no forbidden advice was shown in any. In one (a burn blister) two
  sentences of friction-blister advice ("apply athletic tape") were shown
  before the card, which led to the "Use this instead" line.

## Time on the phone

Nothing Phone (3), the app before and after, the same chats:

| Checked answer | Before: first words | After |
|---|---:|---:|
| "its on his ankle and swelling" (snakebite) | 23.7 s | 15.8 s |
| "should i put ice on it" (snakebite) | 15.9 s | 12.5 s |
| "theres a big blister now" (burn) | 28.3 s | 25.6 s |

First words come 3-8 s sooner. The rest is the model reading the prompt
(passages) before it writes: shorter prompts are the next step. The phone's
times were noisy in this session (one model check took 30 s; the system log
shows heat limiting while charging).

## Seen along the way

On the phone, "my friend fell in the lake and cant stop shaking" opened the
shock card, not the hypothermia card (the desktop picks hypothermia); the
record had the cold condition but the shock card led the search, and the
follow-ups stayed on it. Not unsafe ("lay them down, keep them warm, get
help"), but the wrong card: a message that sets a condition should usually get
that condition's card. Follow-up.
