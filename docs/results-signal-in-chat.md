# Signal questions answered with distance and direction: results (#77)

2026-10-11. Branch `signal-in-chat`.

**Short version: a question about phone signal now gets, in Fred's own
reply, how far and which way the nearest reported coverage is, and the map
under it. Built and tested on the desktop. Not yet seen on the phone: it was
unplugged before the new build could be installed. #77 stays open until it
is.**

## What was already there

More than the ticket says. Since 2026-09-27 a message like "I have no
signal" has put a map in the chat, and the line under that map already gave
the distance and direction. Two things were missing:

- **Fred's reply did not say it.** The reply was "Here's where you are.",
  with the distance in small print under the picture. Once a later message
  showed a newer map, the old one shrank to a button and the line was gone.
- **Many signal questions were not recognised.** "where can I call from?",
  "how far is the nearest signal?", "which way do I go to get reception?"
  and "is there cell coverage around here?" got "Not in my guides" and no
  map.

## What changed

1. **A signal-question rule** (`wantsSignal` in `map-intent.ts`): having no
   signal, where to find some, how far or which way it is, where a call can
   be made from, not being able to call out. Every signal question also
   opens the map, as before.
2. **The reply says it.** Where Fred would have said "Here's where you
   are." or "Not in my guides", it now says the map's own sentence, for
   example: "No carrier reports coverage here, so 911 calls may not
   connect. Satellite SOS may still work if your phone has it. Nearest
   reported coverage: about 2.6 km north-east. T-Mobile: about 8.7 km
   north-west. The map below shows where."
3. **The line is kept with the message**, so it stays in the conversation
   and in past chats after the map shrinks to a button.
4. **A reply that already says something keeps its words.** "my phone has
   no signal and my friend is hurt" still gets its own reply; the signal
   line goes with the map beneath it.

The sentence is the one the map shows, made by the same code
(`coverageNear`), so the chat and the map cannot disagree. It says
"reports", never "you will have signal": the data is the carriers' own
filings.

## Checks

- Tests: 15 signal messages recognised; 12 look-alikes not ("how far can a
  signal fire be seen?", "how do I signal a helicopter?", "I can't call my
  dog back"). On every question in the test sets the rule fires only on the
  six already listed as lost-or-signal questions. All 376 tests pass.
- What it would say at five public places, with the carrier set to
  T-Mobile, from the same coverage file the phone has:

| Place | Zone on the map | Nearest any carrier | Nearest T-Mobile |
|---|---|---|---|
| Big Sur coast, Highway 1 south of Lucia | carrier gap | here | 5.1 km north-east |
| Kings Canyon, Roads End | no service | 2.6 km north-east | 8.7 km north-west |
| Death Valley, the Racetrack | no service | 5.1 km north-west | 15.3 km south-east |
| Sespe Wilderness | no service | 2.6 km north-east | 2.6 km north-east |
| Yosemite Valley | covered | here | here |

## Not done

- **Not seen on the phone.** The build is made
  (`tools/eval/build-apk.sh --field-test`, 2026-10-11 18:37) and waits to be
  installed with `tools/eval/install-apk.sh`. To check: ask "where can I
  call from?" and look for the coverage sentence in Fred's reply and one map
  under it, with the sentence not repeated under the map.
- **Whether the distance is right on the ground** is B-KR3, part of the
  drive test (#20), not this ticket.
