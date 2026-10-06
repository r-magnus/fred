# A friendly opening line: results (#130)

2026-10-04. Plan: `plan-friendly-opener.md`. Probe: `tools/eval/src/opener-probe.ts`.

**Short version: a model-written opening line before model-written answers,
kept only when built from the hiker's own words plus a fixed vocabulary of
feelings. Answers after it are word-for-word unchanged (113 of 113). On the
second sealed set 11 of 35 messages got one, none with advice, a fact or
reassurance. On the phone it fails the speed bar both ways it was tried: after the
search, answers came about 5 s later; started as the message arrives, they
came 15-25 s later. Not merged.**

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

### Second try: the opener started as the message arrives

Ryan chose one more try: start the opener while the question is turned into
a vector (CPU on the phone; the generator is on the GPU), stop it at its
first sentence, and stop it outright when a card or decline answers. The kept
lines on sealed set 2 were the same 11. On the desktop, model calls now run
one at a time as on the phone: running the opener beside the intent check in
one context had changed the intent check's word ("my wife's feeling dizzy":
NOW became CHAT), and stopped openers held their sequences ("No sequences
left"). With that fixed, 113 of 113 answers identical.

On the phone it is much slower, not faster: the same session took 23.6-42.8 s
to first words (twice, and once more after the phone had cooled to thermal
status 0), against 7.8-16.9 s with the opener off and 3.6-20.7 s with the
opener after the search. The generator and the embedder evidently compete
for the phone's cores. (The first two runs also left the phone at thermal
status 3, CPU cores at 105 °C; the cooled run was no better.) The opener-off
run after cooling did not happen: the phone disconnected.

**Conclusion: on this phone a generated opener costs seconds on every
model-written answer, run before, after or beside the search. Not merged.**

## Round 3: a comforting tone

Ryan (2026-10-04): keep the generated opener, but from a place of comfort
("Hey, these things happen - it's okay", "Take a deep breath..."), not "X can
be uncomfortable". New prompt and a comfort vocabulary (hey, happen, breath,
together, sort, figure, glad, okay...), with two new rules: "okay" only
closes a phrase ("it's okay."), never "okay to swim"; after a yes/no or
is-it-all-right question, nothing that reads as yes (okay, right, good,
happens...). Outcome promises ("you'll be fine", "normal", "everyone") stay
out. Only the first sentence is kept, as on the phone (the desktop ignored
the stop string). Generated after the search again, and skipped when the
intent check reads NOW as well as on a danger sign.

Sealed set 3 (35, `opener-3.json`, written before the prompt and rules ran):

| | |
|---|---:|
| Skipped (danger sign) | 2 |
| Kept | 9 of 33 |
| Kept with advice, a fact, a promise or a yes | 0 |

The comforting prompt pulls the model straight to the risky kind of comfort;
all of these were dropped: "Hey, hiking alone is totally okay, it's a great
way to explore." ("is it okay if i hike alone tomorrow"), "Hey, leaving food
in your tent is a good idea for warmth and comfort.", "Oh no, bleeding is
normal, let's take care of it.", "Feeling a headache is totally normal,
let's take it easy.", "Hey, these things happen, it's okay." (to "is it ok to
drink from this pond if i boil it").

Kept: "Hey, arguments happen, let's figure this out together.", "Oh no,
that's frustrating.", "Oh no, hot spots are uncomfortable, let's sort this
out.", "Oh no, dark skies can be scary, but we'll figure it out together."
Off-key once: "Oh no, fevers can be tricky." to "he says he feels a bit
better now". (Set 3 was rechecked after the first-sentence and word-form
fixes, so it is now seen.)

Found on the way: "there's smoke and fire coming up the ridge toward us"
got the watch reply, not the emergency one. The fire danger sign now covers
smoke and more phrasings; it now gets the safety net. Decisions on every set
(795 questions and turns): 0 changed.

Timing is as in the first try (generated after the search: about 5 s later
answers on the phone); not re-measured for this prompt.

### Round 3 on the phone

2026-10-04, cooled to thermal status 0 before each session; opener on, then off.

| Message (one session each) | Off | On |
|---|---:|---:|
| "how do i make rope from plant fibers" | 16.5 s | opener 8.2 s, answer 19.0 s |
| "i've had diarrhea all morning on the trail, what should i do" | 9.2 s | 11.2 s (opener dropped) |
| "hiking in the desert next week, any tips for the heat" | 7.9 s | 9.3 s (opener dropped) |
| "how should i dress for a cold hike, i always end up sweaty then freezing" | 10.7 s | **no answer within 9 minutes** |
| "my feet are covered in hot spots" (card, no opener) | 3.5 s | 11.6 s |
| "is it ok to drink from this pond if i boil it" (card, no opener) | 2.0 s | 3.9 s |

