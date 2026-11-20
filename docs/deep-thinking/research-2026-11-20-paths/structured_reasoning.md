# Structured reasoning in code, not in the model: decomposition, protocols and slot-driven answers for Fred

Researched 2026-11-20. Scope: approaches where Fred's code, not Qwen3-1.7B's free generation, decides how a situational, multi-part question ("I got bitten by a snake and I'm 3 hours from my car") is broken up, which reviewed text answers each part, and how the parts are put together. Nothing here is medical advice. It describes system designs only.

Fred context, from local files (not web sources):
- 44 reviewed field cards in `corpora/cards/cards.json` (fields: id, title, domain, medical, askedAs, summary, steps, dont, getHelp, reviewerNote, sources).
- `packages/rag-core/src` already does a lot of rule-based reasoning: `conditions.ts` (conversation conditions such as snakebite, set by fixed trigger phrases and never by the model, and each card's "must not follow" list), `triage.ts` (get-help-now only on a positive danger sign drawn from the WMS/NOLS "go fast" list), `intent.ts` (one-word now/question/prevent/chat from the model, with word rules for prevention), `understand.ts` (one model call that returns an intent and a search request, used only to search), `router.ts` (keyword lexicon pack routing), `scope.ts` (a linear scorer on the search vector), `card-answer.ts` (a card answered verbatim, with the model only picking step numbers and the don'ts and get-help line always kept).
- `docs/results-deep-thinking.md`: every unsafe answer in the deep-thinking runs came from a sampled draft (T=0.6). Only the greedy, gated second search passed (+1.5 on 275 questions, no unsafe answers).
- The target example shows a real combinatorial gap. The Snakebite card says "Keep the person as still and calm as you can... keep the limb as still as you can". The "Lost: should I stay or keep moving?" card has no getHelp line and nothing on walking out injured. No card covers "injured and far from the trailhead". Combining the two cards naively puts "keep still" next to "moving may be the better choice". This is exactly the conflict a combiner has to catch.

## 1. Query decomposition and plan-then-retrieve with small models: do ≤3B models decompose reliably?

### Takeaway
They don't, unless they are fine-tuned. In the best measured case (Collab-RAG, COLM 2025), an *untuned* Qwen2.5-3B decomposer barely beat no decomposition on HotpotQA and lost on MuSiQue. Untuned 1.5B was much worse than no decomposition. Only a 3B model fine-tuned with large-model feedback matched a 32B decomposer. All of this is multi-hop Wikipedia QA with a GPT-4o-mini reader, not a 1.7B reader. For Fred, decomposition should be templated: code picks the sub-questions from a fixed list for the detected situation, and the model at most fills slots.

