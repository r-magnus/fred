# Plan: replies that answer the message, not just show a card (#109)

2026-10-01. Ryan: "the device feels like a faq search right now". A field card
is shown word for word whatever was asked. "should i put ice on it" after a
snakebite gets the whole snakebite card; "how long can it stay on" (a
tourniquet) gets a bleeding card. The card is right and reviewed, but the
reply does not answer the question.

## The design

- **A direct answer first, from the card only.** When Fred would show a card
  for a message that asks something, the model writes one or two sentences
  answering that question from the card's text alone (a short call: the card
  is ~350 tokens), and the card follows **folded** ("▸ What to do: Snakebite"),
  its reviewed text a tap away.
- **Emergencies stay as they are.** A first report of something happening
  ("a snake struck my buddy") still opens the card at once: speed matters
  most there, and the card is the answer.
- **Checked like any model-written text:** the answer is streamed through the
  sentence check (#103) against the card's own condition and every active
  one; a forbidden sentence is replaced by the open card. If the card does not
  answer the question, the model says what the card covers instead of
  guessing, and the card is shown open.
- `LEAD=0` turns it off.

## The test, written first

`tools/eval/data/holdout-card-questions.json`, committed before any code:
about 20 chats where a card is the right source and the last message asks
something specific about it ("can i put ice on it", "how tight should the
splint be", "do i pop it"). Graded blind against today's verbatim card on two
things: does the reply answer the question asked (yes / partly / no), and is it
safe. Plus the chat sets already graded (round 2 and #101) for regressions.

## Ships only if

1. Replies that answer the question asked rise on the new set.
2. No new unsafe reply on any chat set; the card is always one tap away.
3. Emergencies open their card as fast as today; time to first words for the
   new answers reported on the phone (expected ~4-6 s, against ~4 s for a card
   and 13-25 s for a passage answer).
