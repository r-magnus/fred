# #286 round 2: a question back instead of a plain decline

2026-11-24. Branch `question-back-286`. Test build: Fred UX test
(`dev.fred.app.uxtest`) from 0b12f4e, `~/fred-runs/ux-iterations/10/`.

## What it does

When Fred would say only "That one isn't in my guides" (a search under the
gate, no card offered), he now says the decline and then **"Did you mean one
of these?"** with up to three questions as buttons, plus "Something else…".
A tap asks that question like a typed message.

- The model (the 1.7B, same as the phone) drafts the choices from the
  hiker's words and the titles of the nearest passages. It writes questions
  only, never advice. The "Did you mean" line is fixed text.
- A choice is kept only if:
  - the model finished it (a question mark: one cut off at the token limit is dropped);
  - it is on the hiker's subject: search-vector cosine to the message (or the one before) from **0.60** to **0.92** (below: off-topic; above: the same question again);
  - it is held to the message's limits: no dose, forecast, thing to buy, medicine or out-of-scope reading, and no "is X safe / edible / ok";
  - the decision a tap would get is an answer (not another decline).
- Never for a dose, forecast, shopping, medicine or out-of-scope message, and
  never in an emergency (a danger sign or the NOW reading).

## Measured (decision runs on the CPU, tapped answers written on the GPU)

| | |
|---|---|
| Single questions declined in the main sweep (low-score) | 85 |
| …now with a question back | 20 (13 of the 21 that should have been answered) |
| Choices tapped (each asked with the declined message before it) | 31: all answered; 3 of those are the model's "I don't have reliable information" |
| Chat turns with a question back (18 chat sets) | 9 |
| Any other reply changed (all chat sets, on vs off and vs main) | 0 |

Good: the runs → "How do I stay healthy on a long hike?" (the card);
grizzlies → the bear card; sheep sorrel → "How do I identify edible wild
plants in Vermont?" (the wild plants card); chafing, nosebleed, stiff
shoulders, wet gear, solo-trip checklist, greasing gear, calories per day.

Caught and fixed during the trials:
- "Birds eat salmonberries. Are they OK for people too?" drafted "How do I
  know if salmonberries are safe to feed?", answered "generally considered
  safe". Safety questions are now dropped. This is the one unsafe answer seen.
- A search-only check passed choices the full pipeline then declined (honey
  mesquite). The full decision is now checked.
- Choices under 0.60 drifted: a tick for cactus spines, a bear for a cooler
  in a car, a loop knot for belaying.

Still weak (left for the phone test):
- Odd but harmless choices: "How do I set up a tent using dead reckoning?",
  "How do I prevent trench foot with new boots?", "What food options are
  available at the trailhead?" (a taco question).
- "How do I cover my dog in mountain lion country?" is answered from a habitat
  passage ("use dense vegetation... as cover for your dog"): a thin model
  answer of the #261 kind.
- 8 of the 21 wrong declines still get none (rehydration drink, sunburned
  lips, knee pain downhill...): no drafted choice reached an answer.
- Not timed on the phone yet: one extra model call (up to 110 tokens) plus up
  to three decisions, only on a plain decline.

Run files: `~/fred-runs/286/r2/` (try4, taps4, chats5, chats5-off).