### Cited Findings
- Collab-RAG (arXiv 2504.04915, April 2025, COLM 2025) uses a small decomposer and a black-box reader (GPT-4o-mini). EM figures: no decomposition (plain RAG) scores HotpotQA 41.8 / MuSiQue 22.6 / 2Wiki 45.0. An **untuned Qwen2.5-3B decomposer** scores 44.2 / 22.2 / 50.0. A frozen Qwen2.5-32B decomposer scores 52.0 / 25.4 / 62.0. Fine-tuned Collab-RAG 3B scores 51.6 / 25.4 / 63.0, and Collab-RAG 8B scores 53.0 / 26.4 / 63.2. — [Collab-RAG, arXiv 2504.04915](https://arxiv.org/html/2504.04915v1)
- In the same paper, an **untuned Qwen2.5-1.5B decomposer** reached only 32.4 EM on HotpotQA (below the 41.8 no-decomposition baseline) and 40.2 on 2WikiMQA (below 45.0). — [Collab-RAG](https://arxiv.org/html/2504.04915v1)
- Collab-RAG failure modes: the small model writes "Question 1" instead of the required "#1" back-reference, which hurts retrieval. Over-broad first sub-questions fail to retrieve anything. The reward checks only format and final answer, not the intermediate steps. — [Collab-RAG](https://arxiv.org/html/2504.04915v1)
- The abstract's claim that the 3B model "surpasses a frozen 32B LLM" holds on average but not on HotpotQA (51.6 vs 52.0). The paper's headline gain figures (14.2% / 1.8% / 6.6%) are inconsistent across sections. — [Collab-RAG](https://arxiv.org/html/2504.04915v1)
- An earlier Fred research note (same day) quotes the literature: "Using SLMs directly for question decomposition is often ineffective". — local `docs/deep-thinking/research-2026-11-20/retrieval_methods.md`, citing Collab-RAG
- Question Decomposition for RAG (ACL SRW 2025) splits queries with an off-the-shelf LLM and adds a cross-encoder reranker, evaluated on MultiHop-RAG and HotpotQA. It does not use a ≤3B decomposer (large-model evidence). — [arXiv 2507.00355](https://arxiv.org/html/2507.00355v1)
- DaSLaM separates a small decomposer from the solver and reports fewer decomposition errors, but its solver is 13B. Another paper argues that decomposition is easier to distill into small models than solving is. Neither tests ≤2B end to end. — [DaSLaM, arXiv 2310.18338](https://arxiv.org/pdf/2310.18338.pdf); [arXiv 2402.15000](https://arxiv.org/pdf/2402.15000v1.pdf)
- "The Decomposition Tax" (arXiv 2609.32825, 26 Sept 2026; 21 open models; GSM-Hard and MATH-500) found that multi-stage pipelines whose later stages can't see the original problem lose up to 40.5 accuracy points (gemma-3-12B, MATH-500), and gemma-4-12B still loses 37.0. Rewording one stage's instruction moved the loss from 4.5 to 36.5 points. Fix: "re-ground" the stage after a lossy interface by showing it the original problem again, which won on 7 of 7 models. Math tasks, 12B-class models. — [arXiv 2609.32825](https://arxiv.org/abs/2609.32825)
- Least-to-most prompting (Zhou et al.) was shown on large models. I found no study that measures least-to-most or plan-and-solve prompting at 1–3B. — [arXiv 2205.10625](https://arxiv.org/pdf/2205.10625)

### Inferences
- Fred's reader is 1.7B and untuned, smaller than every decomposer measured above, and it would be both decomposer and reader. The measured trend (1.5B untuned is worse than no decomposition, 3B untuned is about equal) means a free-form "list the sub-questions" prompt is likely to hurt.
- Fred's multi-part questions are not multi-hop (finding A to look up B). They are *multi-aspect*: treat X, decide on getting out, avoid Y. A fixed template per situation handles multi-aspect questions well, and it needs no learned decomposition.
- The Decomposition Tax result supports what Fred already does in `understand.ts` and `pipeline.ts`: whatever a model stage writes, the next stage is checked against the hiker's own words. Any sub-question pipeline should keep the original message attached to every stage.
- Fine-tuning a 1.7B decomposer in the Collab-RAG style needs a large-model teacher, training data and an eval. That's possible, but it costs more than authoring templates for the few dozen situations Fred covers (section 6).

### Gaps
- No measurement of decomposition by Qwen3-1.7B or any ≤2B model on safety or first-aid questions.
- No study compares templated and model-generated decomposition for multi-aspect (not multi-hop) questions.

## 2. Protocol and decision-tree approaches from wilderness and emergency medicine, how CDS encodes them, and evidence that structure beats free text for safety

### Takeaway
Wilderness medicine already teaches a fixed reasoning scaffold: scene size-up, then primary survey (ABCDE/MARCH), secondary survey with SAMPLE history, a SOAP note, and an evacuation decision along a spectrum. Much of the evacuation guidance is expert opinion rather than evidence. Where structured tools and LLMs have been compared on triage, rule-based symptom checkers had fewer unsafe triages than GPT-3.5, though LLMs were more consistent overall. Turning guidelines into trees an LLM walks node by node is well documented, but only with GPT-4-class models.

### Cited Findings
- WFA/WFR training material lays out a Patient Assessment System (primary assessment, secondary assessment, vitals such as level of consciousness and heart rate), the SOAP note, SBAR for radio handoffs, and evacuation red flags, including a "Time" item (note onset, evacuate immediately). It is a training aid, not a formal protocol. — [Mazamas acronyms reference](https://mazamas.org/media/doc/Acronyms_Reference.pdf)
- NOLS evacuation guidance runs along a spectrum: no evacuation, self or assisted walk-out, simple carry, litter carry. Its June 2024 procedures define ALPHA (single life-threatening emergency, urgent response) and BRAVO (stable, transport needed) calls. — [NOLS evacuation procedures PDF](https://nols.edu/en/filer/public/1485287172/1041)
- NOLS case-study text says its suggested evacuation guidelines for abdominal pain "are based on expert opinion", not evidence-based standards. — [NOLS case study: abdominal pain](https://www.nols.edu/?p=742588)
- Wilderness EMS sources list immediate-evacuation triggers: loss of life or limb, deteriorating vital signs, decreasing mental status, severe blood loss, spinal injury. They name communication, distance to definitive care, weather, terrain and the nature of the injury as inputs to the evacuation decision. — [JEMS, "Wilderness EMS has special considerations"](https://www.jems.com/training/wilderness-ems-has-special-consideration/)
- NOLS altitude guidance: suspected HACE or HAPE calls for immediate, rapid descent, an example of a rule from one condition to one action. — [NOLS altitude case study](https://blog.nols.edu/2018/08/15/case-study-altitude)
- Snakebite: the current WMS pitviper guideline (US/Canada) dates from 2015 (Kanaan et al., Wilderness Environ Med 2015;26(4):472-87). No 2024 WMS snakebite update was found. WMS did update frostbite in 2024. — [BMJ Best Practice snake bite topic](https://bestpractice.bmj.com/topics/en-us/945); [WMS frostbite 2024 update, PubMed](https://pubmed.ncbi.nlm.nih.gov/38577729/)
- Symptom checker vs LLM, emergency department patients (JMIR mHealth 2023): the **unsafe triage rate for ChatGPT 3.5 (41%) was significantly higher than Ada's (14%)** (P=.009). ChatGPT 4.0 had lower unsafe triage and the highest triage agreement with physicians, but the poorest diagnostic accuracy. — [Fraser et al., JMIR mHealth 2023](https://mhealth.jmir.org/2023/1/e49995)
- Systematic review (npj Digital Medicine 2025, 19 studies): self-triage accuracy of symptom-assessment apps was 11.5–90.0% (highly variable), LLMs 57.8–76.0%, laypeople 47.3–62.4%. The authors would neither universally recommend nor discourage either tool. — [Kopka et al., PubMed 40133390](https://pubmed.ncbi.nlm.nih.gov/40133390/)
- Semigran et al. (BMJ 2015), the original audit of 23 rule-based symptom checkers on 45 vignettes, is the standard vignette method for testing triage tools (reported figures: correct diagnosis first in 34% of cases, in the top 20 in 58%). — [BMJ h3480, via search summary](https://dash.harvard.edu/server/api/core/bitstreams/7312037d-99f2-6bd4-e053-0100007fdf3b/content)
- CPGPrompt (arXiv 2601.03475, Jan 2026): an LLM converts guidelines or pathway diagrams into JSON trees, which authors validate by hand. At run time an engine walks the tree node by node, asking the LLM yes/no questions ("Does the patient have a thunderclap headache?") and logging each step. Model: GPT-4o (large-model only). Referral recall was 1.00 in all three domains, with F1 0.90 / 1.00 / 1.00, but multi-class pathway macro-F1 was only 0.44–0.77. Failure modes: **negation** (patients who *denied* red flags were referred, F1 0.06 on exclusion vignettes), temporal reasoning (acute vs persistent), borderline values, and stopping the walk early. No free-text baseline. — [CPGPrompt](https://arxiv.org/html/2601.03475v1)
- MedDM builds "LLM-executable clinical guidance trees" from guideline flowcharts, and binary decision-tree prompting (arXiv 2401.11120) navigates guideline trees with GPT-4, GPT-3.5, LLaMA and PaLM 2. Both are large-model evidence. — [MedDM, arXiv 2312.02441](https://arxiv.org/pdf/2312.02441); [arXiv 2401.11120](https://arxiv.org/html/2401.11120v2)
- Oncology decision trees (2024 preprint): giving GPT-4 the guideline text cut hallucinated subtypes from 37.1% to 2.9%, but overall tree accuracy did not significantly improve (72.5%). — [medRxiv 2024.03.04.24303737](https://medrxiv.org/content/10.1101/2024.03.04.24303737v1.full)
- A 2026 guideline-QA study found that free-form rewriting in RAG "can introduce hallucinations and unstable trade-offs between completeness and conciseness" in safety-critical settings, and argued for constrained generation. — [arXiv 2606.12897](https://arxiv.org/html/2606.12897)

### Inferences
- The WFR scaffold maps directly onto a fixed set of answer sections: (1) immediate dangers and the ABC check, (2) condition-specific care (the card), (3) what not to do (the card's don'ts), (4) the evacuation decision (stay, walk out, call). Fred's cards already hold (2), (3) and part of (4) in `getHelp`. What's missing is a reviewed evacuation layer that varies with remoteness.
- CPGPrompt's yes/no node questions are the kind of narrow classification a 1.7B model handles better than open generation. But its main failure, negation, matches Fred's own experience ("I thought I burned myself but it's okay", `intent.ts`). Negation would need rules, not just the model.
- The symptom-checker evidence fits Fred's existing triage rule (`triage.ts`): rule-based tools are more conservative about unsafe triage, and their weakness is coverage, not safety.

### Gaps
- I couldn't fetch the WMS 2015 pitviper text (host unreachable), so I can't cite its exact field and transport recommendations, for example whether a victim should walk out. This matters for the target example and should be checked against the primary paper before any card is written.
- Full NOLS rapid vs non-urgent evacuation criteria were not retrieved (PDF only seen in snippets).
- I couldn't read "Benchmarking Clinical Decision Pathway Adherence in LLMs" (arXiv 2608.26592, 2026): the PDF did not parse. Only its title and authors are confirmed. — [arXiv 2608.26592](https://arxiv.org/pdf/2608.26592)
- No study compares structured-protocol answers and free-text LLM answers on wilderness questions.

## 3. Hybrid designs: the LLM extracts slots under constrained output, code picks the protocol and reviewed text, and each part stays cited

### Takeaway
"The model labels, code decides" is the common pattern in the clinical literature (CPGPrompt, MedDM). Constrained JSON reliably fixes *syntax*, but small models still invent slot values the text never mentions, and their parse rates drop on long or messy input. For Fred, slots should be few, mostly closed-vocabulary (enums), filled first by rules (as `conditions.ts` and `triage.ts` already do), with the model as a fallback for one slot at a time. Every slot value should carry a "said in the hiker's words" check. Grounding then comes for free: each answer section is a reviewed card line with its card id.

### Cited Findings
- Small-model structured output on clinical notes (arXiv 2507.01810, 2025). JSON parse rates without targeted prompting: Llama-3.2-3B 73.8%, Qwen3-4B 95.3%, Phi-3.5-mini 83.2%. With targeted prompts: 94.4%, 97.2% and 99.4%. JSON beat YAML and XML significantly. Size had only a modest effect (14B models averaged 90.3%, 3–4B 80.9%), while prompt type had a larger one (Cramér's V 0.42). Main small-model failure: infinite repetition, which left no recoverable object (19–21% of small and medium model failures). — [arXiv 2507.01810](https://arxiv.org/html/2507.01810v1)
- Grammar-constrained decoding helped fine-tuned generative extractors in low-resource clinical-trial extraction, but generative models "can invent slot fillers" the text never mentions. — [Schmidt & Cimiano 2025, PMC11747381](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11747381/)
- ExtractBench: provider structured-output modes sometimes *lowered* validity (51% to 37% vs prompt-based extraction), and constrained modes support only part of JSON Schema. Large hosted models, not medical. — [ExtractBench, arXiv 2602.12247](https://arxiv.org/pdf/2602.12247)
- SLOT (EMNLP 2025 industry): a fine-tuned Mistral-7B post-processor with constrained decoding reached 99.5% schema accuracy and 94.0% content similarity (7B, general domain). — [SLOT, EMNLP 2025](https://aclanthology.org/anthology-files/pdf/emnlp/2025.emnlp-industry.32.pdf)
- CPGPrompt logs every query, response and branch, so each decision can be traced back to a guideline node. — [CPGPrompt](https://arxiv.org/html/2601.03475v1)

### Inferences (design sketch for Fred, not tested)
1. **Situation frame** (code). A small fixed schema: `condition` (enum of the conditions in `conditions.ts`, rule-set), `danger_signs` (from `triage.ts`, rule-set), `remoteness` (enum: unknown / near help / hours away / days away / no signal), `mobility` (can walk / can't / unknown), `who` (self / other / child), `time_since` (optional). Rules over the hiker's words fill most of these. "3 hours from my car", for example, is a number plus a unit plus a place word.
2. **Model fallback, one slot at a time.** Only a slot that is still empty and that the template needs is asked, as a closed choice ("Is help near, hours away, or days away? Answer one word"), greedy, with a grammar or enum limited to the allowed tokens. Qwen3-1.7B is not in the parse-rate studies above, but one enum token avoids the repetition and malformed-JSON failures seen at 3B. A value is kept only if a lexicon check finds supporting words in the message (the same "must match the hiker's own words" rule as `understand.ts`). If no supporting words are found, the slot stays "unknown" and the template's unknown branch runs. That branch can ask a clarifying question or show both options.
3. **Template selection** (code). A table keyed by (condition, remoteness, mobility) points to answer sections. Each section is a reviewed card id plus line indexes, or a newly reviewed "combination line" written for that exact cell (for example "snakebite + hours from help").
4. **Conflict table** (code, reviewed). This works like the per-card "never when" list. For each pair of cards that may be combined, reviewers record contradictory lines ("keep still" vs "moving may be better") and which line wins in which cell. If a pair has no entry, the combiner refuses to merge them and shows only the primary condition's card plus the danger-sign get-help line.
5. **Assembly** (code). The fixed WFR order: get-help-now line if a danger sign is present, then the condition card (steps, don'ts and get-help always kept, as in `card-answer.ts`), then the evacuation section for the cell, each section labelled with its card title. The model writes nothing new, at most a one-line opener (`opener.ts`).
6. **Determinism.** Greedy decoding everywhere, since every unsafe deep-thinking answer came from sampling (local `docs/results-deep-thinking.md`).

### Gaps
- No measurement of Qwen3-1.7B slot extraction under grammar constraints. llama.cpp-style GBNF grammars exist, but I found no study of their accuracy at ≤2B for medical slots.
- No found study of "program-of-thought" or neuro-symbolic pipelines at ≤2B in a safety domain. The cited structured-reasoning evidence is from 3B–14B extractors and GPT-4-class tree walkers.

## 4. How to tell situational or multi-part questions from simple lookups

### Takeaway
No dedicated literature was found for this at ≤2B. The practical signal is structural: a situational question has a condition **plus** at least one context slot (remoteness, time, mobility, patient type) or more than one condition. Fred's rules can detect both deterministically, with the scope scorer and intent label as a gate.

### Cited Findings
- Collab-RAG and similar systems decompose *every* question in multi-hop benchmarks, with no "should I decompose" classifier. Decomposition helps more on complex queries, and reranking improves recall only modestly. — [Collab-RAG](https://arxiv.org/html/2504.04915v1)
- CPGPrompt routes every vignette through the tree, so it has no simple-vs-complex detector either. — [CPGPrompt](https://arxiv.org/html/2601.03475v1)

### Inferences
- Proposed rule: situational = (a condition is set by `conditions.ts`, or a card matches) AND (a remoteness/time/mobility/patient pattern fires, OR two or more conditions are set, OR intent is `now` with a danger sign). Everything else keeps the current single-card or RAG path. This adds no model call and is testable with paraphrase sets.
- Fred's existing intent labels already split `now` from `question`. Situational framing matters mainly for `now`.

### Gaps
- No published classifier or benchmark for "multi-aspect situational" detection in first aid. Fred would need its own labelled set.

## 5. Risks: wrong slot extraction, combinatorial gaps, over-confident structured answers, and how such systems fail and are tested

### Takeaway
The documented failure modes are negation, temporal reasoning, borderline values, early stopping (CPGPrompt), invented slot values (generative extraction), parse failures and repetition (small models), losses at stage interfaces (the Decomposition Tax), and wide variance in triage accuracy between tools (symptom checkers). The standard test method is vignettes graded for unsafe triage. A structured answer looks authoritative, so a wrong branch is more convincing than a hedged free-text answer.

### Cited Findings
- Negation: CPGPrompt referred patients who denied red flags (F1 0.06 on exclusion vignettes). It also had trouble with acute vs persistent timing and borderline values, and tended to stop the tree walk early. — [CPGPrompt](https://arxiv.org/html/2601.03475v1)
- Generative extractors can invent slot fillers that the text doesn't mention. — [PMC11747381](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11747381/)
- Small-model structured output fails mostly by repetition loops and malformed values (unquoted numbers like "128/68", unescaped characters). — [arXiv 2507.01810](https://arxiv.org/html/2507.01810v1)
- Pipeline stages that can't see the original input lose up to about 40 points, and the loss is very sensitive to instruction wording (4.5 vs 36.5 points). — [arXiv 2609.32825](https://arxiv.org/abs/2609.32825)
- Symptom-checker accuracy ranges from 11.5% to 90.0% between apps, so a structured tool can be confidently wrong at scale. — [Kopka et al. 2025](https://pubmed.ncbi.nlm.nih.gov/40133390/)
- Vignette audits (45 standardized cases across 23 checkers; emergent / non-emergent / self-care labels) are the standard evaluation method, and "unsafe triage rate" is the safety metric used (ChatGPT 3.5 41% vs Ada 14%). — [Semigran 2015 via search summary](https://dash.harvard.edu/server/api/core/bitstreams/7312037d-99f2-6bd4-e053-0100007fdf3b/content); [JMIR mHealth 2023](https://mhealth.jmir.org/2023/1/e49995)
- Expert-opinion-based evacuation criteria (NOLS) mean the "ground truth" for evacuation branches is itself soft. — [NOLS case study](https://www.nols.edu/?p=742588)

### Inferences
- **Wrong slot:** the worst case is "near help" read when the hiker is far away, which would suppress evacuation planning. Mitigation: a slot defaults to "unknown", the unknown branch is the conservative one, and the model can never set a slot that rules contradict.
- **Combinatorial gaps:** every (condition × context) cell without a reviewed entry has to fall back to today's behaviour, never to a model-written bridge. The target example shows that a naive card merge contradicts itself (the snakebite card's "keep still" vs the lost card's "moving may be the better choice").
- **Over-confidence:** label combined answers by their source cards, and when a slot is unknown, say what was assumed ("If help is hours away...").
- **Testing:** a vignette suite per template cell, with paraphrases, negations ("no trouble breathing"), and distance and time variants. Score by worst turn, report paired fixed/broke counts, and keep a sealed set, in line with Fred's existing eval practice (`docs/research-conversation-safety.md`). Add a property test: every combined answer is made only of reviewed lines, and no conflict-table pair appears unresolved.

### Gaps
- No published failure analysis of deployed slot-plus-template first-aid assistants.

## 6. Authoring cost: how many protocols or templates would cover most situational wilderness questions?

### Takeaway
No source quantifies this. The structure of WFR curricula suggests it is small and bounded. A modest number of reviewed evacuation or remoteness lines per urgent condition, plus a reviewed conflict table for card pairs that actually co-occur, would likely cover most situational questions. That is tens of reviewed items, not hundreds, but this is an inference.

### Cited Findings
- CPGPrompt did not quantify authoring effort. It describes hand-picking guideline sections, hand-validating LLM-drafted trees with regeneration, and having three clinicians review 10 vignettes per domain. — [CPGPrompt](https://arxiv.org/html/2601.03475v1)
- NOLS evacuation guidance has four levels (none, self/assisted walk-out, simple carry, litter) and two call urgencies (ALPHA/BRAVO), which bounds the evacuation dimension. — [NOLS evacuation PDF](https://nols.edu/en/filer/public/1485287172/1041)
- Immediate-evacuation triggers are a short list (about 5 categories). — [JEMS](https://www.jems.com/training/wilderness-ems-has-special-consideration/)

### Inferences
- Rough sizing from local data: Fred has 44 cards and about 15 conditions in `conditions.ts`. With remoteness collapsed to about 3 values (help near / hours / days or no signal) and only the roughly 15 urgent conditions getting remoteness-specific lines, the grid is about 45 cells, many of which share one line ("get help now; start moving toward help only if ..." must come from reviewed sources). The conflict table needs only the pairs seen in logs or evals, plausibly 10–30.
- Authoring could follow CPGPrompt: a large model drafts cell text from cited sources offline, and a human reviews every line, as Fred already does for cards. The phone ships only reviewed text and the tables.

### Gaps
- No empirical count of what share of real wilderness questions are situational, or how many templates reach, say, 90% coverage. Fred's own question logs and eval sets would be the way to measure it.
