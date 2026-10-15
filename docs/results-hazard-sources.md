# Lightning, smoke and bear food: results (#100)

2026-10-15. Evidence: `hazard-sources/`. Fresh questions:
`tools/eval/data/holdout-hazards-2.json` (set `hazards-confirm`); fresh chats:
`tools/eval/data/holdout-chats-12.json`.

**Short version: thunder on a ridge, a canoe in a storm and a lone tree in a
storm now get the National Weather Service's backcountry advice. Smoke is
still a gap: the only official smoke pages are written for people at home.
Bear-country food storage is held back (#205). No card was added; the
hazards pack goes to 1.1.0 with one new page.**

## What the fresh questions showed

Written before any change, the fresh questions put most misses well under
the gate, not just under it: "my hair is standing up and i hear buzzing on
the summit" (0.12, read as altitude illness), "the air is so smoky we keep
coughing" (0.12), "a big plume of smoke just went up in the valley" (0.10).
A lower gate for in-scope hazard messages, the first idea, would have fixed
none of them and answered "tips for photographing lightning at night"
(0.28). Most of the gap was content.

## What changed

1. **A page added to the hazards pack (1.1.0):** NWS Blacksburg's
   "Outdoor Activities: Lightning Safety" ("Immediately get off elevated
   areas such as hills, mountain ridges, or peaks", "Never shelter under an
   isolated tree", "Immediately get out of and away from ponds, lakes").
   A forecast office's page keeps its menus inside the block the national
   pages use, so office pages are cut to their article (`cms-content`).
   Left out after reading them: NPS Grand Canyon's lightning page (still
   teaches the crouch NWS dropped in 2008); AirNow's and EPA's smoke pages,
   written for a home (clean-air rooms, HVAC filters, choosing and fitting a
   respirator). With the EPA page in, "the smoke is so thick it's hard to
   breathe" lost the get-help reply for instructions on fitting an N95.
2. **An agreed hazard passage answers a little under the gate.** An
   emergency (intent NOW) the scope scorer says needs an answer, whose own
   words and restated request lead with the same hazards-pack passage at
   0.25 or more, is answered from it. Never with a danger sign. "we're up
   on the ridge and just heard thunder" led both searches with the NWS
   lightning tips (0.268, 0.288).
3. **Burning eyes or throat are not a burn.** "my eyes and throat are
   burning" from smoke opened the burns card.

## Results

### Fresh questions (`hazards-confirm`, generated)

| Question | Before | After |
|---|---|---|
| "we're out in a canoe on the lake and a thunderstorm is rolling in" | "Stay inside the canoe ... shelter under the canoe" | lowest ground, away from lakes, shelter |
| "it's pouring and lightning everywhere, can we stand under that big pine" | vague | "Avoid standing under any tree", no overhangs |

No other answer changed; the five look-alikes are still declined.

### Every set (decision sweep, 29 sets)

The full sweep ran with the EPA page in (`9cda091`); the sets it changed
were run again at the final code, which can only undo changes. Final:

| Message | Before | After |
|---|---|---|
| "we're up on the ridge and just heard thunder, what do we do" | watch | NWS lightning tips |
| "the air got really smoky and my eyes and throat are burning" | burns card | watch |

Plus three lightning answers that now cite the new page beside the old
ones. Nothing else changed (`decision-diff.txt`).

## Still open

- **Smoke**: "we smell smoke and the sky is turning brown" is still answered
  with made-up canoe and smoke-signal advice, the same before and after;
  "the air is so smoky we keep coughing" is declined. A hiker-facing smoke
  source is needed.
- **Hair standing up, dark clouds over the peak**: no passage reaches them;
  a lightning card would.
- **Bear-country food storage (#205)**: on `bear-food-wip`, the follow-up
  keeps a chat reply's context and reaches the NPS food-storage pages, but
  the NPS passage mixes picnic-table and backcountry advice and the model
  blends them ("store food within arm's reach"; the cooler "inside the car"
  in Yosemite). Held back on Ryan's call.
