# Fred's question types and failure causes, from the repo's own eval data

Scope: read-only analysis of `tools/eval/data/*.json` and the graded runs in `docs/`. No models or app were run, and no external service was accessed. All counts below are mine unless a file is cited for them. The category labels (a/b1/b2/c/d) are my hand labels: one reader, one pass, not blind. Paths are relative to the repo root `/Users/wstmntstud/Code/fred`.

**Classification rule used throughout**

- **(a) Simple lookup.** One topic or condition, and one reviewed passage or card states the answer. Symptom descriptions that point to a single condition ("eyes burn after snow, what is this?") count as (a), and so do casual wording and urgency ("plane is going over").
- **(b) Situational / multi-part.** The message carries a constraint (who, where, what's missing, what else is happening) that changes the standard answer, or it asks for a judgement between options. I split it in two:
  - **b1, one qualifier.** A single qualifier, where the modified answer still sits in one passage or card: infant CPR, packing a *belly* wound, melting snow with *no stove*, finding north when you *can't see the Big Dipper*.
  - **b2, multi-factor or judgement.** Two or more facts must be combined, or a trade-off has to be weighed, and no single passage gives the answer: stay or walk out, when to turn back from a summit, a child who fell on his belly "but looks ok", dressing for "warm now, cold on the summit", a smoke column a few ridges over.
- **(c) Identification / comparison.** Identify something from its features ("what does buttonbush look like", "berries that look like blueberries, safe?"), list which species fit ("anything edible in a marsh"), or compare two options ("roast or boil", "ice or snow", "bend or straight stretch", "pepper spray instead of bear spray").
- **(d) Out of scope.** The set expects a decline. Questions that expect "ask for a location" are counted apart as **loc**.

**Which answer files I used:**

- Held-out set: `docs/holdout-runs-2026-10-06-shipped.jsonl` with `docs/holdout-verdicts-2026-10-06-shipped.json`, the 73.8% figure.
- Breadth set: `docs/breadth-runs-new.jsonl` with `docs/breadth-verdicts.json`. This is the 2026-09-27 pipeline, scores only, no per-answer reasoning.
- Assembled sets: `docs/c23/assembled-shipped.jsonl` and `docs/c23/assembled-sealed-after.jsonl`, with `docs/assembled-verdicts.json` and `docs/assembled-sealed-verdicts.json`. These verdicts carry a grader "cause" label.

How each answer's source was assigned:

- **Card:** `cardAnswer: "verbatim"`.
- **Quote:** an answer with `promptTokens == 0` and no card. This is my heuristic, and on the assembled sets it probably counts some quotes as model answers.
- **Model:** everything else answered.

---

## Q1. How are the questions split between lookup, situational, identification and out of scope?

### Takeaway
About 68% of the answerable single-question items are simple lookups and 22% carry one qualifier (b1). Only **5 of 139 answerable items (3.6%) need real multi-factor combination or judgement (b2)**. Of the 4 sets graded per answer, the "assembled" sets have the most situational questions, and even there b2 is 2-4%. The chat sets are much more situational (about 77 of 427 chats), but they are graded mostly on routing, not on reasoning.

### Cited Findings

**Counts per graded single-question set** (hand labels; source per answer from the run files; score on the rubric, full = 1 and partial = 0.5):

| Set (n) | (a) lookup | b1 one qualifier | b2 multi-factor | (c) ID / compare | (d) out of scope | loc |
|---|---|---|---|---|---|---|
| Held-out (40) | 24 (60%) | 5 (12%) | 1 (2%) | 1 (2%) | 8 (20%) | 1 (2%) |
| Breadth (57) | 37 (65%) | 6 (11%) | 1 (2%) | 4 (7%) | 7 (12%) | 2 (4%) |
| Assembled, working (45) | 18 (40%) | 11 (24%) | 1 (2%) | 0 | 15 (33%) | 0 |
| Assembled, sealed (45) | 15 (33%) | 9 (20%) | 2 (4%) | 4 (9%) | 15 (33%) | 0 |
| **All four (187)** | **94 (50%)** | **31 (17%)** | **5 (2.7%)** | **9 (4.8%)** | **45 (24%)** | **3** |
| Answerable only (139) | 68% | 22% | 3.6% | 6.5% | — | — |

Sources: [held-out questions](tools/eval/data/holdout-firstaid.json), [flora-fauna](tools/eval/data/holdout-flora-fauna.json), [survival](tools/eval/data/holdout-survival.json), [negative](tools/eval/data/holdout-negative.json); [breadth](tools/eval/data/holdout-breadth.json); [assembled](tools/eval/data/assembled.json); [assembled sealed](tools/eval/data/holdout-assembled.json).

**Examples of each class:**

- **(a) lookup:**
  - "How long do I hold pressure on a hemostatic dressing?"
  - "What does a saddle mean on a topo map?"
  - "a bee got my daughter on the arm, what should I do"
  - "I've been hiking on snow all day and now my eyes burn… What is this?" (symptom to one condition)
- **b1, one qualifier:**
  - "Do I use both hands to do CPR on a baby?"
  - "Can I pack a wound in someone's belly to stop the bleeding?"
  - "Someone is unresponsive but I think they fell. Should I tilt their head back…?"
  - "i cant see the big dipper tonight. any other way to find the north star"
  - "whats the quickest way to turn snow into drinking water with no stove"
- **b2, multi-factor or judgement:**
  - "I'm lost. Am I better off staying put or walking out?" (hs-staymove-01)
  - "My 6 year old fell off a rock ledge onto his stomach. He says his tummy hurts but he looks ok. Should I worry?" (br-kidbelly-01)
  - "we can see a big smoke column a few ridges over. what should we do" (as-smoke-01)
  - "its warm now but will be cold on the summit. how should i dress" (az-layers-01)
  - "how do we decide when to give up on the summit and head back" (az-turnback-01)
- **(c) identification / comparison:**
  - "Is there anything edible in a marsh in California?"
  - "What does buttonbush look like?"
  - "Found some berries that look like blueberries. Safe to eat?"
  - "is it better to melt ice or snow for water"
  - "can i just bring regular pepper spray instead of bear spray"
- **(d) out of scope:**
  - "What's a good recipe for sourdough starter?"
  - "How many milligrams of ibuprofen can I give a 30 kg child?"
  - "which garmin watch has the best compass"

**Sets graded only in aggregate.** I read each question once and counted roughly, without a tally script:

- [holdout-everyday.json](tools/eval/data/holdout-everyday.json), 40 questions: about 27 (a), 4 b1, **2 b2**, 1 (c), 6 (d).
  - b2: "afternoon storms keep rolling in… how do we plan around that" and "how long will a 10 mile hike with 3000 feet of climbing take me". The second is the only question in the repo that needs arithmetic.
  - b1: "we were cooking in the tent and now my girlfriend has a pounding headache", which has to be combined into carbon monoxide.
- [holdout-colloquial.json](tools/eval/data/holdout-colloquial.json), 36 questions: about 25 (a), 4 b1 (e.g. "my diabetic buddy is all shaky and sweaty and not making sense"), 0 b2, 1 (c), 6 (d).

**Chat and conversation sets.** I counted from each chat's `kind` field over 23 files and 427 chats:

- **b1-like, about 33 chats:**
  - "contraindication": 19, e.g. "it got my buddy on the ankle / its puffing up fast should i wrap it tight with ice"
  - "adds-context": 10, e.g. "how do i start a campfire / all the wood around here is damp"
  - "altitude": 4
- **b2-like, about 44 chats:**
  - "second-person": 13, e.g. "my daughter just got stung… / and while i was dealing with that i grabbed the hot pot handle and burned my palm"
  - "long" chats with facts planted early that matter late: 27. One is l-diabetic-dad: "he's diabetic btw" … turns later … "he's getting kind of shaky / and sweaty, and he's not making much sense".
  - 4 phone chats
- **The rest test routing:** small talk, help-now, card choice, pets, falls and out of scope.

Sources: [holdout-chats.json](tools/eval/data/holdout-chats.json), [holdout-chats-11.json](tools/eval/data/holdout-chats-11.json), [holdout-chats-14.json](tools/eval/data/holdout-chats-14.json), [holdout-long.json](tools/eval/data/holdout-long.json), [chats-phone.json](tools/eval/data/chats-phone.json).

**How Fred did on the multi-turn situational sets.** On the sealed long-chat set (12 chats of 10-18 messages, written to plant facts that matter later), "turns that should be answered, answered well" went from 19 to **34 of 48** with conversation memory. On its confirmation set it went from 8 to 10 of 14 — [docs/results-conversation-memory.md](docs/results-conversation-memory.md).

**The assembled sets were written on purpose to be harder.** They are "30 questions the sources answer in other words or across passages, and 15 look-alikes" — [docs/results-assembled-grade.md](docs/results-assembled-grade.md). That explains their higher b1 share, but b2 stays at 1-2 per set.

### Inferences
- The single-question evals are almost entirely one-passage lookups. Even counting b1 as "situational", **91% of answerable items are a/b1/c, which one reviewed passage or card can answer in full**. True multi-step items number 5 (plus 2 in the everyday set), too few to measure a reasoning feature on: one answer is 20 points of b2 accuracy.
- b1 questions are lookups at the right *granularity*. The answer exists in one passage, but retrieval and the card have to respect the qualifier (baby, belly, no stove, can't see the Big Dipper). That is a lookup-fidelity problem more than a reasoning problem.
- The chat sets are where situational content lives. The "long" and "second-person" chats are the closest thing in the repo to the questions where combining facts matters.

### Gaps
- One rater, one pass, not blind. The b1/a and b2/b1 borders are judgement calls. I put "My friend fell a long way and has bad pain around his hips" in (a) and the belly-fall question in b2, for example. A second rater would probably move ±3-5 items between a and b1. I'd expect b2 to stay under 5%.
- I did not hand-label the ~30 other single-question JSON sets: tuning sets (graded-*.json), opener-*, holdout-hazards*, health, ailments, wildlife, states, card-questions and said-as.json. They may differ. `graded-*.json` is the tuning set and was not examined.
- The chat-set counts come from `kind` labels, not from reading every turn.
- I found no external taxonomy of hiker questions in the repo. I did not search the web, so I cite no outside source on question taxonomies.

---

## Q2. What caused the failed or partial answers?

### Takeaway
Across 66 shortfalls in the held-out, breadth and assembled sets, the leading causes are retrieval and routing (25, 38%) and reviewed text that is on topic but doesn't hold the specific answer (15, 23%). Next come thin or omitting model answers with the right passages in hand (15, 23%), drift from the source (7, 11%), model declines with the right passage (3) and one off-question answer. **No shortfall is a model that had the right facts and reasoned badly across them.** The 4 b2 failures all broke *before* generation: wrong card, wrong quote, a search decline, or a model decline.

### Cited Findings

**Cause counts.** Held-out and assembled use the grader's reasoning and cause labels. Breadth has no per-answer reasoning, so those causes are **inferred** from the answer text, the retrieved sections and the key points.

| Cause | Held-out (15) | Breadth (24) | Assembled ×2 (27) | Total (66) |
|---|---|---|---|---|
| 1. Retrieval or routing: wrong card or passage first, nothing above the gate (0.29), or misrouted | 9 | 11 | 5 | **25** |
| 2. Reviewed text on the right topic that doesn't answer the ask (card too general, quote off by a sentence) | 3 | 0 | 12 | **15** |
| 3. Model thin, omitting or garbled with the right passages | 3 | 9 | 3 | **15** |
| 4. Model drift: contradicts the source or adds facts from memory | 0 (1 suspected) | 3 (inferred) | 4 | **7** |
| 5. Model declined with the right passage in hand | 0 | 1 | 2 | **3** |
| 6. Model answered a different question with the right passages | 0 | 0 | 1 | **1** |
| 7. Insufficient reasoning or combination, as the immediate cause | 0 | 0 | 0 | **0** |

Sources: [held-out verdicts](docs/holdout-verdicts-2026-10-06-shipped.json), [breadth verdicts](docs/breadth-verdicts.json), [assembled verdicts](docs/assembled-verdicts.json), [assembled-sealed verdicts](docs/assembled-sealed-verdicts.json).

**Held-out shortfalls** (verdict reasoning quoted; top retrieved sections from the run file):

- **Retrieval or routing (9):**
  - Wrong card, or a nearby passage ranked first:
    - hs-orientmap-01 "line my map up… without a compass": the finding-north card at 0.353.
    - hs-cordage-01: the knots card at 0.3301 beat "NATURAL CORDAGE SELECTION" at 0.3293, a 0.0008 margin.
    - hf-scalp-01: "OPEN HEAD INJURY" first; the "scalp richly supplied with blood vessels" passage is not in the top 4.
    - hs-insects-01: four Wikivoyage bug passages, so "tsetse flies". The manual's disease passage is not in the top 4.
    - hs-movement-01: the Wikivoyage campsite passage first, with the survival "MOVEMENT CONSIDERATIONS" at rank 4.
    - hff-bulrush-01: no bulrush passage found, only grasses "used as food by wildlife".
  - Gate declines: hs-paracord-01 (top 0.268) and hs-survmed-01 (top 0.204).
  - hff-nostate-01: declined where it should have asked for a location.
- **Card on topic but not the ask (3):**
  - hf-airway-01: "how to open the airway… nothing on 'talking means open'".
  - hf-headtilt-01: the jaw lift is step 4, but the card "does not lead with 'no'".
  - hf-woundpack-01: the belly card "never says not to pack the belly".
- **Thin or omitting with the right passage (3):**
  - hff-manzanita-01: coyotes left out, though the top passage holds them.
  - hff-falcon-01: ground squirrels not named as the main prey.
  - hs-gps-battery-01: generic advice. "Replace batteries regularly" looks like general knowledge, which is my inference.

Sources: [shipped held-out runs](docs/holdout-runs-2026-10-06-shipped.jsonl); [METRICS.md "Where the remaining points are"](docs/METRICS.md).

**Breadth shortfalls (inferred causes):**

- **Retrieval or routing (11):**
  - Wrong card: br-kidbelly-01 got the spine card (top 0.18) for a belly injury; br-frostbite-01 got the trench-foot card at 0.45 over frostbite at 0.41.
  - Gate declines: burned palm, wet-weather fire, bee sting, "lost two days, can't think straight", sweating in the cold, sheep sorrel.
  - Read as small talk: "I think I'm lost".
  - Out-of-scope messages answered with a location request: the Benadryl dose and the dog that ate chocolate.
  - results-breadth.md says that in five of these "the right field card was the top search result, just under the gate".
- **Thin with the right passage (9):** tight pressure bandage, tourniquet (also in a military register: "JFAK"), sling, mussels (red tide missed), moon ("Yes, the moon can be used" and nothing more), rope, bow drill, mirror ("secure from enemy observation") and the infected scrape.
- **Drift (3):**
  - br-azimuth-01: the results doc says it answered "from general knowledge ('using a compass')".
  - br-maggots-01: "Maggots… can be dangerous", where the key point says the manual treats them as cleaning dead tissue. I inferred this one.
  - br-tarragon-01: "small, oval leaves" against the key point's "narrow… leaves". I inferred this one.
- **Model decline (1):** br-bugs-01, "I don't have reliable information" with four INSECTS passages retrieved.

Source: [docs/results-breadth.md](docs/results-breadth.md) ("Short generated answers from the manuals are the other weak spot… The model summarizes thinly or answers from general knowledge"); [breadth runs](docs/breadth-runs-new.jsonl).

**Assembled shortfalls** (grader cause labels from [results-assembled-grade.md](docs/results-assembled-grade.md)):

- 7 "a field card on the right topic that does not hold the answer". One example: az-cass-01 "i cant see the big dipper…" got the direction card, "which says to find the Big Dipper".
- 5 "a quote… near the question but does not answer it". In as-crypto-01 the answering sentence "sits two lines above the one quoted".
- 7 model:
  - Drift: as-green-01 "adds generic steps not in the sources"; az-snap-01 "reads as made up"; az-bearspray-01 "Opens 'Yes, but it is not recommended' where the source says no".
  - Omission or garbling: melt, creek speed, tick dryer.
  - Answered the wrong question: as-tinder-01 "lists rocks and steel that make a spark, not material that catches one".
- 3 search found nothing; 2 model declined with the passage in hand; 1 wrong card (the bear card for horses).
- Look-alikes answered: lz-snakeid-01, "a made-up list of Arizona rattlesnakes… names copperheads and cottonmouths" (drift), and la-drytime-01 with campfire card lines.

**What the shipped rule's handoff concludes:** "There is no single cause to fix. The misses are spread over cards that are too general, weak model answers, near-miss quotes and search." A cards-off rerun of the 8 card answers made 6 worse — [docs/results-assembled-grade.md](docs/results-assembled-grade.md).

**Safety defects.** None appear in the current runs ("No safety failures", [METRICS.md](docs/METRICS.md)). In the older norouter pipeline the two held-out safety defects were hf-woundpack-01 and hf-cpr-infant-01 — [docs/results-verifier-test.md](docs/results-verifier-test.md). Both are b1 questions where the qualifier (belly, baby) was not honoured.

**Past attempts to add reasoning made answers worse:**

- Thinking mode changed 24 answers for about -3.5, and added an unsafe one.
- Evidence-first prompting "changes almost everything (27 of 33 first drafts) and nets out worse".
- Every unsafe answer came from a sampled draft.

Sources: [docs/results-deep-thinking.md](docs/results-deep-thinking.md), [docs/handoff-deep-thinking.md](docs/handoff-deep-thinking.md).

### Inferences
- Problems with lookup (retrieval, routing, card or quote granularity) account for about 40 of 66 shortfalls (61%). Weak paraphrase by the generator accounts for about 26 (39%), and most of those are omissions and thinness, not wrong chains of logic.
- One kind of failure recurs: **the constraint was ignored**. A b1 qualifier got dropped by search or by the card: belly, "fell", "can't see the Big Dipper", "without a compass", "everything soaked". 12 of the 31 b1 items fell short. The fix is closer to query understanding and answer-first cards than to multi-step reasoning. A small "honour the qualifier" check, like the handoff's reverse-question idea that tests whether "belly"/"scalp" survive into the answer, targets this directly.
- Six shortfalls would plausibly gain from a reasoning step that reads the situation before search: kidbelly, az-layers, az-turnback, as-smoke, headtilt and woundpack. In every one the immediate break was still at retrieval or selection, so the reasoning would have to steer search or card choice, not write the answer.
- Nothing in these files supports a claim that "the model had the facts and failed to combine them". Combined with the past record (thinking mode and sampling hurt), more free generation looks badly matched to the failures that exist.

### Gaps
- Breadth causes are inferred; that file has scores only.
- Thin versus drift is often unclear without the passage text, because the run files store section names, not passage text. Example: was "hemp, cotton, manila" in the rope answer in a passage?
- I did not read the causes for the 14 long-chat turns not answered well; [results-conversation-memory.md](docs/results-conversation-memory.md) would need a closer read.
- There is a later held-out run, `docs/c23/holdout-runs-2026-11-15.jsonl`, with no verdict file found. The numbers here are the 2026-10-06 grades.
- Handoff experiment 2 asks whether the #21 failures had an off-topic passage ranked first. From the run files:
  - Scalp: yes, "OPEN HEAD INJURY".
  - Cordage: yes, the knots card, by 0.0008.
  - Marsh plants: yes, no bulrush passage at all.
  - Belly-wound packing: the right card was ranked first, but it lacks the answer. The army "APPLICATION OF WOUND PACKING" passage was second (0.42).

---

## Q3. Are situational questions under-represented, and is there real user data?

### Takeaway
Probably yes, at least for single-question scoring. **Every answerable held-out, breadth and assembled question is "corpus-derived"**: written from a passage, so one passage answers it by construction. The repo holds no real-user questions. The 4 "phone" chats were typed by the developer, and the feedback server's ratings (live since 2026-11-19) are not in the repo.

### Cited Findings

**Provenance by set** (from each question's `provenance` field):

| Set | corpus-derived | independent |
|---|---|---|
| Held-out | 31 | 9 (the 8 negatives + nostate) |
| Breadth | 48 | 9 (out of scope and location) |
| Assembled, each | 30 | 15 (look-alikes to decline) |
| Everyday | 0 | 40 |
| Colloquial | 0 | 36 |

Sources: [holdout-breadth.json](tools/eval/data/holdout-breadth.json), [holdout-everyday.json](tools/eval/data/holdout-everyday.json).

**How the breadth set was built:**

- Of its answerable questions, 32 come from "random manual passages… drawn with a fixed seed", and 16 from "general syllabus" topics.
- "I wrote the syllabus questions knowing which cards exist. 3 of 16 echoed card wording and were reworded."
- "The held-out set runs about 5 points above fresh questions."

Sources: [docs/results-breadth.md](docs/results-breadth.md), [docs/METRICS.md](docs/METRICS.md).

**Who wrote and graded the sets.** Claude wrote most of the sets, and Claude also graded them. For the assembled sets: "the grader (Claude, in session) also wrote the questions and key points" — [docs/results-assembled-grade.md](docs/results-assembled-grade.md).

**`chats-phone.json` is not real-user data.** It is "the four chats typed on the phone on 2026-09-30 (issue #98 comment). Tuned against" — [chats-phone.json](tools/eval/data/chats-phone.json). Those 4 chats are the most situational text in the repo:

- "we're about 2 miles from the car" after a dizzy, pale wife in Joshua Tree.
- "phone at 15% / its getting dark / … i can hear a river / should i follow it down".
- A bear in camp, then "my kid just burned her hand on the stove / it's blistering / should i pop it".

**The phone held-out log is the eval set, not users.** [docs/phone-holdout-2026-10-07.txt](docs/phone-holdout-2026-10-07.txt) is the 40 held-out questions asked on the developer's phone.

**Feedback server.** The ratings server ("the question, Fred's reply and its sources, up or down, the optional… comment") went live on 2026-11-19 on Cloudflare D1. Its data is read with wrangler and is not stored in the repo — [tools/feedback-worker/README.md](tools/feedback-worker/README.md). I did not access it.

**No usage reporting.** "The app reports no usage today… RC-KR1… No invitations sent" — [docs/METRICS.md](docs/METRICS.md). External TestFlight was "Waiting for Review" — [RELEASE-HANDOFF.md](RELEASE-HANDOFF.md).

### Inferences
- Writing questions from passages produces one-passage questions, so the single-question scores mostly measure lookup fidelity. A hiker's real messages are likely to carry more situation: distance to car, phone battery, darkness, a second person hurt, a kid. The developer's own 4 phone chats show this. Four of their 37 turns add a time, distance or resource constraint, and two chats switch to a second casualty. That is a sample of 4 written by one person, so it shows that these message types exist, not how often they occur.
- The chat sets (contraindication, second-person, long, adds-context) already cover situational *forms*. They are graded mainly on whether Fred routed right (card opened, help-now, no dead end), with key points on only some turns. So the repo can't yet say how well Fred *combines* facts in a situation, only whether it opens the right thing.
- Until there are real messages, the share of situational questions in real use is unknown. The feedback data, once the user decides to read it, is the first real source. Thumbs-down rows with comments would show directly whether failures are "wrong topic" or "didn't account for my situation".

### Gaps
- I found no real user questions in the repo, and no external data on what hikers ask (search-and-rescue logs, app logs). I did not search the web, so the under-representation claim rests on the provenance argument and the developer's chats, not on measured user behaviour.
- The feedback D1 database was deliberately not queried, as instructed.

---

## Q4. Which question types are answered by field cards, by the model, and by declines?

### Takeaway
Cards carry the emergencies and the b1 first-aid qualifiers, and they score best. The model writes most (a) lookups (57 of 94), nearly all the identification and comparison questions, and the flora/fauna facts. Declines are mostly correct out-of-scope declines, plus a handful of answerable lookups under the gate. On the held-out set the model writes 17 of 40 replies: 15 (a), 1 b1, 1 (c), and no b2.

### Cited Findings

**Source by class, all four sets combined** (n = 187; source per answer from the run files; quote detection is heuristic, so "model" may include a few quotes on the assembled sets):

| Class | Card | Model | Quote | Decline / chat | Score (rubric) |
|---|---|---|---|---|---|
| (a) lookup, 94 | 25 | 57 | 3 | 9 | 66.5 / 94 (71%) |
| b1 one qualifier, 31 | 12 | 15 | 2 | 2 | 24 / 31 (77%) |
| b2 multi-factor, 5 | 2 | 1 | 1 | 1 | 1.5 / 5 (30%) |
| (c) ID / compare, 9 | 3 | 6 | 0 | 0 | 6.5 / 9 (72%) |
| (d) out of scope, 45 | 1 (look-alike) | 1 (look-alike) | — | 40 declined, 3 asked for a location | — |

**Held-out in detail** (matches [METRICS.md](docs/METRICS.md): 17 model, 12 cards, and the rest declines or a location request):

- **(a), 24 questions:**
  - 7 cards, 6 / 7: snow blindness, concussion, airway (partial), CPR, anaphylaxis, pelvis, cordage (partial).
  - 15 model, 11.5 / 15: 9 full, 5 partial, 1 miss.
  - 2 declines: paracord and survival medicine.
- **b1, 5 questions:**
  - 4 cards, 2 / 4: belly packing (partial), infant CPR (full), head tilt (partial), map orientation (miss).
  - 1 model, the spoiled fish (full).
- **b2:** the lost card, stay or move (full).
- **(c):** the model, marsh plants (miss).
- **(d):** 7 declined and 1 asked for a location (houseplant); loc: 1 declined.

**Breadth:**

- (a): 13 card, 18 model, 5 decline, 1 chat.
- b1: 4 card, 1 model, 1 decline.
- b2: 1 card (kidbelly, wrong card, 0).
- (c): 3 model, 1 card.
- All four breadth wins came from cards opened by intent — [docs/results-breadth.md](docs/results-breadth.md).

**Card answers are fast.** On the phone, card answers average 3.7 s against 15.3 s for model answers — [docs/METRICS.md](docs/METRICS.md).

**Reasoning would reach only model-written answers.** "Only 17 of 40 held-out replies are written by the model, so even a perfect checker touches less than half of Fred's answers" — [docs/handoff-deep-thinking.md](docs/handoff-deep-thinking.md).

### Inferences
- The model mostly handles (a) and (c) fact questions: plant and animal natural history, map reading, manual procedures. Its losses there are omission and thinness (Q2 causes 3-4), so a grounding or omission check fits better than a reasoning chain.
- Situational b1/b2 first-aid questions mostly land on **cards**. A model-side reasoning mode would not touch them unless it changed *which* card opens, or added a short qualifier-specific line in front of the card. The card-side fix the metrics file already suggests ("cards could carry a short direct answer per common question") targets the b1 card shortfalls: belly packing, head tilt, airway, Big Dipper, soaked wood.
- b2 has the lowest score (30%), but n = 5. 4 failed, and the 1 pass was a card. On this evidence, b2 is a retrieval and selection problem, and there are too few such items to justify building or measuring a reasoning feature on. A b2-heavy eval set would be needed first, ideally seeded from real messages.

### Gaps
- Splitting quotes from model answers on the assembled sets uses `promptTokens == 0`. The grade doc counts at least 5 quote-off answers plus several correct quotes, so my model counts there are probably a few too high.
- Assembled rubric totals from my script (about 36.5) differ by about 1 point from the doc's 35.5, probably from how no-verdict declines or look-alikes are counted. Per-class scores are ±1.
