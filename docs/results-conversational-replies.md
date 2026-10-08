# Fred's side of the conversation: results (#172)

2026-10-08. Research: `reports/Fred conversation quality.md` (#171), options
1-4. Runs: `conversational-replies/`. On the branch `conversational-replies`,
not merged.

**Short version: Fred now answers small talk by what was said, opens cards
and fixed replies with a line built from the hiker's own words, keeps a
friendly start for plain questions only, and says what would help when he has
no answer. All of it is fixed wording picked by rules: no model call, so no
added wait. On nine chat sets (454 turns, 190 chats) no decision and no card
changed, and the chats where Fred repeats himself word for word fell from 61
to 25. Not yet read by Ryan, and not yet run on the phone.**

## What was built

One new file, `packages/rag-core/src/voice.ts`, behind one switch (`voice`;
`VOICE=1` in the test harness, on in the app, off with a `devhooks-no-voice`
file). With the switch off nothing changes.

- **Small talk** (was one line, "Got it. I'm right here whenever you need
  me...", for 23% of chat replies). Now: a greeting is greeted; "thanks" gets
  "Anytime." or "You're welcome."; "found the trail again" gets "Good to hear.
  Tell me if anything changes."; a plain "ok" gets "Okay."; anything else gets
  a short line that changes each turn. What Fred is for is said once, on the
  first message, not every time. A report of something done ("ok it's off")
  is acknowledged and never praised, because Fred has not checked it.
- **A first line before a card or fixed reply**, from the hiker's words:
  "Sorry about your mom's wrist.", "Sorry to hear about your buddy.", "Sorry
  about his fingers." A person or body part is named only when the message
  says whose it is and only one is in play; otherwise the line is general
  ("Sorry you're dealing with that.") or left out. Each situation is named
  once, not again on the follow-up.
- **Tone by how serious the moment is.** A danger sign in the conversation:
  one short line of presence ("I'm here with you."), once, and nothing
  friendly after it. Trouble of any kind: sympathy, and no "Happy to help."
  on the questions that follow. A plain question in a plain chat: "Happy to
  help.", "Sure, let's take a look.", "Good question.", on every other
  question at most. After "can I..." or "is it ok...": only "Glad you asked."
  or "Thanks for asking.", never anything that reads as yes.
- **Dead ends.** A decline now depends on what was asked: "I can't say either
  way from my guides, and I'd rather not guess." after a yes/no question;
  "Sorry about your knee. I don't have steps for that in my guides..." after a
  problem, with "Tell me what happened and how it looks now, and I'll look
  again."; "That's outside what my guides cover." with what Fred is good for,
  when it is out of his scope.
- **The model-written opener** (#130) is unchanged, but when its check drops
  the model's line, a rule-picked line now takes its place.
- **App:** shows the new lines; a decline that follows an opening line is now
  shown as a decline (it was shown as an answer).

## Results

Nine chat sets, decisions only (no model-written answers generated), the
phone's packs, California, the scope scorer and card matcher on; the switch
off, then on.

| | Off | On |
|---|---:|---:|
| Turns whose decision, card or offered card changed | | **0 of 454** |
| Chats where Fred repeats a reply word for word | 61 of 190 | **25 of 190** |
| Repeated replies | 100 | **40** |
| Chats with the long "Got it" line twice or more | 12 | **0** |
| Small-talk replies that changed | | 35 of 73 |
| Cards and answers that got a first line | | 125 of 300 |
| Safety replies that got a first line | | 10 of 44 |
| Declines fitted to the message | | 35 of 35 |

"Repeats" here counts a reply as the same when its first line, card and
decision are the same, which is what a decision-only run records. The repeats
left are mostly the same card shown again for a follow-up with no line of its
own. The numbers are from the run before the last small fix (below), which
only takes a few friendly starts away.

Examples from the runs:

| Hiker | Fred's first line (then the card or reply as before) |
|---|---|
| "my mom slipped on the wet boardwalk and put her hand out, now her wrist is swollen and she wont let me touch it" | Sorry about your mom's wrist. |
| "my buddy is dizzy and sweating a ton in this heat" | Sorry to hear about your buddy. |
| "he tumbled down the talus and now he cant feel his fingers" | Sorry about his fingers. |
| "it bit my friend's ankle" (after a rattlesnake) | Okay. I'm with you. |
| "How do I set up a tent?" | Happy to help. |
| "ok found the trail thank god" | Glad to hear it. I'm here if anything changes. |
| "ok thanks" | Glad to help. I'm here if you need me. |
| "a bee stung my dog on the nose" | Sorry you're dealing with that. That's outside what my guides cover. |

## Found by running it, and fixed

The first run was off-key in ways the unit tests had not caught; each is a
test now.

- "I'm here with you." before a blister card, and on turn after turn: the
  app reads many ordinary problems as "help now". The presence line is now
  for a danger sign only, once per conversation.
- "Thanks for asking." to "do we play dead" with a bear charging: no friendly
  start once anything in the conversation is trouble or a threat.
- "Sorry about your head." to "my shoulders and neck are so stiff... i can
  barely turn my head": with several body parts in one breath, none is named.
- "Sorry about your wrist." to "i sprained my wrist skiing back in march but
  it healed fine": nothing for what is long past.
- Two sympathy lines running ("Sorry to hear about your wife." then "Sorry
  you're dealing with that."): the second is dropped.
- "Let's take care of that." in front of "I don't have steps for that": the
  line no longer promises help it may not have.

## Still open

- **Ryan has not read a sample**, and tone is his call. The lines are short
  and plain on purpose; some may read as flat ("Okay, your son's face.").
- **Not on the phone yet.** No model call was added, so no change in speed is
  expected, but that is not measured.
- **Only chat sets, decisions only.** The single-question sets and generated
  answers were not re-run: with the switch off the code path is the old one,
  and with it on only wording is added.
- A general line can still miss the mood: "he got stung on the hand... now
  his eyelids are puffy and he is coughing" gets "Sorry you're dealing with
  that." in front of the right card.
- Cards themselves are untouched (tailoring them was shelved, 2026-10-08).
