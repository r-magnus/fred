# Signs questions and frostbite against trench foot: results (#112)

2026-10-14. Evidence: `card-line-signs/`.

**Short version: "what should I watch for" after a head injury now gets the
card's list of concussion signs, and frostbite chats stay on the frostbite
card instead of drifting to trench foot. Over every graded and chat set
(about 1,000 replies, 24 sets), 5 replies changed, all for the better, none
worse, none unsafe. No reply changed between answer, decline and help now.**

## What changed

1. **Signs questions get the signs line.** A question about what to watch
   for, look for, the signs or symptoms, or how to tell, always shows the
   card's line that opens "Watch for" or "Signs", with the best matched line
   beside it. Before: "My friend hit their head on a rock and seems confused.
   What should I watch for?" matched the neck line (0.52) and the emergency
   line (0.53); the rest of the message outvoted the question. Matching only
   the question part ("What should I watch for?") was tried first and failed:
   every line fell under the 0.37 floor and the emergency line still led.
2. **A follow-up about the card just shown stays on it.** "can i rub them"
   after the frostbite card led the search with trench foot (0.296 against
   0.273) and switched cards. A follow-up that points back, says nothing new,
   and still finds the shown card within 85% of the leading one keeps it,
   unless the leading card is the one for the condition the hiker described.
3. **Two signals that agree on a condition beat one search score.** "my toes
   went white and numb" set the frostbite condition and the card matcher was
   0.91 sure of frostbite, yet trench foot opened (0.379 against 0.310). When
   the message sets a condition, the matcher is sure of its card, and that
   card is in the search results, it opens.

The first sweep, with only 1 and 2, made one reply worse: "should i rub them
with snow" after trench foot was wrongly shown for white, numb toes held on to
trench foot (the old code drifted back to frostbite by chance). The exception
in 2 and rule 3 were added for it, and every set was swept again.

## Results

Decision sweep (`GENERATE=0`, `INTENT=1`, California, scope scorer, card
matcher, voice), main at 35d6457 against this branch, same packs as the phone.
Graded by Claude, who wrote the change and knew which side was new: with five
changes the grading was not blinded. Each is listed below.

| Reply | Before | After | |
|---|---|---|---|
| "...hit their head... What should I watch for?" (tuning) | neck line, emergency line | concussion signs, emergency line | better |
| "my toes went white and numb" (sealed chats) | trench-foot card | frostbite card | better |
| "My toes are white and numb after hiking in the snow all day" (breadth) | trench-foot card | frostbite card | better |
| "can i rub them to get the blood going", after frostbite (card questions) | trench foot, "Don't rub or massage the feet" | frostbite, "Don't rub or massage it" | better |
| "the blood won't stop no matter how hard i press" (sealed chats 2) | soaked-bandage card | heavy-bleeding card (tourniquet steps) | better |
| "how long can it stay on", a belt tourniquet (sealed long chats) | soaked-bandage card | heavy-bleeding card ("safest for under two hours") | better |

(The frostbite "rub them with snow" follow-up is unchanged: the frostbite
card, "Don't rub or massage it".) The sealed set written for this ticket
(`holdout-chats-8`) had no change: its signs question and its frostbite
chat already got the right card.

## Still open

- "my feet are covered in hot spots" still gets the trench-foot card. The
  message is read as an emergency, and an emergency is searched in first aid
  only, so the blister tips (Wikivoyage: cover hot spots with tape or
  moleskin) are never reached. Moved to its own ticket.
- Not checked on the phone. Nothing here adds a model call or an embedding;
  the rules use vectors the search already made.
- The line floor (0.37) and band (0.08) were not re-tuned.
