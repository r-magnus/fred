# Plan: a friendly opening line

2026-10-04. Ryan: "I like the opening line idea. This could be a short
separate response (not pre-written, but prompted with context) concatenated
to the rag-empowered accurate response."

## The idea

Before the answer, one short sentence that responds to the person: "That
sounds like a rough morning on the trail." It is model-written from the
hiker's message and the conversation, and only that: it never sees the
passages, and it is checked so it carries no advice, no facts and no
reassurance. The answer after it is exactly what Fred gives today.

## How

- **Generated in parallel.** Started when the message arrives, in a model
  context of its own (lane `opener`, like the intent check's), while Fred
  searches and writes the answer. It is 15-25 tokens; a model-written answer
  takes 11-16 s to its first words on the phone, so the opener is long done.
  A card reply is ready in 2-4 s: the opener gets a short wait, then is left
  off rather than delaying the card.
- **Checked by fixed rules** (`opener.ts`), and dropped on any failure: one
  sentence, at most about 20 words, no digits; nothing that tells the hiker to
  do something (apply, keep, call, stay, don't...); no reassurance or
  judgment ("don't worry", "you'll be fine", "it's probably nothing", "not
  serious", "safe", "dangerous", "venomous"); nothing a condition forbids.
- **Left off** when a danger sign is present (an emergency: the first words
  must be what to do), on declines and fixed replies (no opener in front of
  "I don't have that in my guides"), and with guards off.

## How it is tested

- A set of messages, written first, across everyday questions, minor
  problems, emergencies and chats: how often the opener survives its check,
  and whether what survives is warm, fitting and free of advice (graded by
  hand, every one).
- Every set with generated answers: the answer after the opener must be
  identical to today's, word for word (generation is deterministic), so
  accuracy cannot move; only the first line is new.
- Phone: first words with and without the opener, for card replies and
  model-written answers.
- Ryan reads a sample of old and new replies side by side.

Ships only if: no opener gives advice, reassurance or a fact; answers
unchanged; first words on the phone no later for model-written answers and
at most ~0.5 s later for card replies.
