# Clarifying questions on field cards

2026-09-27. Ticket #50. When a card's advice depends on one detail, Fred asks
with a button per answer.

## What it does

- **Three cards ask** (`corpora/cards/clarify.json`):
  - Burns: "What does the burned skin look like?" Red, no blisters / Blistered / White, leathery or charred.
  - Heat illness: "Are they sweating heavily, or is their skin hot and dry?"
  - Stings and bites: "What got them?" Bee or wasp / Spider / Fire ants.
- **A vague message** ("how do I treat the burn?") gets the whole card, as
  before, with the question and buttons under it. Nothing is withheld while
  Fred waits for an answer.
- **A message that already says which** ("stopped sweating and is talking
  nonsense") gets only that case. "Not right?" offers the other cases and the
  whole card.
- **Each answer is a subset of the card's own reviewed steps**, in a set
  order: fire ants show "move away first" first. There's no new medical
  wording. The summary, every don't and the get-help line always show.
- **Two more buttons:** "Not sure" shows the whole card, the safe answer when
  you can't tell. "Something else…" opens the keyboard. Typing a new message
  instead just carries on; only the newest answer keeps its buttons.
- **A phrase only counts if it isn't negated:** "there are no blisters" picks
  red, "it isn't charred" asks, and naming two cases asks.

`clarify.json` pins each card's revision. If a card's steps change, the build
refuses the stale question until its step numbers are checked again. The
questions live in the card pack's manifest (`core-fieldcards` 0.4.0). The
search vectors are byte-identical to 0.3.0, so search can't have changed.

## Measured

Every card answer on the tuning, held-out and breadth sets (70) was re-run
without generation (`card-check.ts`, `clarify-card-check.jsonl`). Five reach a
card that asks. Three show the whole card as before. Two now show one case,
because the message named it:

| Question | Case shown | Answer sheet |
|---|---|---|
| fa-heat-01, "signs of heat exhaustion and how do I treat it?" | Sweating heavily | full, as before; the heat-stroke warning stays in the summary and get-help line |
| br-heat-01, "stopped sweating and is talking nonsense" | Hot, dry skin | full, as before |

No answer lost a point. Every other answer is unchanged, because only card
answers can change and search didn't move.

Checked on the Nothing Phone (3): a vague burn question shows the full card
and four buttons, and "Blistered" adds the blister steps as a new reply. The
heat-stroke message goes straight to the heat-stroke steps with "Not right?",
and "Something else…" opens the keyboard.

## Not yet

- A card *offered* beside a decline ("I grabbed a hot pot handle and my palm
  is blistering" still scores under the gate) is shown whole. It doesn't ask,
  and doesn't pick "Blistered" from the message.
- Tick bites, and heavy versus minor bleeding (two separate cards), could ask
  too.