The one opener shown was "Hey, these things happen, it's okay." to "how do i
make rope from plant fibers": the prompt's example, copied onto a how-to
question. Card replies, which get no opener, were slower too, with the
question's embedding taking 8.8 s instead of 1.5 s: with a third model
context loaded the phone is short of memory (the app held 6.2 GB, 57%, earlier
today). The fourth answer never came.

**Conclusion: not merged.** On this phone a generated opener costs seconds on
every answer (cards included), once stalled the app, and what passes the
safety check is often off-key. The fire danger-sign fix found on the way was
merged on its own (#131, PR #132).

## Retest after one model context (#136)

2026-10-05, Nothing Phone (3). The branch with `main` merged in: the opener
now shares the one model context, its prompt saved to a file like the other
lanes. In the app it is behind a field-test switch (a `devhooks-opener` file),
so one build ran both ways. One session per message, cooled to thermal status
0 before each, opener off then on; one run each. Time to first words:

| Message | Off | On | Answer later by |
|---|---:|---:|---:|
| "how do i make rope from plant fibers" | 11.9 s | opener 1.8 s, answer 12.4 s | 0.5 s |
| "i've had diarrhea all morning on the trail, what should i do" | 8.1 s | 9.6 s (opener dropped) | 1.5 s |
| "hiking in the desert next week, any tips for the heat" | 12.3 s | 13.9 s (opener dropped) | 1.6 s |
| "how should i dress for a cold hike, i always end up sweaty then freezing" | 10.2 s | 10.4 s (opener dropped) | 0.2 s |
| "my feet are covered in hot spots" (card, no opener) | 3.3 s | 3.3 s | 0 |
| "is it ok to drink from this pond if i boil it" (card, no opener) | 2.5 s | 1.2 s | none (the embedding took 2.2 s, then 0.8 s) |

Every answer came, word for word the same off and on. The app held 2.9 GB
both ways (6.2 GB in round 3). Card replies are no longer slowed, and the
cold-hike question that stalled for 9 minutes answered in 10.4 s.

Still short of the ship bar: model-written answers come 0.2-1.6 s later
(about 1 s on average, against about 5 s before), and the opener was kept on
one of four. Its text was not logged in that session; the reply was 37
characters longer, the length of "Hey, these things happen, it's okay." plus
a line break, the prompt's example that round 3 showed on this same question.

**Conclusion: the memory and stall problems are gone and the delay is down to
about a second. What remains is the opener itself: rarely kept, and off-key
when it is. Not merged.**

## Round 4: about what the hiker asked

Ryan (2026-10-05): a 1 s delay is fine for now; the line must come from the
hiker's own question or situation ("how do I make rope from plants" ->
"these things happen, it's okay" makes zero sense).

- **Prompt:** says how to match the message: an offer to help for a how-to,
  what-is or tips question; sympathy for a problem; calm for a worry; "glad
  you asked about X" for a yes/no question. Eleven examples, each naming its
  own topic.
- **Check, new rules:** the line must use one of the message's own topic
  words, so an example copied onto another message is dropped. No sympathy
  for a plain or yes/no question ("Oh no, sorry about the white berries" after
  "can i eat these"); no offer to help after a yes/no question ("Happy to help
  you cook those mushrooms"); no sympathy beside delight; not the message
  handed back. Loosened: after an offer to help, the hiker's own verb is not
  advice ("keep your phone battery going"); "poison oak" and "everyone" are
  the hiker's words when the hiker said them; more word forms ("dogs",
  "eating"). The probe prints why each line was dropped.

Sealed set 4 (42, `opener-4.json`, written before the prompt or rules
changed), run once (`opener-runs-set4.json`):

| | |
|---|---:|
| Skipped (danger sign) | 2 |
| Kept | 29 of 40 |
| Kept and about the hiker's message | 29 |
| Kept with advice, a fact, a promise or a yes | 0 |
| Kept but nonsense | 1 ("Oh no, scared thunder is scary.") |

The phone then showed the opener dropped for "i've had diarrhea all morning
on the trail, what should i do": "what should i do" was read as a yes/no
question. Fixed, with "prepare", "fix", "start" and the like allowed and "not
good" added to the judgments. All four sets after that (all seen by then;
set 4 in `opener-runs-set4-after.json`): kept 109 of 144 (30 of 37, 25 of 35,
23 of 32, 31 of 40), every kept line read, none with advice, a fact, a promise
or a yes. Round 3 kept 9 of 33.

