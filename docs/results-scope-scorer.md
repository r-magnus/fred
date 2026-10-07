# A trained "does this need an answer" scorer: results

2026-10-06/07. Asked for: research and experiments to make Fred answer when
it should, and to improve follow-up memory. Code is behind a switch that is
**off by default** (`SCOPE=tools/eval/data/scope-model.json` in the eval
harness; not wired into the app). Grades and the list of changed decisions:
`scope-scorer/`.

**Short version: a small trained scorer reads the message's search vector and
says whether the message needs an answer. It tells that apart far better than
the search score does (0.91 against 0.71, where 0.5 is a coin flip), and it
costs no model call. Used only as a last chance before Fred declines or says
"Got it", it changes 45 replies across 19 sets: graded 7.5 → 34.0 of 45, with
no unsafe reply and no should-decline question newly answered. Three of the
new replies are the wrong field card. A second idea, letting the model write
from weaker search results when the scorer is confident, was measured and
rejected: most of those answers were made up.**

## What was wrong

A decision-only sweep of the current pipeline (2026-10-05, same code and
packs) was read for every message Fred should answer and does not. Most are
plain statements of what happened:

| Message | Search score | Reply |
|---|---:|---|
| my husband just sliced his palm on a tin can | 0.06 | no steps, watch for danger signs |
| my friend gashed his arm on a rock | 0.06 | same |
| grabbed the hot skillet handle and my palm is red | 0.06 | decline |
| rolled my ankle on a rock | 0.31 | "Got it" (the model called it small talk) |
| we need to drink from this stream | 0.12 | "Got it" |

The gate is 0.29. A statement matches passages written as instructions
poorly, and the 1.7B model's small-talk call is wrong on statements. The
follow-up then fails too ("how do i clean it"), because memory only builds on
a message Fred answered.

Across 648 messages from 16 sets (556 that should be answered, 92 that should
be declined), the search score separates the two at **0.71** (AUROC: the
chance a should-answer message outscores a should-decline one). Published
work finds the same: reranker scores, score margins and entailment models do
not beat plain similarity for this decision, while small trained probes on
embeddings or hidden states do (links at the end).

## The scorer

- `packages/rag-core/src/scope.ts`: one weight per dimension of the search
  vector EmbeddingGemma already makes for every message, plus a bias. No
  model call, no new model file; the weights are 8 KB.
- Trained (`tools/eval/src/train-scope.ts`) on 523 messages written for it
  (`tools/eval/data/scope-train.tsv`): 260 that need an answer (questions,
  statements, emergencies, follow-up fragments), 170 out of scope (off topic,
  cars, pets, doses, procedures, permits, shopping, forecasts) and 93 small
  talk. The script refuses to run if a training message is a near copy of
  any eval message; that check removed 16 messages in all.
- The threshold (0.48) is the score 5% of the training messages that need no
  answer exceed when scored by a model that never saw them. No test set chose
  it.

| | Search score | Scorer |
|---|---:|---:|
| Should answer against should decline (648 messages) | 0.71 | **0.91** |
| Needs an answer against small talk (121 messages) | not measured | **0.99** |
| Should-answer messages past the line (556) | 293 | 447 |
| Should-decline messages past the line (92) | 16 | 10 |

The ten it lets past are mostly pets, a dose and a cracked tooth, which
other rules already decline, or need a search result it does not have.

## What it is allowed to do

It never answers by itself. With the switch on, a message it scores at or
above the threshold (and that is not about a medicine, a procedure,
childbirth or surgery, or a pet) gets a second chance at two points, after
every existing rule has had its say:

1. **Small talk.** When the model called the message small talk: the card
   folded under "Got it" is opened; with no card, the message goes on as a
   question, and if nothing answers it Fred says "Got it" as before. A remark
   about unnamed berries or mushrooms gets the wild-plants card.
2. **A decline or a fixed reply.** A statement that leans on no earlier
   message is searched again as "<message>. what should i do?". The card that
   leads is opened. With no card leading, the model answers only if that
   search clears the normal gate.

## Results

Decision sweep of every set, scorer off against on (California, intent on,
`~/fred-packs-g-all`), then every changed reply read and graded.

| Set | Before | After |
|---|---:|---:|
| Chat sets, turns whose kind of reply is wrong (526 turns, 7 sets) | 39 | **25** |
|   of which fixed / broke | | 14 / 0 |
| Casual-emergency conversations answered (28) | 22 | **25** |
| Colloquial answered (36) | 25 | **30** |
| Breadth answered (57) | 45 | **48** |
| Tuning answered (104) | 65 | **68** |
| Wildlife answered (22) | 15 | **17** |
| Everyday, health, health-confirm, ailments, states | | +1 each |
| Held-out (40), hazards, grounded-confirm, two-turn follow-ups | | unchanged |
| Should-decline questions newly answered, all sets | | **0** |

**Graded: 45 changed replies, 7.5 → 34.0** (`scope-scorer/verdicts.json`).
24 became fully right, 10 partly right, 3 got worse, 8 stayed level, and
none is unsafe.

