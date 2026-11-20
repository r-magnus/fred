# Fine-tuning / distilling Qwen3-1.7B for grounded reasoning from retrieved passages (Fred)

Research date: 2026-11-20. About 25 tool calls were used, more than the usual budget. Context comes from the repo: `docs/results-strategy-research.md` §3.3 already proposes RAFT-style QLoRA on the desktop RTX 2060 (6 GB). `docs/results-accuracy-research-2.md` §5 cites "Models for minimalist RAG" (arXiv 2607.27506). The oracle test (§1i) found that 12 of 18 answers still fail with the right passage in hand. Wherever evidence comes only from models of 7B or more, it is flagged **[≥7B only]**.

## 1. Do small (≤2B) models gain grounded reasoning from fine-tuning? (RAFT, Self-RAG, FRONT/ReClaim, distilled reasoners, Pleias-RAG and similar)

### Takeaway
Yes, and the strongest evidence sits right at Fred's size. On **Qwen3-1.7B itself**, FaithRL (2026) raised open-book QA accuracy from 69.3 to 73.7 and faithfulness from 90.1 to 91.5 using a step-level faithfulness reward. Plain outcome-reward GRPO cut faithfulness to 81.8. Purpose-built small RAG reasoners (Pleias-RAG-350M/1B, OCC-RAG-1.7B) show that grounded, cited reasoning is learnable at ≤1.7B. However, they got there with millions of mid-training examples, not a hobby-scale SFT. The classic papers (RAFT, Self-RAG, FRONT) are all **[≥7B only]**.

