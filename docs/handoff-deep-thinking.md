# Handoff: deep thinking, round 3 (research)

Written 2026-11-20 on the Mac for the main machine, which owns the accuracy
work (#233, #21, #37). Research only: no code changed and nothing was
measured. **This replaces the first version of this note** (#255), which only
covered checking the answer.

- The full report is below the line.
- Round 1's report and notes (checking the answer) are in
  [`deep-thinking/research-2026-11-20/`](deep-thinking/research-2026-11-20/).
- Round 2's notes (the four paths, plus Fred's own question types) are in
  [`deep-thinking/research-2026-11-20-paths/`](deep-thinking/research-2026-11-20-paths/).

## Short version

**Fred's measured failures aren't reasoning failures.** Of 66 graded
shortfalls, none was the model having the right facts and combining them
badly:

| Cause | Shortfalls |
|---|---|
| Search or routing | 25 |
| A card or quote on the right topic without the answer | 15 |
| Thin or incomplete model answers | 15 |
| Drift from the passages | 7 |
| Declines with the answer in hand | 3 |
| Off-question | 1 |

Only 5 of 139 answerable questions (3.6%) need multi-factor judgement. The
commonest repeated failure is a **dropped qualifier** ("belly", "baby", "can't
see the Big Dipper"). 12 of 31 such questions fell short, and both past safety
defects were this kind.

So a mode that buys longer reasoning would solve the wrong problem, and it
would bring back the sampling that produced every unsafe answer so far. The
four paths, honestly labelled:

| Path | What it buys | Verdict for December |
|---|---|---|
| 0 · Check the greedy answer | More **careful**, not smarter | Yes: cheap and safe, the base of any deep mode |
| 1 · Qwen3-4B-Instruct-2507, greedy, **no thinking**, deep mode only | A smarter **reader** | Screen it on the desktop first: the cheapest test of whether misreadings come from model size |
| 2 · Fine-tune the 1.7B (RAFT-style LoRA) | A smarter reader at today's size | One run only, and only if the 4B screen shows size matters |
| 3 · Structured reasoning in code | Safe combination for real situations | Build a situational test set first, then 1–2 cells if it calls for them |

The biggest buckets (search and routing, 25; card granularity, 15) sit
outside all four paths. They're fixed in normal mode: search work, and
answer-first card lines for qualifiers.

**The honest label for an opt-in mode is "slower and more careful", not
"thinks harder".** Unless the test sets change that, no button should promise
reasoning.

## Sequence (RC is due 2026-12-09)

1. **Nov 20–24.** Path 0 checker script on the archived drafts. Pass: every
   unsafe draft scores below its greedy sibling, and no more than about 3 of
   the 22 acceptable answers are flagged. Also run a qualifier check on the 12
   single-qualifier (b1) shortfalls and on 12 good b1 answers.
2. **Nov 21–26.** Build a situational test set of about 40 items, from the
   four phone chats, the second-person and long chat sets, and (Ryan's call)
   the feedback thumbs-down rows. Vary each item by distance, time, negation
   and patient. Grade today's Fred on it.
3. **Nov 25–Dec 1.** Path 1 desktop screen: Qwen3-4B-Instruct-2507 Q4_K_M,
   greedy, on the oracle test (18) and the tuning set. Also screen
   Pleias-RAG-1B on the oracle test. Pass: more accepted answers than the
   1.7B, no new red flags, and no more declines.
4. **Dec 1–7, only if 3 passed.** Phone bench on the Nothing Phone (3): an
   answer in 60 s or less, peak memory 5 GB or less, and throttling recorded
   over 5 answers back to back. Then a parts-only download entry (the
   schema change below) and held-out confirmation.
5. **Dec 1–10.** Answer-first qualifier lines on the b1 cards (belly, head
   tilt, airway, Big Dipper, soaked wood). Path 3 cells only if step 2's set
   calls for them.
6. **Dec 8–15.** Freeze deep mode: the shipped second search plus the checker
   gate, with the 4B only if it passed. A fine-tune only if step 3 showed a
   size gain and time remains; otherwise write it up as future work.

## Decisions that are Ryan's

- **Whether to offer a 4B pack at all.** About 2.5–3 GB extra, gated to
  iPhones with 8 GB or more and Android phones with 12 GB or more. An
  estimated 35–55 s per answer plus a 10–15 s model swap, and heat.
- **Whether to read the feedback rows** to seed the situational test set.
  They're real tester data, so the privacy policy's "used only to improve
  Fred" applies.
- **The teacher model for any fine-tune.** As the notes report it (not legal
  advice):
  - DeepSeek-R1's card says MIT and allows distillation.
  - Qwen3-235B is listed as Apache-2.0, but only on a secondary site.
  - The OpenAI, Anthropic and Gemini terms bar building competing models, and
    whether Fred "competes" is unclear. Don't use them to write training data.
  - WHO text (CC BY-NC-SA) may carry its terms into a fine-tune, so train on
    the public-domain packs.
- **The button's wording,** whatever ships. It should promise only what the
  mode does.

## Things the main machine should know

- **Downloads above 2 GiB already work.** `map-downloads.ts` joins numbered
  parts into one file, so llama.rn loads an ordinary GGUF. Two small changes
  are needed for a 4B:
  - The join briefly needs about 5–6 GB free.
  - The index's whole-file `asset` field can't exist as one GitHub asset over
    2 GiB, so a parts-only entry needs a small schema change.
- **Experiment 2 from the first version is partly answered.** Scalp bleeding,
  plant cordage (lost by a 0.0008 margin) and marsh plants had an off-topic
  passage or card ranked first. For belly-wound packing the right card came
  first, but it lacks the answer: that's card granularity, not retrieval.
- **Read before writing any snakebite line.** The 2015 WMS pitviper guideline
  couldn't be fetched. It must be read before any line about snakebite and
  distance from help is written. Snakebite's "keep still" and the lost card's
  "moving may be better" conflict, and no card covers being hurt and far from
  help.
- **The labels are uneven.** The question-type labels are one unblinded
  rater's. The breadth set's failure causes were inferred from scores only.
  All figures use the 2026-10-06 held-out grades; the 2026-11-15 run has no
  verdict file.

## Questions for the main machine

1. Are the rounds 1–2 sampled drafts archived with their greedy siblings in
   `docs/deep-thinking/`, so step 1 can run as described?
2. Does the cause breakdown above match your reading of the held-out and
   assembled grades?
3. Does this change the order of #233, #21 and the "safe conversation
   understanding" write-up you have drafted locally?
4. Can the desktop run a 4B (Q4_K_M, about 2.5 GB) for step 3, and is the RTX
   2060 the only GPU if a fine-tune happens?

---

## Report: Make Fred read better before thinking harder

"Real deep thinking" in the sense of longer reasoning traces does not address the failures Fred has actually measured. Of 66 graded shortfalls in the held-out, breadth and assembled sets, **none was a model that had the right facts and reasoned badly across them**. The causes were search or routing (25), reviewed text on the right topic that lacked the specific answer (15), thin or omitting model answers with the right passage in hand (15), drift from the source (7), declines with the answer in hand (3) and one off-question answer. Only **5 of 139 answerable questions (3.6%) need multi-factor judgement** ([local question-type analysis](deep-thinking/research-2026-11-20-paths/fred_question_types.md)). So of the four paths, the one that matches the evidence best is not "think harder" but "**read better and check harder**". Path 0 (checking the greedy answer) stays the safe base of any deep mode. Path 1 (a bigger model) is the cheapest way to find out whether Fred's reading failures come from model capacity, and it should run as **Qwen3-4B-Instruct-2507, greedy, with no thinking trace**. Path 2 (fine-tuning) is the best-evidenced route to a smarter reader at Fred's exact size, but in this window it is realistic only as one supervised experiment. Path 3 (reasoning in code) is the only safe way to handle the rare true multi-factor situations, and it shares its most useful piece, a qualifier and slot extractor, with the fixes for the commonest failure. The recommended order for one developer before mid-December is: build a situational test set and run the checker test first, then a 4B desktop screen on the oracle test, then answer-first card lines for qualifiers. A fine-tune comes only if the 4B screen shows that reading quality is capacity-limited. All outside evidence comes from non-first-aid benchmarks, so each path stays a hypothesis until Fred's own graded sets confirm it.

### Fred fails at lookup and reading, almost never at reasoning

The question mix sets a ceiling on what any reasoning feature can earn. Across the four sets graded per answer, about **68% of answerable items are simple lookups and 22% carry a single qualifier (b1)**, such as infant CPR, packing a *belly* wound, melting snow with *no stove*, or finding north when you *can't see the Big Dipper*. In b1 questions the modified answer still sits in one passage or card. True multi-factor or judgement questions (b2), such as "stay put or walk out", "when do we turn back from the summit", or a child who fell on his belly "but looks ok", number five in total. A single answer is worth 20 points of b2 accuracy, so no reasoning feature can be measured on them ([local analysis](deep-thinking/research-2026-11-20-paths/fred_question_types.md)). b2 scored worst (30%), but all four b2 failures broke *before* generation: a wrong card, a wrong quote, a search decline, or a model decline. The one b2 pass was a field card.

The commonest repeated failure is **a dropped constraint, not a broken inference chain**. Twelve of 31 b1 items fell short, typically because search or the card ignored "belly", "fell", "can't see the Big Dipper", "without a compass" or "everything soaked". Both historical safety defects, belly-wound packing and infant CPR, are b1 questions where the qualifier was not honoured ([docs/results-verifier-test.md](../docs/results-verifier-test.md)). That is a query-understanding and card-granularity problem. The fixes are answer-first card lines and a check that the qualifier survives into the answer.

The model-side failures are real, but they are failures of *reading*. In the oracle test, the shipping model was given the right passage plus three distractors for 18 previously wrong answers. Only **6 of 18 became acceptable**. Of the 12 that still failed, 3 declined with the answer in hand, 4 were incoherent or off-question, 4 were incomplete, and one gained a new safety flag (elevate the limb for bleeding). The author's own reading was that "the rest is the model being unable to reliably turn a correct passage into a correct answer" ([docs/results-strategy-research.md](../docs/results-strategy-research.md)). This is the opening for Paths 1 and 2. A more capable reader is "genuinely smarter" in the way Fred needs, namely keeping the "not", naming the coyotes the passage lists, and not inverting choking first aid. None of that requires a long reasoning trace, and Fred's record says traces hurt. Qwen3 thinking mode netted about −3.5 on 24 changed answers and added "campfire smoke can be used for water purification" ([docs/results-thinking.md](../docs/results-thinking.md)). Across the deep-thinking rounds, **every unsafe answer came from a sampled draft, never the greedy one** ([docs/results-deep-thinking.md](../docs/results-deep-thinking.md)).

Two limits on this diagnosis matter. First, every answerable held-out, breadth and assembled question was written *from a passage*, so one passage answers it by construction. Claude wrote and graded most sets, and the labels are one unblinded rater's. Situational questions are therefore probably under-represented. The developer's four phone chats show "phone at 15%, it's getting dark, I can hear a river, should I follow it down" kinds of messages. The ratings server that went live on 2026-11-19 is the first real-user source, and it has not been read ([tools/feedback-worker/README.md](../tools/feedback-worker/README.md)). Second, model-side fixes reach only model-written replies: **17 of 40 held-out answers**. Cards carry most of the situational first aid ([docs/handoff-deep-thinking.md](../RELEASE-HANDOFF.md)).

### Four paths, one table

The table weighs each path against Fred's pass rule of zero new unsafe answers and a single developer with roughly three and a half weeks. Phone figures are for the binding device, the Nothing Phone (3) running on CPU, where today's written answer takes 15.3 s and a card 3.7 s ([docs/METRICS.md](../docs/METRICS.md)). Figures marked as estimates are scaled from measurements, not measured.

| | 0 · Check the greedy answer | 1 · 3-4B model in deep mode only | 2 · Fine-tune the 1.7B | 3 · Structured reasoning in code |
|---|---|---|---|---|
| What it buys | More careful: catches drift and off-question answers, then falls back to reviewed text | Smarter reading: fewer omissions, inversions and declines with the answer in hand | Smarter reading at today's size and speed, plus Fred's voice | Correct combination for situations, built from reviewed lines only |
| Evidence, model sizes | 0.1-0.8B checkers near gpt-4o on LLM-AggreFact; 0.6B reranker | Qwen3-1.7B→4B: +13 MuSiQue, +5 ConFiQA; CPU RAG correctness 0.58→0.71 | FaithRL on Qwen3-1.7B itself: accuracy 69→74; RAFT/FRONT at 7B only | Untuned decomposers ≤3B fail; tree-walking proven with GPT-4o; rule tools triage more safely |
| Phone cost | +5-10 s; +0.1-0.6 GB | Estimate: ~35-55 s non-thinking, 1.5-4.5 min thinking; ~2.5-3 GB download; 4.2-4.8 GB peak; heat | None if it ships as a same-size GGUF | Near zero; kilobytes of tables; ≤1 short enum generation |
| Safety risk | Low: changes only flagged answers | Moderate: bigger is not automatically safer (Qwen3.5-2B: red flags 3→8) | Moderate-high: benign fine-tuning erodes safety; outcome rewards cut faithfulness | Low per reviewed cell, but a wrong branch sounds authoritative |
| Effort by mid-Dec | 1-3 days | 2 days desktop + 2-3 days phone | ~10 days for one SFT run; RL out of reach | Days per cell + review; tens of items |
| First experiment | Score archived unsafe drafts against their greedy siblings | 4B-Instruct-2507 on the oracle test + tuning set | Screen Pleias-RAG-1B, then one RAFT-style LoRA | Situational vignette set, then 1-2 template cells |

#### Path 0: checking is quality control, and it still earns its place

The earlier recommendation still holds, and it should be named for what it is: **quality control, not deeper reasoning**. It cannot make the model know or combine anything new. It decides whether the greedy answer stands, and otherwise routes to a field card, a quote or a decline. Purpose-trained checkers of Fred's size are strong on general LLM output. **FactCG-DeBERTa-L (0.4B) averages 75.6 and MiniCheck-Flan-T5-L (0.8B) 75.0 on LLM-AggreFact, against 75.9 for gpt-4o** ([LLM-AggreFact](https://llm-aggrefact.github.io/)). HHEM-2.1-Open, at about 0.1B, needs under 600 MB ([HHEM card](https://huggingface.co/vectara/hallucination_evaluation_model)). Plain NLI, the kind Fred tested and rejected, scores about 61 ([MiniCheck](https://arxiv.org/html/2404.10774v2)). The checker targets the 7 drift shortfalls and the sampled-draft failures. A reverse-question or qualifier check targets the off-question answers and, more importantly, the dropped-constraint b1 failures. Its limit is fundamental: a checker measures *support by a passage*, not danger. It passes a supported but misapplied answer, such as an adult procedure for an infant.

**First experiment and pass rule.** This is a desktop script over files that already exist. Score the archived unsafe sampled drafts and their greedy siblings, plus the 31 verifier-test answers, with HHEM, FactCG and MiniCheck. It passes only if **every unsafe draft scores below its greedy sibling** and, at that threshold, the checker flags no more than about 3 of the 22 acceptable answers. Run the qualifier check alongside it on the 12 b1 shortfalls and on an equal number of good b1 answers, and count catches against false rejects. A false reject costs as much as a wrong answer, because a decline scores 0.

#### Path 1: a 4B reader is the cheapest capacity test, and thinking is the wrong way to use it

The published size gap from 1.7B to 4B is largest exactly where Fred's model fails. In OCC-RAG's benchmark (non-thinking scores), Qwen3-4B beats Qwen3-1.7B on **MuSiQue 33.1 vs 20.1, HotpotQA 60.6 vs 47.7, and context-over-memory ConFiQA 69.7 vs 64.8**, with a lower memorisation ratio ([OCC-RAG, arXiv 2606.00683](https://arxiv.org/html/2606.00683)). In a CPU-only RAG study of 17 small models, **Qwen3-1.7B Q4_K_M scored 0.58 correctness and 0.74 faithfulness, and Qwen3-4B-Instruct-2507 (at Q5_K_M) scored 0.71 and 0.80, at 71 s against 205 s for thinking-capable Qwen3-4B** ([Little Brains, Big Feats](https://huggingface.co/papers/2606.30062)). Fred's own 2B trial shows the same capacity effect with a warning attached. Qwen3.5-2B fixed seven baseline failures, including the choking inversion, but lost 32 to 38 overall and **raised red flags from 3 to 8** ([docs/results-qwen35-2b.md](../docs/results-qwen35-2b.md)). None of the published benchmarks is first aid or counts new unsafe claims.

The decisive design choice is **non-thinking, greedy decoding**. The benchmarks say thinking improves short multi-hop faithfulness, but Qwen's own report shows it *degrading* long-context retrieval at 4B (RULER 85.2 non-thinking vs 83.5 thinking) ([Qwen3 report](https://arxiv.org/html/2505.09388)). The model cards also require sampling for thinking: Qwen3.5-4B recommends temperature 1.0 with thinking on by default, and it drops the `/think` switch Fred's harness uses ([Qwen3.5-4B card](https://huggingface.co/Qwen/Qwen3.5-4B)). Sampling is the one mechanism Fred has seen produce unsafe answers three times. On phones, reasoning models also collapse under a one-minute budget: **Qwen3.5-9B (Reasoning) fell to 14 and a non-reasoning Gemma 4 E4B scored 44** ([Artificial Analysis](https://artificialanalysis.ai/articles/mobile-phone-intelligence-inference)). Qwen3-4B-Instruct-2507 fits Fred's rules: it is a non-thinking model, it was the CPU study's production pick, and it shares the Qwen3 family's tokenizer. Qwen3.5-4B should be skipped: it is the same family and architecture as the rejected 2B, and the thinking-tag leak would need re-checking.

The phone cost is real but bounded. Decode is bandwidth-bound, so a ~2.5-2.8 GB model should run about 2.4× slower than the 1.11 GB 1.7B. **The estimates are ~30-35 tok/s prefill (18-35 s for Fred's prompt) and ~7-11 tok/s decode.** The decode figure agrees with 7-8 tok/s measured for Gemma 4 E4B on a Snapdragon 8 Elite CPU ([DEV write-up](https://dev.to/baiju_rajyaguru_a70384dfd/i-ran-gemma-4-on-a-mid-range-android-phone-heres-what-actually-happened-40ge)). A non-thinking deep answer would take about 35-55 s plus a 10-15 s model swap. A 500-1,500-token thinking trace would push it to 1.5-4.5 minutes. Heat makes this worse: Fred's phone reached **86-100 °C on its CPU cores after 82 s of sustained generation** ([docs/results-m3.md](../docs/results-m3.md)). The 1.7B must be unloaded first, giving an estimated **4.2-4.8 GB peak**, which fits a ~6 GB iOS Pro ceiling and 12 GB Android phones. Holding both models would not fit ([docs/results-cold-start-memory.md](../docs/results-cold-start-memory.md)). Download size is **not** a blocker. Fred's download code already fetches large files as numbered parts and joins them on the phone into one file, checked by MD5 ([apps/mobile/src/map-downloads.ts](../apps/mobile/src/map-downloads.ts)). llama.rn therefore loads an ordinary single GGUF, with no split-GGUF support needed. Two small points follow from that code. The join briefly needs room for the parts plus the joined file (about 5-6 GB free for a 4B). And the index's per-file `asset` field, described as "still published beside the parts", cannot exist as one GitHub asset over 2 GiB, so a parts-only entry needs a small schema change. Deep mode should be gated to phones with ≥8 GB on iOS and ≥12 GB on Android, measured at runtime, and kept off for emergency and card intents.

**First experiment and pass rule.** On the desktop, run Qwen3-4B-Instruct-2507 Q4_K_M, greedy, through the existing oracle test (18 answers) and the 100-question tuning set, against the 1.7B baseline under the same configuration. Use the bar the 2B trial set in advance: it must **beat 1.7B on accepted answers, with no new safety red flags and no rise in declines**. If it passes, run a phone bench on the Nothing Phone (3). Require each answer to finish in ≤60 s and peak memory to stay ≤5 GB, and record the throttling over five back-to-back answers. Then run held-out confirmation with deep mode applied only to the answers it would actually touch. The screen is also diagnostic: if a 4B cannot fix the oracle-test misreadings, fine-tuning the 1.7B to fix them is a long shot.

#### Path 2: fine-tuning is the best evidence at Fred's size and the riskiest for December

Fine-tuning is the only path with evidence on **Qwen3-1.7B itself**. FaithRL used a step-level faithfulness reward from HHEM over 8,000 multi-hop examples. It raised Qwen3-1.7B's open-book accuracy **from 69.3 to 73.7, with faithfulness from 90.1 to 91.5**. Plain outcome-reward GRPO *cut* faithfulness to 81.8, and the authors say it "exacerbates hallucinations within CoT" ([FaithRL, arXiv 2602.05897](https://arxiv.org/html/2602.05897)). Two facts follow. Base Qwen3-1.7B was already the most faithful small model in that study, so the prize is accuracy without losing faithfulness. And training that rewards only right answers reproduces the drift Fred saw with thinking mode. Purpose-built small RAG readers prove the format works at ≤1.7B: a structured trace, a cited answer and a refusal branch. Pleias-RAG-1B and OCC-RAG-1.7B got there with **3.1-3.25M training examples on multi-node H100s**, not hobby-scale runs ([Pleias, arXiv 2504.18225](https://arxiv.org/html/2504.18225v1)). OCC-RAG-1.7B matched Qwen3-4B-thinking on faithfulness and refusal in its authors' tables ([OCC-RAG](https://arxiv.org/html/2606.00683)). But in Fred's own screen it wrote 300-900 reasoning tokens (27-59 s on the desktop) and looped once ([docs/results-strategy-research.md](../docs/results-strategy-research.md)). The classic RAFT recipe, one oracle passage plus distractors with chain-of-thought answers, is shown only at 7B. There, removing the reasoning cost 9.66 points on HotpotQA, and training on the golden document alone did worse ([RAFT](https://arxiv.org/html/2403.10131v2)).

The reachable version is a RAFT-style LoRA fine-tune of a few hundred to about 1,500 examples built from the packs. Each example's trace quotes passages by id. It is kept only if **every quote is a literal substring** of a passage and each answer sentence passes an HHEM check. About a fifth of the examples should be distractor-only cases with a "the sources don't cover this" target, and about a tenth should be negation-heavy passages aimed at the inversion defect. A human should review every first-aid item. Training on a 6 GB RTX 2060 or a free T4 should take hours (an unmeasured estimate), and Unsloth exports straight to a Q4_K_M GGUF ([Unsloth GGUF export](https://unsloth.ai/docs/basics/inference-and-deployment/saving-to-gguf)). Faithfulness RL took **29.28 A800 GPU-hours** per run plus a reward server, which puts it outside this window. The safety risk is real: **benign fine-tuning measurably degrades safety alignment** ([Qi et al.](https://arxiv.org/abs/2310.03693v1)). A tuned model would also replace the normal-mode model, not only deep mode. That has an upside, since speed and download are unchanged and every model answer improves. The cost is that the change touches every model-written answer, so it needs the full set of confirmations on the quantised GGUF, not on the bf16 checkpoint.

Teacher licensing, as reported in the research notes (this is not legal advice): the DeepSeek-R1 model card states an MIT licence and **explicitly permits distillation** ([DeepSeek-R1 card](https://huggingface.co/deepseek-ai/DeepSeek-R1/blob/refs%2Fpr%2F243/README.md)). Qwen3-235B is listed as Apache-2.0 open weights, but only on a secondary site; the official card was not checked ([llm-stats](https://llm-stats.com/models/compare/deepseek-r1-distill-qwen-7b-vs-qwen3-235b-a22b)). The OpenAI, Anthropic and Gemini API terms each bar using outputs or services to develop competing models ([OpenAI](https://openai.com/policies/business-terms); [Anthropic](https://www.anthropic.com/legal/commercial-terms); [Gemini API](https://aistudio.google.com/docs/terms)). Whether a 1.7B offline field guide "competes" is unclear, and the notes advise a student project not to rely on that ambiguity. Whether Gemma-generated training data makes the student a Gemma "Model Derivative" was not verified. The notes also infer that training on WHO BEC text (CC BY-NC-SA) may carry its terms into the adapter, so public-domain packs are the safer training text. Whoever owns licensing for Fred should confirm all of this before any data is generated.

**First experiment and pass rule.** Before any training, screen Pleias-RAG-1B on the oracle test, the way OCC was screened. It is about 1.2B, Apache-2.0, has a GGUF, and cites with literal quotes, but its context is limited to 4,096 tokens ([Pleias card](https://huggingface.co/PleIAs/Pleias-RAG-1B)). Then, only if the Path 1 screen shows the misreadings are capacity-limited, run one LoRA SFT as described above. The pass rule is the same as for the 4B: the Q4_K_M GGUF must beat base 1.7B on the oracle test and the tuning set with **zero new unsafe answers** on the held-out set and a dangerous-if-wrong list (tourniquet, choking, frostbite, edibility, negations). Training questions must come from passages the held-out sampler never drew. A fail is a reportable negative result.

#### Path 3: structured reasoning in code is the only safe way to combine

For the rare true situations, Fred's code, not the model, should decide the parts and their order. The evidence against letting a small model decompose is direct. In Collab-RAG, an **untuned Qwen2.5-1.5B decomposer scored 32.4 EM on HotpotQA, below the 41.8 of no decomposition at all**, and an untuned 3B barely beat it (44.2) ([Collab-RAG](https://arxiv.org/html/2504.04915v1)). Multi-stage pipelines whose later stages lose sight of the original question dropped up to 40.5 points ([Decomposition Tax](https://arxiv.org/abs/2609.32825)). Wilderness medicine already supplies a fixed scaffold: dangers and ABCs, then condition care, then what not to do, then an evacuation decision along NOLS's spectrum from no evacuation to litter carry ([NOLS evacuation procedures](https://nols.edu/en/filer/public/1485287172/1041)). In triage comparisons, the rule-based Ada had **14% unsafe triage against 41% for ChatGPT-3.5** ([Fraser et al., JMIR mHealth](https://mhealth.jmir.org/2023/1/e49995)). Guideline-tree walkers work, but only GPT-4o has been shown doing it, and they fail on negation: patients who *denied* red flags were still referred, with F1 0.06 on exclusion vignettes ([CPGPrompt](https://arxiv.org/html/2601.03475v1)).

Fred already has most of the machinery. `conditions.ts` sets conditions from fixed phrases, `triage.ts` raises get-help-now only on a listed danger sign, and `card-answer.ts` answers a card verbatim. The addition is a small situation frame: condition, danger signs, remoteness, mobility, who, time. Rules fill the frame, and the model is a greedy one-word fallback for a single empty slot, kept only if the hiker's own words support it. A table maps each cell to reviewed lines, and a reviewed conflict table covers card pairs. The target example shows why the conflict table is mandatory. The snakebite card says to keep the limb as still as possible, while the lost card says moving may be the better choice, and no card covers being injured hours from the trailhead. An unreviewed cell must fall back to today's behaviour, never to a model-written bridge. The extractor's simplest output, "this message carries a qualifier", is the same signal the Path 0 qualifier check and the b1 answer-first card lines need. So the first slice of Path 3 pays off on the commonest failure, not only on the rare one. Two caveats remain. Evacuation guidance is partly expert opinion ([NOLS case study](https://www.nols.edu/?p=742588)). And the 2015 WMS pitviper guideline, which should govern any snakebite-plus-remoteness line, could not be fetched and must be read before such a line is written.

**First experiment and pass rule.** Build a situational vignette set of about 40 items before writing any templates. Seed it from the four phone chats, the long and second-person chat sets, and the feedback server's thumbs-down rows if the developer chooses to read them. Vary each item by distance, time, negation ("no trouble breathing") and patient. Grade today's Fred on it. Build cells only where failures cluster. The pass rule: every combined answer is made only of reviewed lines, a property test shows no unresolved conflict pair, the vignette set shows net fixes with zero new unsafe answers, and every non-situational set stays byte-identical.

### Real deep thinking answers a question Fred's evals do not yet ask

Plainly, Fred's measured failures are not reasoning failures, so an opt-in mode that buys reasoning tokens would be solving the wrong problem. It would add the sampling and drift that have already produced unsafe answers. What the evidence supports is a split between careful and smarter. Path 0 makes Fred careful and touches the 7 drift and 1 off-question shortfalls, plus dropped qualifiers if the reverse-question check works. Paths 1 and 2 make Fred a smarter *reader* and target the 15 thin or omitting answers, the 3 declines with the answer in hand, and the oracle test's inversions. Neither should use a thinking trace. Path 3 is the honest form of "situational reasoning": it handles b2 and the qualifier problem with reviewed logic. The largest buckets, search and routing (25) and card granularity (15), lie outside all four paths. They are fixed with search work and answer-first card lines in normal mode, where they help every user and not only those who opt in.

The open question is whether real hikers ask more b2 questions than Fred's passage-derived evals suggest. If the feedback data and the vignette set show many situational failures, Path 3 becomes the main deep-mode feature. The case for a bigger model strengthens only if those failures turn out to be reading failures rather than missing reviewed content.

| Dates (2026) | Step | Decision it feeds |
|---|---|---|
| Nov 20-24 | Path 0 checker script on archived drafts; qualifier check on the 12 b1 shortfalls | Does deep mode get a checker gate? |
| Nov 21-26 | Situational vignette set; optional read of feedback rows | Is b2 rare in reality, or only in the evals? |
| Nov 25-Dec 1 | Path 1 desktop screen: 4B-Instruct-2507 greedy on the oracle test + tuning set; Pleias-RAG-1B on the oracle test | Are misreadings capacity-limited? |
| Dec 1-7 | If the 4B passed: phone bench, parts-only download entry, held-out confirmation. If not: stop Path 1 | Optional 4B pack, or none |
| Dec 1-10 | Answer-first qualifier lines for the b1 cards (belly, head tilt, airway, Big Dipper, soaked wood); 1-2 Path 3 cells only if the vignettes demand them | Normal-mode fixes plus a first situational cell |
| Dec 8-15 | Freeze deep mode: the shipped second search + checker gate (+ 4B only if it passed). One LoRA SFT run only if the 4B screen showed a capacity gain and time remains; otherwise write it up as future work | What ships mid-December |

### Conclusion

The useful reframing is that "deep thinking" was always a proxy for "better answers when it matters", and Fred's data says better answers come from *where the text comes from*, not from how long the model deliberates. Every safe gain so far has drawn on reviewed text or greedy output and acted only where the normal path had visibly failed. The four paths line up behind that rule rather than against it. Checking and code-side structure keep the model from adding unreviewed claims. A bigger or tuned reader is worth having only as a better reader with no trace. The 4B desktop screen is the cheapest experiment with the largest information value, because its result decides whether fine-tuning, a 2.5 GB pack, or neither deserves the remaining weeks.

The second implication is about measurement, not models. The evals were written from passages and graded by the same hand that wrote them, so they cannot yet show whether Fred fails real hikers at combining facts. A 40-item situational vignette set and the first feedback rows will settle that faster than any architecture change. Until they do, the honest label for an opt-in mode is "slower and more careful", not "thinks harder".