Newly right, for example: the cuts card for a sliced palm, arm and finger,
and for the follow-up "how do i clean it"; the sprain card for a rolled
ankle; the soaked-bandage card for "the gauze i put on is totally red now";
the altitude card for a partner stumbling at 4,000 metres; the wild-plants
card (with its poison-control line) for a girlfriend vomiting after berries;
"we hear thunder"; an angry moose.

**Worse, or wrong where there was no answer before (5):**
- The river-crossing card for "i can see a stream below me" (while lost) and
  for "we need to drink from this stream": wrong card.
- The shock card for "my friend tripped and landed on her wrist": wrong card.
- "stubbed my toe on a rock" opens the sprain card, and "splitting wood at
  camp" gets kindling steps: more than was asked.

The wrong cards are the search picking the wrong card for a statement; the
scorer does not choose cards. Before, Fred said "Got it" or gave the watch
reply to all three.

**Time:** no measurable change on the desktop (the vector is already made;
one extra search on rescued statements). Not measured on the phone.

**Follow-up memory:** the gains are the ones that follow from answering the
first message ("how do i clean it" after the palm; "we don't have a
tourniquet"; "all we have is a tarp and some cord"). The two-turn follow-up
sets were already answered 41 of 41 and did not move. A follow-up whose
first message Fred still does not answer is still read alone.

## Confirmed on chats nobody had looked at (2026-10-07)

`tools/eval/data/holdout-chats-3.json`: 24 chats (37 messages) written after
everything above and committed before the scorer was run on any of them.
Same settings, answers generated. Runs: `scope-scorer/chats-3-runs-{off,on}.jsonl`.

| | Scorer off | Scorer on |
|---|---:|---:|
| Chats whose every reply is the right kind (24) | 15 | **17** |
| Messages with the wrong kind of reply (37) | 13 | **10** |
| Replies better / worse | | 5 / 0 |

Better: the cuts card for "the knife closed on my thumb while i was whittling
a stake" and its rinse lines for "do i need to wash it out"; the wild-plants
card for a bush of dark purple berries (both messages); "stay back" for a bull
elk pawing the ground. All 6 small-talk messages stayed small talk and none of
the 7 should-decline messages got a second chance.

The gain is smaller than on the sets that shaped the design. Four more
messages were scored as needing an answer and still got none, because the
search led with no card for them: hot water over a wrist (0.14), a missed
junction, thunder from a canoe, dry bottles beside a scummy tarn. The scorer
was right about all 37 messages; what it can do with that is limited by the
search.

Seen on this set and the same with the scorer off: a dog's bleeding paw gets
the human bleeding card ("its bleeding a fair bit"), a naproxen dose question
gets the back-injury card, a scraped shin gets the sprain card.

## Tried and rejected

- **A lower gate (0.15) for messages the scorer is sure about.** About 30
  model-written answers from passages under the normal gate: tick-removal
  steps for cactus spines, choking steps for "he threw up" after a head
  injury, "seek emergency medical assistance" for sore knees, petroleum
  jelly for chafing (not in the source). A few were good (thunder on a
  ridge, flash-flood signs) and nothing separated them. The gate stays at
  0.29. What those questions lack is source text that matches them.
- **Overruling small talk early**, before the other rules: it took the
  head-injury card away from "he took a small fall and bonked his head" and
  gave it the knots card from the message before.
- **The reworded search on messages that lean on earlier ones:** "everything's
  soaked though" after a fire question got the soaked-bandage card, and
  "he's getting kind of shaky" about a diabetic the hypothermia card.
- **Search-only framings** (question-answering prompt for the embedder,
  joining the previous message always): 0.68-0.75 separation, no better than
  the search score.

## How the sets were used

Three rounds were run on all sets before the final code, and what they
showed shaped it (the rejected parts above, the berry rule, the leaning
rule, childbirth and surgery as always declined). 93 small-talk and 68
other training messages were added after round one showed which kinds were
missing; none copies an eval message, but the sets told me which kinds to
write. So the numbers above are after fixes the sets prompted, and should be
confirmed on messages nobody has looked at. Grading: one grader, Claude, who
wrote the change, and not blind in practice.

## Open

- In the app since 2026-10-07 (weights in `scope-model.ts`; a
  `devhooks-no-scope` file turns it off for field tests). Phone check below.
- Wrong card for a statement (wrist, stream): a search problem. A scorer
  trained per card on example messages is the same idea one step further,
  and it would need about 15 example messages per card.
- Everyday ailments (chafing, sunburn, sore knees) still decline: the
  sources do not cover them well.

## Reading

- Six signals for answerability, none beats cosine: https://dev.to/gde03/relevance-is-not-answerability-six-signals-and-none-of-them-beat-plain-cosine-2f14
- Two axes of abstention (a probe sees answerability, confidence does not): https://arxiv.org/abs/2607.08456
- ELOQ, a trained probe beats prompting for out-of-scope questions: https://arxiv.org/abs/2410.14567
- Prompt-based abstention fails in small frozen RAG models: https://arxiv.org/pdf/2608.22228
- Out-of-scope intent detection from sentence embeddings: https://arxiv.org/html/2405.19967v2
- Conversational dense retrieval (ConvDR): https://arxiv.org/abs/2105.04166
