# Plan: replies that answer the message, not just show a card (#109)

2026-10-01. Ryan: "the device feels like a faq search right now". A field card
is shown word for word whatever was asked. "should i put ice on it" after a
snakebite gets the whole snakebite card; "how long can it stay on" (a
tourniquet) gets a bleeding card. The card is right and reviewed, but the
reply does not answer the question.

## The design

- **The card lines that answer it, first.** When Fred would show a card for a
  message that asks something specific, the model picks which of the card's
  lines answer that question (line numbers only, a short call), Fred shows
  those lines in the card's own words, and the whole card follows **folded**
  ("▸ What to do: Snakebite"), a tap away. *Revised 2026-10-02 after a try-out
  on seen chats:* the first version had the model write one or two sentences
  from the card, and it inverted it ("No. Do not take off her ring" for a sting
  on a swelling hand; "Yes, she can walk on it" against the sprain card's
  "rest"), as card-only rewriting did in `results-phase3.md`. Picked lines
  cannot invert the card; the risk left is picking a line that does not answer,
  with the whole card one tap below.
- **Emergencies stay as they are.** A first report of something happening
  ("a snake struck my buddy") still opens the card at once: speed matters
  most there, and the card is the answer.
- **No line answers it:** the card itself, open, as today.
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