### Cited Findings
**Direct evidence at Fred's size**
- **FaithRL** (arXiv 2602.05897, v2 27 May 2026). The students were DeepSeek-R1-Distill-Qwen-1.5B, Qwen3-0.6B and **Qwen3-1.7B**. Training used 8,000 examples from HotpotQA and 2WikiMultiHopQA. The step-level reward came from HHEM-2.1, which checks each chain-of-thought sentence against the context. Evaluation used SQuAD, NewsQA, TriviaQA, NQ and HotpotQA. Averages over the five datasets (Faith / Acc %): — [arXiv 2602.05897](https://arxiv.org/html/2602.05897)
  - Qwen3-1.7B: base 90.12 / 69.25; outcome-only GRPO **81.80** / 69.90; FaithRL 91.46 / 73.69.
  - DPSK-R1-Distill-1.5B: base 66.20 / 44.87; GRPO 77.29 / **38.71**; FaithRL 79.77 / 62.28.
  - Qwen3-0.6B: base 81.32 / 60.21; GRPO 80.00 / 63.73; FaithRL 83.54 / 65.08.
  - Under adversarial attack (NewsQA), Qwen3-1.7B scored GRPO 62.16 / 38.62 against FaithRL 68.10 / 42.13.
  - The paper says outcome-only GRPO "exacerbates hallucinations within CoT."
- **CRAFT** (arXiv 2602.01348, v1 Feb 2026, v3 Jul 2026). This is GRPO for the post-retrieval answer step. Deterministic rewards cover format, answer correctness and **citation validity**; a judge-based reward covers semantic faithfulness. The judge is reported as Qwen3-30B-A3B. The authors report that CRAFT improves both accuracy and faithfulness "from 1.5B parameters upward". At 0.5B, results "remain highly dependent on the template." — [arXiv abs](https://arxiv.org/abs/2602.01348); judge detail from [search summary of the PDF](https://arxiv.org/pdf/2602.01348). I could not extract exact per-size numbers.
- **GRACE** (arXiv 2606.16151, EMNLP 2026). This is a human-annotated, step-level faithfulness benchmark for reasoning over context. Adding step-level faithfulness signals to RL "improves both downstream accuracy and reasoning reliability." — [arXiv abs](https://arxiv.org/abs/2606.16151). A search snippet adds a detail I could not verify in the text: with Qwen3 at 1.7B, 4B and 8B, task-only GRPO raised F1 but **lowered faithfulness at 1.7B**, and a faithfulness-aware process reward recovered it. — [search snippet of PDF](https://arxiv.org/pdf/2606.16151)
- **RSAT** (arXiv 2605.00199, 2026; table QA, not passages). It used GRPO with an NLI-faithfulness, citation-validity and parsimony reward on Qwen2.5 1.5B/3B/7B and Llama 1B/3B/8B. Faithfulness rose from 0.224 after SFT alone to 0.826. Removing the faithfulness reward dropped it to 0.03. — [arXiv 2605.00199](https://arxiv.org/html/2605.00199)
- **GRPO vs DPO for faithful CoT** (arXiv 2512.22631). Across Qwen2.5 1.5B–14B, methods were similar at 1.5B. GRPO's faithfulness gains show more clearly at ≥7B, and GRPO is "less stable at smaller scales." — [arXiv 2512.22631](https://arxiv.org/html/2512.22631v1)

**Purpose-built small RAG reasoners**
- **Pleias-RAG-350M / Pleias-RAG-1B** (arXiv 2504.18225, 25 Apr 2025; Apache-2.0; about 1.2B). Both were mid-trained from Pleias's own Dec-2024 base models on **3,126,691 RAG examples (about 9.47B tokens), for a bit under 2 epochs**, on 4 nodes of 4 H100s. Data pipeline: Gemma-3-12B back-translated the queries. Gemma-3-27B wrote 4,000 seed traces, which were filtered and used to fine-tune a Gemma-3-12B trace writer for the full 3M. Hallucinated citations were filtered out. About 5% of examples had their query swapped for an unrelated one, to teach refusal. — [arXiv 2504.18225](https://arxiv.org/html/2504.18225v1)
  - Trace structure: query analysis, then a query report (answerable / trivial / reformulated / unclear), then source analysis, then a source report (extensive / basic / incomplete / infeasible), then a draft, then the answer. Answers carry `<ref>` citations with literal quotes. — [arXiv 2504.18225](https://arxiv.org/html/2504.18225v1); [model card](https://huggingface.co/PleIAs/Pleias-RAG-1B)
  - Claims: state of the art for its size on 2WikiMultiHopQA, comparable to 4–8B models on HotpotQA (Qwen-2.5-7B, Llama-3.1-8B, Gemma-3-4B), and weaker on MuSiQue. Scores appear only in figures. Scoring is LLM-as-a-match on modified benchmarks. No ablation against the base model and **no quantitative citation-accuracy measure** is reported. — [arXiv 2504.18225](https://arxiv.org/html/2504.18225v1)
  - Limitations: 4,096-token context; evaluated on "trivial"-mode queries only; sometimes answers a different question when the sources lack the answer; at most 10 sources. — [arXiv 2504.18225](https://arxiv.org/html/2504.18225v1)
  - The card claims it runs on phones, with about 20 s for a complex generation with reasoning on 8 GB RAM. This was not demonstrated. A GGUF is available. — [model card](https://huggingface.co/PleIAs/Pleias-RAG-1B)
  - I found **no 2026 Pleias-RAG successor**. A catalog checked on 2026-08-27 still listed the 2025-04 models as the latest. — [llmreference](https://www.llmreference.com/model-family/pleias)
- **OCC-RAG-1.7B** (MIT). It was mid-trained from Qwen3-1.7B-Base on 3.25M faithful-QA examples. Fred's own screen of 8 questions found it fixed the choking inversion and answered the tourniquet question correctly. But it wrote 300–900 tokens of reasoning (27–59 s on desktop CPU), gave clipped answers, and looped once. — `docs/results-strategy-research.md` §1h (local measurement); [card](https://huggingface.co/occ-ai/OCC-RAG-1.7B)
- **"Models for minimalist RAG"** (arXiv 2607.27506). A 1B model was trained with GRPO on 723M tokens on a single GPU. Rewarding answer similarity alone produced passage citation in 42.4% of responses. At 1B, 56% of losses were factual errors, not hallucination. — cited in `docs/results-accuracy-research-2.md` §5 (not re-verified this session)

**Classic methods, [≥7B only]**
- **RAFT** (arXiv 2403.10131). LLaMA2-7B with GPT-4-1106 chain-of-thought answers; 1 oracle document + 4 distractors; the best oracle fraction P varies by dataset (40–100%). Results: HotpotQA 35.28 vs LLaMA2-7B+RAG 0.03 and GPT-3.5+RAG 41.5. PubMed 73.3 vs 58.8. Removing chain of thought cost 9.66 points on HotpotQA and 14.93 on HuggingFace. "Finetuning with only the golden document frequently results in inferior performance." — [arXiv 2403.10131v2](https://arxiv.org/html/2403.10131v2)
- **FRONT** (Findings ACL 2024). LLaMA-2-7B is first trained to ground on exact quotes and then generate. It gained 14.21% on average in ALCE citation quality, surpassing ChatGPT. — [ACL Anthology](https://aclanthology.org/2024.findings-acl.838)
- **ReClaim** (arXiv 2407.01796) interleaves sentence-level references and claims. I did not confirm the model sizes tested. — [arXiv 2407.01796](https://arxiv.org/html/2407.01796v1)
- Self-RAG: I did not re-check sizes this session (see Gaps).

**Distilled reasoners (math-centric)**
- DeepSeek-R1-Distill-Qwen-1.5B is the *least faithful* of the small models in FaithRL (base Faith 66.2 vs Qwen3-1.7B 90.1). Its chain of thought hallucinates even when the answer is right. — [arXiv 2602.05897](https://arxiv.org/html/2602.05897)
- Reasoning models show factuality degradation against their backbones on SimpleQA, with DeepSeek-R1 the exception (parametric facts, not grounding). — [arXiv 2505.23646](https://arxiv.org/html/2505.23646v1)
- A 1.5B student distilled from a 7B teacher can match the teacher on math, with "limited improvement" on general knowledge (MMLU-Pro). — [search summary, 2507.00054](https://arxiv.org/html/2507.00054v1)
- In sub-1B on-device distillation for summarisation, smaller non-reasoning models were the most grounded. — [arXiv 2607.08268](https://arxiv.org/pdf/2607.08268) (search snippet only)

### Inferences
- The most decision-relevant fact is that **base Qwen3-1.7B is already the most faithful small model in FaithRL (90%)**. The gain to chase is accuracy and multi-hop combination, and the danger is losing faithfulness. Any training that rewards only correct answers (outcome GRPO, or SFT on unfiltered teacher traces) risks the 90 → 82 drop seen there. That is exactly the "drifted from passages" failure Fred saw with thinking mode.
- Swapping in R1-Distill-1.5B, or s1/LIMO-style math distillation, points the wrong way for Fred. Those recipes buy multi-step math reasoning at the cost of faithfulness to context. (s1 and LIMO are 32B students. I did not re-verify this; see Gaps.)
- Pleias and OCC prove the *format* (a structured trace, then a cited answer, with a refusal branch) works at ≤1.7B. But both are million-example mid-training runs. Neither is a recipe one developer can reproduce in weeks. Pleias-RAG-1B could be screened as a drop-in, like OCC was. It would need a phone measurement and the Fred voice.

### Gaps
- No exact per-size CRAFT numbers. I did not verify the GRACE 1.7B finding in the text.
- Self-RAG, s1, LIMO and OpenThoughts sizes and results were not re-fetched. From memory: Self-RAG released 7B/13B and s1/LIMO used 32B students. **Treat this as unverified.**
- No study measures SFT-only (no RL) RAFT-style training at ≤2B with a safety metric.
- The Pleias benchmark numbers are only in figures, and there is no independent replication.

## 2. Data: how much, how it is made, how to avoid teaching hallucination

### Takeaway
The published small-model RL result used **8,000** multi-hop examples (FaithRL). RAFT-style SFT papers work in the thousands. The million-scale numbers belong to mid-training. For Fred, a few hundred to about 2,000 carefully filtered examples drawn from the packs is the realistic regime. Two levers matter most: filter teacher traces with a grounding checker, and include distractor-only and "not in the sources" cases.

### Cited Findings
- FaithRL: 8,000 HotpotQA/2Wiki training examples. — [arXiv 2602.05897](https://arxiv.org/html/2602.05897)
- Pleias: 4,000 seed traces from Gemma-3-27B, filtered, then 3.1M generated examples. Hallucinated citations were filtered. About 5% unrelated-query examples teach refusal. — [arXiv 2504.18225](https://arxiv.org/html/2504.18225v1)
- RAFT: oracle + distractors. For a fraction (1−P), *only* distractors are given, so the model learns not to force an answer from irrelevant text. Training on the golden document alone is worse. Distractor training makes the model robust to changes in how many documents arrive at test time. — [arXiv 2403.10131v2](https://arxiv.org/html/2403.10131v2); [Berkeley blog](https://gorilla.cs.berkeley.edu/blogs/9_raft.html)
- Unsloth recommends mixing about 75% reasoning and 25% non-reasoning examples when fine-tuning Qwen3, to keep thinking ability. Fine-tuning on non-reasoning data alone "may reduce reasoning ability." — [Unsloth Qwen3 guide](https://unsloth.ai/docs/models/tutorials/qwen3-how-to-run-and-fine-tune)
- Traces written by a much larger teacher contain low-probability tokens that small students struggle to learn. Having the student rewrite those tokens helps (IPD, 2509.22230). — [arXiv 2509.22230](https://arxiv.org/html/2509.22230)
- Correctness-filtered traces beat raw teacher traces by about 4.7 points on GSM8K for a small student (a single hobby experiment, not peer-reviewed). — [GitHub](https://github.com/MaxiRuess/reasoning-distillation-grpo)
- HHEM-2.1 (Vectara) is a usable sentence-level checker of a claim against its context. FaithRL uses it as its step reward. — [arXiv 2602.05897](https://arxiv.org/html/2602.05897)
- Prior Fred finding: a DeBERTa-small NLI verifier had no usable threshold at answer time. — `docs/results-verifier-test.md` (via `verification_methods.md`)

### Inferences
- A suggested data recipe for Fred, all built from the packs' own passages:
  1. Sample passage sets the held-out sampler has never drawn (§3.3 discipline).
  2. A teacher writes a lay question, a short trace that **quotes** the passages by id, and a Fred-voice answer.
  3. Keep the example only if every quoted span is a verbatim substring of a passage (a deterministic check, which needs no NLI model) and an NLI/HHEM check passes on each answer sentence.
  4. Mix: about 60% oracle + 3 distractors; about 20% distractors only, with the target answer "the sources don't cover this" plus a safety fallback; about 10% two-passage combination questions (multi-hop); about 10% negation-heavy passages ("do not massage"), to target the inversion defect.
  5. A human spot-checks every first-aid example. With one developer, this caps the set at hundreds, not thousands, of safety-critical items.
- The literal-substring quote check is the cheap, readable grounding filter. It also matches the project's "prefer fixes a person can read" rule.
- Keep traces **short**. OCC's 300–900-token traces cost 27–59 s, which Fred's 14.7 s answer budget cannot absorb.

### Gaps
- No ≤2B study gives a dose–response curve (for example, 500 vs 2,000 vs 8,000 examples) for grounded SFT.
- It is unknown whether HHEM-2.1 handles terse first-aid imperatives better than the DeBERTa NLI that failed locally.

## 3. Teacher licensing: whose outputs may train a model Fred ships

### Takeaway
**Safe:** DeepSeek-R1 (MIT, explicitly permits distillation) and Qwen3 open-weights teachers (Apache-2.0, secondary-source confirmation). **Restricted, flag clearly:** OpenAI, Anthropic and Google Gemini API terms all bar using outputs or services to build models that compete with them. Whether a 1.7B offline field-guide model "competes" is legally unclear. A student project should not rely on that ambiguity. **Unverified:** Gemma-as-teacher may make the student a Gemma "Model Derivative."

### Cited Findings
- DeepSeek-R1 card: MIT licence; the series "permits commercial use and modifications", explicitly including distillation to train other LLMs. — [HF model card](https://huggingface.co/deepseek-ai/DeepSeek-R1/blob/refs%2Fpr%2F243/README.md)
- Qwen3-235B-A22B is listed as Apache-2.0 with open weights. This is secondary only; the official card was not fetched. — [llm-stats](https://llm-stats.com/models/compare/deepseek-r1-distill-qwen-7b-vs-qwen3-235b-a22b)
- OpenAI Business Terms bar using Output "to develop AI models that compete with our products and services." A newer version exempts only classifier/embedding-type models that are *not distributed*. — [OpenAI business terms](https://openai.com/policies/business-terms); [Aug 2023 version](https://openai.com/policies/aug-2023-business-terms/)
- Anthropic Commercial Terms (as reproduced on Bedrock): customers may not use the Services "to build a competing product or service, including to train competing AI models" without approval. Anthropic assigns its rights in Outputs to the customer. — [Anthropic commercial terms](https://www.anthropic.com/legal/commercial-terms); [AWS Bedrock third-party terms](https://aws.amazon.com/legal/bedrock/third-party-models/)
- Gemini API (effective 23 Mar 2026): "You may not use the Services to develop models that compete with the Services." Google won't claim ownership of generated content. On **unpaid** tiers Google may use prompts and responses to improve its products. — [Gemini API terms](https://aistudio.google.com/docs/terms)
- A Stanford legal analysis argues these restrictions are often violated and of uncertain enforceability, and that providers may not own their outputs. — [Stanford Law PDF](https://law.stanford.edu/wp-content/uploads/2025/03/ssrn-5049562.pdf)

### Inferences
- Recommended teacher: **Qwen3-235B-A22B or a later open Qwen, or DeepSeek-R1/V3**. Run it locally if possible, or through a host whose own terms add no output restriction (check the host's ToS separately). Same-family Qwen teachers also reduce the token-mismatch problem (IPD).
- Do not use Claude, GPT or Gemini to *write training targets*. Using them to *grade* or spot-check, where the outputs are not trained on, is a lower-risk use, but still check the terms.
- Fred's student inherits the Qwen3-1.7B licence (Apache-2.0) for the weights. Record the teacher and its licence in `docs/licensing.md`.
- The training *passages* come from the packs. WHO BEC is CC BY-NC-SA, so training on it may make the adapter a derivative carrying NC/SA terms. Prefer the public-domain packs (Army, NPS, CDC, USPHS) for training text. This is an inference; check it with whoever owns licensing.

### Gaps
- I did not fetch the official Qwen3 card or check for any Qwen output-use clause.
- I did not fetch the Gemma Terms of Use. Memory says it defines models trained on Gemma outputs (distillation) as Model Derivatives subject to its use policy. **Unverified.**
- No source addresses whether a non-commercial student app "competes" with a frontier API.

## 4. Compute and tooling: LoRA/QLoRA, GPU hours, GGUF export, quantisation damage

### Takeaway
SFT with LoRA on a 1.7B model is cheap: hours on a 6 GB consumer GPU or a free T4. Unsloth exports straight to Q4_K_M GGUF, the same size as today's 1.28 GB file. Faithfulness RL is about 30 A800-hours for Qwen3-1.7B, so it needs rented cloud GPUs (tens of dollars per run) and will not fit a 6 GB card. Nobody has measured how Q4_K_M quantisation damages a *fine-tuned* model's grounded reasoning, so Fred must measure it.

### Cited Findings
- Unsloth's Qwen3 guide: "2x faster, use 70% less VRAM." Qwen3-14B fits a free 16 GB Colab T4. `load_in_4bit=True` for QLoRA. The guide gives no 1.7B VRAM figure. In llama.cpp, thinking is toggled with `/think` and `/no_think`. Avoid greedy decoding in thinking mode (it repeats). — [Unsloth Qwen3 guide](https://unsloth.ai/docs/models/tutorials/qwen3-how-to-run-and-fine-tune)
- Prior repo note: "Unsloth reports Qwen3-1.7B training in about 5 GB of GPU memory," on the desktop's RTX 2060 with 6 GB. — `docs/results-strategy-research.md` §3.3 (I did not re-find the source this session)
- Export: `model.save_pretrained_gguf("dir", tokenizer, quantization_method="q4_k_m")`. The fallback is a 16-bit merged save, then llama.cpp conversion. If export runs out of memory, lower `maximum_memory_usage` from 0.75 to 0.5. — [Unsloth saving to GGUF](https://unsloth.ai/docs/basics/inference-and-deployment/saving-to-gguf)
- Qwen3-1.7B Q4_K_M is 1.28 GB. — [ggml-org GGUF](https://huggingface.co/ggml-org/Qwen3-1.7B-GGUF)
- FaithRL compute for Qwen3-1.7B: **29.28 A800 GPU-hours** (35.59 for plain GRPO). The framework was verl, with 8 rollouts per prompt and 2,048 max tokens. — [arXiv 2602.05897](https://arxiv.org/html/2602.05897)
- Low-bit quantisation "disproportionately impacts conceptual and computational reasoning" (MATH). — [arXiv 2501.03035](https://arxiv.org/pdf/2501.03035)
- On an 8B model, 4-bit cost 3–5% and 8-bit 1–2% against FP16 (a different setting). — [search summary](https://arxiv.org/pdf/2512.18934.pdf)
- Repo note: sub-8-bit KV cache measurably hurts small-model RAG faithfulness. — `docs/results-strategy-research.md` §4.3 (arXiv 2608.30996)

### Inferences
- **Rough SFT estimate, not sourced:** 1,000–2,000 examples × about 1.5k tokens × 2–3 epochs is under 10M tokens. With QLoRA on a 1.7B model, that should take a few hours on a T4 or RTX 2060. Confirm on the first run.
- **Rough RL estimate, not sourced:** at about 30 A100/A800-class hours per run, typical rental of about $1–2/hour gives roughly $30–90 per run, before failed runs. 8 rollouts × 2,048 tokens will not fit 6 GB.
- Fine-tune in bf16 or with QLoRA, merge, then quantise once to Q4_K_M, the same as the shipped model. **Evaluate the Q4_K_M GGUF in llama.cpp, not the bf16 checkpoint.** Quantisation may erase a small faithfulness gain.
- Also export Q4_0, so the Arm repacking speed experiment (§4.1 of the strategy doc) is not blocked.

### Gaps
- There is no published measurement of Q4_K_M damage to a LoRA-tuned model's faithfulness or multi-hop accuracy at ≤2B.
- I did not verify the Unsloth 1.7B VRAM figure.
- llama.rn has to load the merged GGUF the same way as stock Qwen3. This is very likely, since the architecture is unchanged, but it is untested.

## 5. Risks: forgetting, safety regressions, eval overfitting, re-measurement, RL

### Takeaway
The main risks are **safety regression from benign fine-tuning** and **faithfulness loss from outcome-only rewards**. LoRA at low rank limits forgetting. Every measurement (search check, oracle test, graded held-out set, safety failures) must be re-run on the quantised GGUF. GRPO with a faithfulness reward is the best-evidenced method at 1.7B, but it is the most expensive and least stable at this size.

### Cited Findings
- Benign fine-tuning (Alpaca, Dolly) degrades safety alignment, though less than harmful data. As few as 10 harmful examples break guardrails in GPT-3.5 and Llama-2-Chat. Mixing safety examples into the training data mitigates this. — [Qi et al., arXiv 2310.03693](https://arxiv.org/abs/2310.03693v1); [Stanford HAI brief](https://hai.stanford.edu/policy/policy-brief-safety-risks-customizing-foundation-models-fine-tuning)
- LoRA learns less in-domain than full fine-tuning but forgets less out of domain. Forgetting is controlled by rank (ICLR 2025). — [arXiv 2405.09673](https://arxiv.org/html/2405.09673v2)
- Higher QLoRA rank learns more but drifts further (an acquisition–retention frontier). — [EMNLP Findings 2026](https://aclanthology.org/2026.findings-emnlp.918.pdf)
- Outcome-only GRPO reduced Qwen3-1.7B answer faithfulness from 90.1 to 81.8 and worsened chain-of-thought hallucination. It cut R1-Distill-1.5B accuracy from 44.9 to 38.7. — [arXiv 2602.05897](https://arxiv.org/html/2602.05897)
- GRPO is less stable at small scales, and its faithfulness gains appear clearly only at ≥7B. — [arXiv 2512.22631](https://arxiv.org/html/2512.22631v1)
- A rule-based citation reward on Qwen2.5-3B plateaued at about 0.55 (a hobby repo). — [GitHub](https://github.com/Farayabaig/grpo-rag-citations-qwen3b)
- CRAFT at 0.5B is "highly dependent on the template", while 1.5B and up improved. — [arXiv abs](https://arxiv.org/abs/2602.01348)
- Repo rule: sampled decoding produced both observed unsafe answers. — `verification_methods.md`

### Inferences
- **Safety gate (zero new unsafe answers).** Compare the tuned GGUF with the base on (a) the full held-out set, (b) the 100-question tuning set, and (c) a dedicated "dangerous-if-wrong" list (tourniquet, choking, frostbite, edibility, negation cases). Any new unsafe answer blocks shipping, whatever else improves.
- **Overfitting the eval.** Generate training data only from passages the held-out set was not written from. Check n-gram overlap between training questions and eval questions. Do not tune hyperparameters against the held-out set; use the tuning set. The held-out set is about ±15 points, so a small gain will not be statistically visible.
- **Voice and length drift.** Cap trace length in training data, and measure answer time on the phone.
- **RL at this size.** FaithRL is the single best-matched result (Qwen3-1.7B, step faithfulness reward, about 29 GPU-hours). It is a stretch goal, not a December deliverable for one developer. Its rollout infrastructure (verl plus an HHEM reward server) is a project in itself.

### Gaps
- No ≤2B study reports safety-specific regressions after RAG fine-tuning.
- Rejection sampling or DPO is a middle path between SFT and GRPO. I did not find ≤2B grounded-RAG results for DPO beyond the 1.5B "similar across methods" note.

## 6. Realistic timeline for one developer (today 2026-11-20; due dates in Dec 2026)

### Takeaway
With 2–5 weeks left, **one RAFT-style LoRA SFT experiment, measured honestly, is feasible. Shipping a tuned model under the zero-new-unsafe rule is possible only if it clearly passes.** RL (FaithRL or CRAFT-style GRPO) is out of scope before December. It belongs in "future work," with FaithRL as the cited path.

### Cited Findings
- The compute for SFT is small (§4). RL is about 30 A800-hours per run, plus infrastructure. — [arXiv 2602.05897](https://arxiv.org/html/2602.05897)
- Million-example recipes (Pleias 3.1M, OCC 3.25M) are far beyond this budget. — [arXiv 2504.18225](https://arxiv.org/html/2504.18225v1); `docs/results-strategy-research.md` §1h

### Inferences
- A suggested plan (estimates, not sourced):
  - **Days 1–3:** Build the data pipeline. Run the open teacher (Qwen3-235B or DeepSeek) over held-out-disjoint passage sets. Apply the literal-quote filter and an NLI/HHEM filter. Hand-review all first-aid items. Target 500–1,500 examples.
  - **Days 4–5:** Train QLoRA r=8–16 on Qwen3-1.7B (Unsloth on the 2060, or Colab). Keep about 25% general or non-RAG examples, as the Unsloth mix advises. Merge and export Q4_K_M.
  - **Days 6–8:** Re-run the search check (unchanged), the oracle test (§1i), the tuning set, the held-out set and the safety list on the GGUF. Compare with the base model at the same decoding settings.
  - **Days 9–10:** Phone timing and memory. Then decide whether to ship or shelve.
- A cheaper parallel screen: run **Pleias-RAG-1B** through the same oracle test, the way OCC was screened. Its ≤1.2B size fits, and it already has a refusal branch and literal-quote citations. Weak points: a 4k context, no Fred voice, and unproven phone speed.
- If the tuned model does not beat base Qwen3-1.7B on the oracle test **without** a new unsafe answer, report it as a negative result. That is still valid capstone content.

### Gaps
- There is no published end-to-end timeline for a solo developer.
- I did not survey cloud GPU prices this session.