Typical: "Happy to help you start a fire with damp wood.", "Oh no, a broken
zipper on your tent is frustrating.", "Glad you asked about sleeping in your
car at the trailhead.", "Take a deep breath, being nervous about crossing the
river is scary, we'll work through it together." Weak: how-to lines are
nearly all "Happy to help you..."; some are clumsy ("Oh no, burned finger on
the camp stove.", "Happy to help you work out what trash on a backpacking
trip is.").

### Round 4 on the phone

2026-10-05, one session per message, cooled to thermal status 0, opener on;
"off" is this evening's retest above.

| Message | Opener | Opener at | Answer at | Off |
|---|---|---:|---:|---:|
| "how do i make rope from plant fibers" | "Happy to help you make rope from plant fibers." | 2.0 s | 13.5 s | 11.9 s |
| "i've had diarrhea all morning on the trail, what should i do" | "Oh no, diarrhea on the trail is not fun." | 2.2 s | 9.7 s | 8.1 s |
| "hiking in the desert next week, any tips for the heat" | "Happy to help you prepare for hiking in the desert next week." | 2.0 s | 13.3 s | 12.3 s |
| "how should i dress for a cold hike, i always end up sweaty then freezing" | "Happy to help you figure out how to dress for a cold hike." | 2.7 s | 12.0 s | 10.2 s |
| "my feet are covered in hot spots" (card, no opener) | | | 3.3 s | 3.3 s |
| "is it ok to drink from this pond if i boil it" (card, no opener) | | | 1.0 s | 2.5 s |

Openers on four of four model-written answers (one of four before), first
words at 2.0-2.7 s; the answer itself 1.0-1.8 s later than without. Answers
word for word the same; the app at 2.9 GB. The generated sets were not rerun
on the desktop this round: the answer path is unchanged.

Not merged yet: in the app the opener is still behind the `devhooks-opener`
switch, waiting for Ryan to read a sample.

## Round 5: variety

Ryan (2026-10-05): try a round on variety, so how-to openers do not all start
"Happy to help you...". Also added to the app: a spinner and "Working on your
answer…" under the opening line until the answer's first word.

**First try, dropped:** three numbered wordings for every kind of message,
the number picked by code. The model followed the number and lost the kind:
problems got "Sure, let's figure out what those throbbing toes are", fewer
lines were kept (27 of 40 on set 4), and "Well done on popping the blister"
was kept after "is it ok to pop this blister". Praise after a yes/no question
is now dropped.

**What is in:** the code picks only how a question's line begins, and the
model writes the rest. A plain question (it opens with how, what, any...)
gets "Happy to help", "Sure, let's" or "Good question"; a yes/no question
gets "Glad you asked" or "Good question", never an offer. The pick comes from
the message and is never the one the message before it would have got. It
goes in the user turn ("..." (start with "Sure, let's") ->), so the saved
prompt on the phone stays one file. Problems and worries get no instruction.

Sealed set 5 (44, `opener-5.json`, written before any of this ran), run once
(`opener-runs-set5.json`): 2 skipped (danger sign), kept 32 of 42, none with
advice, a fact, a promise or a yes. How the kept lines begin:

| | Round 4, set 4 | Round 5, set 4 (seen) | Round 5, set 5 (sealed) |
|---|---:|---:|---:|
| Kept | 31 of 40 | 35 of 40 | 32 of 42 |
| Happy to... | 15 | 4 | 8 |
| Good question... | 0 | 8 | 13 |
| Sure, let's... | 0 | 8 | 4 |
| Glad you asked... | 4 | 2 | 2 |
| Oh no / Ouch / Ugh... | 10 | 10 | 2 |
| Take a deep breath... | 2 | 3 | 3 |

Weak: "Good question" is the commonest beginning, being offered to both
kinds of question. On set 5 six of eight problem messages lost their opener,
mostly to a word form the check does not know ("died" -> "dying", "ran out"
-> "running", "threw up" -> "throwing"); not tuned, the set being sealed.
Off-key but kept: "Take a deep breath, snapping at a friend for walking too
slow is scary.", "Happy to help you pad the blister between your toes." (to
"what do i do if the blister pops").

**Phone: not measured.** The phone dropped off USB during the install
(2026-10-05, about 23:50) and did not come back; it still runs the round 4
build with the wait note.
