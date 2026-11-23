# #286 responsiveness, first round: follow-ups, held cards, progress reports

2026-11-22. Branch `followup-286`. Started from a tester's thumbs-down
(ratings database, 2026-11-22): "I may encounter a bear. What should I do if I
see one on trail?" got the bear card (thumbs up), then "How to tell difference
between black and brown?" got "That one isn't in my guides, and I'd rather not
guess", rated down with "Missing answer to common question".

Ryan's direction: solve the kind of problem, not bears (no bear source); make
Fred more conversational (replies to statements, a question back over a dead
end, a little small talk); try everything else before letting the model answer
from its own knowledge.

## What changed

1. **A weak question right after an answered one is read with it.** The
   understanding step ran only for a message the word test (`leansBack`) said
   points back: three words or fewer, or "it", "they", "what about"... The
   tester's question is seven words with none of them, so it was searched alone
   (0.04) and declined. Now a question (not news) that finds nothing alone, right
   after a question Fred answered, is read with that question. The rewrite must
   keep a word of the new message that the earlier question lacks: without
   that, "can you recommend a good restaurant near yosemite" after a wet-wood
   fire question was rewritten as the fire question and answered from campfire
   passages (decision sweep, step 2).
2. **A held card that misses an information question says so.** The cards
   kept for every follow-up (`CARD_HOLDS_FOLLOW_UPS`, #240) were shown again as
   if they answered. When none of the card's lines answers a question asking for
   information (not a how-to, not yes/no), the card now opens with "My guides
   don't answer that exactly. Here's what they do say about it:". The first
   version also fired for yes/no questions; on the sweep all 8 were cards that do
   answer them ("should i sit her up against a tree" after the neck card, "do we
   play dead", "is it ok to let him nap"), so yes/no questions are left out.
3. **Progress after a card in order gets its next step.** "ok the tarp is up
   between two trees" got "Okay. This might be what you need:" and the card
   folded. Now, after one of 22 reviewed cards whose steps are done in order
   (`SEQUENCE_CARDS`), a report that matches a step (`PROGRESS_FLOOR` 0.4) gets
   "Good. Next: <the card's next step>", in the card's own words, with the card
   folded beneath. Branch lines ("If...", "No tourniquet?", "Otherwise") are
   skipped. Setbacks ("keeps blowing down"), questions, danger signs and
   wrap-ups are left alone. Cards that are lists of options or of things done
   together (RICE, ways to treat water, burns, bears) are left out: "ok it's
   been boiling for a minute" would have got "Next: Can't boil? Use tablets".

**Tried and parked:** the model's bare "I don't have reliable information"
when no quote or card can replace it. Three times in the five dev sets (one of
them, a tent brand, is right to decline). Filling it needs lower quote floors,
which were set against unsafe and out-of-scope quotes (#23, #126), and a
"give the part you know" prompt was measured and rejected in #23.

## Results

New sets: `chats-followup-dev` (21 chats, tuned against) and
`chats-followup-holdout` (14 chats, other topics, read once for this
write-up). Answers on the GPU (#271 switch, decisions on the CPU); baseline
`~/fred-runs/286/base` is main before the change, same setup.

| | Before | After |
|---|---|---|
| Dev: follow-ups that drop the subject (10) | 5 declined | 1 declined (the thunderstorm one: the model refuses) |
| Dev: tester's bear question | "not in my guides" | bear card, led by "My guides don't answer that exactly" |
| Dev: progress reports after a card (7, plus one setback) | small talk, card folded | 3 get the next step (tarp, tick, back blows); 4 unchanged (under the floor, or not a card in order); the setback gets a written answer |
| Held-out: follow-ups that drop the subject (9) | 2 declined | 0 declined |
| Held-out: progress reports (2) | small talk | unchanged (no card in order shown before) |
| Existing dev chats (77 turns, generated) | | 0 replies changed |
| All 16 chat sets, decisions (~650 turns) | | 1 changed: a smoke follow-up, decline → keep-an-eye-on-it reply |

The two held-out follow-ups now answered:
- "should the hip belt be clipped or unclipped" (river crossing): "Do not clip
  the hip belt". Right.
- "does sports drink count toward that" (desert water): answered, but its third
  point ("drinking sports drinks does not restore sodium; it can lower sodium
  levels further") is muddled. A thin model answer, the kind #261 targets.

Still wrong, not changed here: the thunderstorm refusal now reads "Glad you asked about crouching on your backpack. I don't have reliable information on that." (the friendly opener goes in front of the model's refusal); "push through or pull back out" after a fishhook
question got the tick card; "should his head tilt back" after a nosebleed got
the spine card's "don't tilt the head back"; "does the moss trick actually
work" (dev) says moss grows more on the south side.

Single-question sets cannot change: every rule needs an earlier message.
