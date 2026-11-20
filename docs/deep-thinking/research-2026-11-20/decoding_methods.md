# Decoding-time methods to keep a small LLM faithful to retrieved passages, without sampling (for Fred)

Researched 2026-11-20. Fred context: Qwen3-1.7B Q4_K_M generator on phones (llama.rn), ~4 EmbeddingGemma passages, opt-in "deep thinking" mode. Already measured locally and failed: Qwen3 thinking mode (net about -3.5 on 24 changed answers, 1 new unsafe answer, drift on plant/animal facts; `docs/results-thinking.md`), best-of-3 at temperature 0.6 (every unsafe answer came from a sampled draft, never greedy; `docs/results-deep-thinking.md`), sentence-vector judging (scores differed by ~0.01, so effectively random), evidence-first prompting (changed 27 of 33 drafts, net worse). The pass rule is zero new unsafe answers.

Read this first: almost all decoding-for-faithfulness evidence comes from 7B to 70B models, and the effects are measured on short-answer QA (NQ, NQ-Swap, PopQA) or news summarization, not on 2-3 sentence safety-critical answers. The one benchmark I found with a 1.5B Qwen model (CUB, Qwen2.5-1.5B) shows contrastive decoding methods helping in some context conditions and hurting badly in others. Each claim below says what size model it was measured on.

## 1. Context-aware decoding (CAD) and successors (AdaCAD, COIECD, NWCAD, CoCoA): gains, failure modes, cost

### Takeaway
CAD runs the model with and without the passages and amplifies the difference. It helps when the passages contradict what the model remembers. On ordinary questions, where passages and memory agree, a fixed-strength CAD often makes answers worse (AdaCAD measured an average drop of 18.58 points on natural QA). Adaptive versions (AdaCAD, and especially NWCAD in 2026) fix much of that by backing off to plain decoding when the two streams agree. Every variant needs about 2 forward passes per token, which measured about 1.8x slower. No paper I found tests these methods at ≤2B except the CUB benchmark, where results on Qwen2.5-1.5B are mixed.

### Cited Findings
- CAD (Shi et al., 2023) contrasts the output distribution with and without the input context. It needs no training and was tested on the OPT, GPT, LLaMA and FLAN-T5 families. It reports a 14.3% factuality gain for LLaMA on summarization (LLaMA-30B on CNN-DM: +21% ROUGE-L), and it is "especially effective" at overriding the model's prior when the context contradicts it — [Shi et al. 2023, arXiv:2305.14739](https://arxiv.org/abs/2305.14739)
- **Reproduction (Xu, 2023, revised later):** tested LLaMA-7B, Llama-2-7B, MPT-7B(-Instruct), Mistral-7B(-Instruct) and Flan-T5-xl (3B, the smallest) / xxl (11B). CAD mostly raised FactKB: on DBpedia query-focused summarization, LLaMA-7B went 29.6→36.1 and Flan-T5-xxl 33.9→43.0, but Mistral-7B-Instruct fell 42.6→41.6. Flan-T5-xl and -xxl dipped slightly on PubMedQA. On news (CNN/DM, XSum) FactKB improved for 6/8 and 8/8 models — [Xu, arXiv:2312.14335v3](https://arxiv.org/html/2312.14335v3)
- **Cost (same reproduction):** 0.042 s/token vanilla vs 0.077 s/token CAD (RTX 3090, FP16, batch 1), about 1.8x. CAD needs two forward passes per step, and batching the two passes saves time but costs memory — [Xu, arXiv:2312.14335v3](https://arxiv.org/html/2312.14335v3)
- **α sensitivity:** α=0.3 was the best overall. In query-focused summarization a larger α raises FactKB but lowers ROUGE (DBpedia FactKB 32.7 at α=0 → 38.7 at α=0.5; ROUGE-1 15.5→14.5) — [Xu, arXiv:2312.14335v3](https://arxiv.org/html/2312.14335v3)
- **CAD's main failure mode (AdaCAD, NAACL 2025):** a uniform contrast strength overcorrects when there is little conflict. Exact match, greedy / CAD / AdaCAD:
  - Llama3-8B: NQ 44.63 / 35.96 / 45.47; TriviaQA 85.70 / **40.20** / 82.50; NQ-Swap (every example has a conflict) 47.81 / 77.94 / 62.34
  - Mistral-7B: TriviaQA 80.40 / **24.20** / 80.20
  - NQ-Synth (no conflict, Llama3-70B): greedy 88.20, CAD 64.00, AdaCAD 86.40, COIECD 83.60
  - Averaged over models and QA sets: AdaCAD +14.21 over CAD, +4.82 over COIECD, +2.41 over greedy. CAD drops 18.58 points on average on the natural datasets

  Models tested: Llama2-13B, Llama3-8B/70B, Mistral-7B, plus instruct versions. **None under 3B** — [AdaCAD, arXiv:2409.07394v2](https://arxiv.org/html/2409.07394v2); [ACL Anthology](https://aclanthology.org/2025.naacl-long.581)
- **AdaCAD mechanism:** it scales the contrast at each token by the Jensen-Shannon divergence between the with-context and no-context distributions, so it leans on context more when the conflict is high — [AdaCAD](https://arxiv.org/html/2409.07394v2)
- **AdaCAD on summarization (Llama3-70B), AlignScore:**
  - CNN-DM: greedy 91.44, CAD 91.01, AdaCAD 94.97
  - XSum: 85.28 / 84.34 / 85.81
  - TofuEval: 76.66 / 83.93 / 85.07

  The paper gives no runtime analysis, but the method needs logits from both passes — [AdaCAD](https://arxiv.org/html/2409.07394v2)
- **No-Worse CAD (NWCAD; Tao & Agrawal, Findings of ACL 2026):** defines "neutral regression" as an already-correct answer being overwritten when the context adds nothing. Its gate:
  - Compute the JSD between the two streams over the union of their top-50 tokens.
  - If JSD ≤ 0.3 and the no-context top-1 margin is ≥ 0.30, emit the no-context token. Under greedy decoding this reproduces it exactly.
  - Otherwise, if the with-context top-1 margin is ≥ 0.05, use the with-context logits.
  - Otherwise fall back to a CAD-style decoder (CoCoA by default). This fallback fires on only about 1–2% of tokens.

  Source: [NWCAD, arXiv:2604.16686](https://arxiv.org/html/2604.16686v1); [ACL Anthology](https://aclanthology.org/2026.findings-acl.473/)
- **NWCAD numbers (Llama-3.1-8B, full-slice accuracy):**

  | Method | Restate-hard | Distractor-hard | Helpful |
  |---|---|---|---|
  | No context | – | – | 2.97 |
  | With context | 77.60 | 36.20 | 51.93 |
  | CAD | 60.40 | 11.40 | 53.12 |
  | AdaCAD | 80.00 | 31.40 | 55.39 |
  | CoCoA | 72.80 | 64.60 | 59.94 |
  | NWCAD | 84.40 | 66.00 | 64.09 |

  On baseline-correct subsets NWCAD keeps 97.44% (restate) and 89.42% (distractor), so it still regresses some. Latency is about the same as its base contrastive decoder (0.88–1.01x). Models: Llama-3.1-8B/70B and Ministral-3-8B. **None ≤3B** — [NWCAD](https://arxiv.org/html/2604.16686v1)
- **Only small-model evidence found (CUB benchmark, 2025), Qwen2.5-1.5B.** Two contrastive decoders, COIECD and ACD, scored as Gold / Conflicting / Irrelevant context:

  | Model | Method | CounterFact | NQ | DRUID |
  |---|---|---|---|---|
  | Base | Regular | 99.9 / 53.1 / 80.0 | 44.0 / 41.1 / 22.4 | – |
  | Base | COIECD | 94.8 / 1.2 / 89.8 | 42.4 / 39.2 / 45.8 | – |
  | Base | ACD | 97.6 / 7.7 / 90.3 | 46.7 / 42.8 / 39.3 | – |
  | Instruct | Regular | – | – | gold 47.3 |
  | Instruct | ACD | – | – | gold **12.3** |

  So these decoders help ignore irrelevant context but can collapse conflicting-context and even gold-context performance at 1.5B. Prompting raised NQ gold for the base model 44.0→63.9 — [CUB, arXiv:2505.16518](https://arxiv.org/html/2505.16518v1)
- **2026 RAG papers on uniform contrast:** they report that uniform contrastive pressure "degrad[es] fluency and introduc[es] repetition without improving faithfulness", and that conflict is concentrated in a few decoding steps. FIDES notes contrastive decoders need a second forward pass per step, "roughly 2× Standard RAG" — [FIDES, arXiv:2606.05644](https://arxiv.org/html/2606.05644v1); [Conflict-Suppressed RAG, NeurIPS 2026 poster](https://neurips.cc/virtual/2026/poster/148415)

### Inferences
- Fred's failure is the model *adding* plant/animal details the passages don't say. That is a parametric-knowledge leak, which is CAD's target case. But most of Fred's questions are low-conflict, which is where fixed-α CAD does the most damage. If any CAD variant is tried, use one with an NWCAD-style gate: greedy-identical when the streams agree, intervening only on the few tokens where the with-passage and no-passage distributions diverge. It is the only design whose stated goal ("no worse") matches Fred's zero-new-unsafe rule.
- Cost on the phone: the no-context prompt is short (system + question), so its prefill is cheap. Decode cost is about 2x per token: two sequences in one batch, or two contexts. For a ~60-token answer that is roughly +1x generation time, well within "tens of seconds".
- Guess at the risk: the CUB Qwen2.5-1.5B results show the conflict/irrelevant trade-off is sharper at 1.5B than at 8B. A 1.7B model's no-context stream is also weak, so the contrast is noisy. I'd expect CAD to change many answers, and that is exactly what failed with evidence-first prompting (27/33 changed).

### Gaps
- I found no CAD, AdaCAD or NWCAD result on Qwen3-1.7B or any ≤2B instruct model for free-form answers, and none on a safety-graded set.
- I could not read the NWCAD Figure 3 per-method baseline-correct regression rates for CAD and AdaCAD (they are in a figure).
- No numbers on how CAD behaves with a Q4 quantized model, where logit noise is larger.

## 2. DoLa, expert/amateur contrastive decoding, activation steering at 1–3B

### Takeaway
None of these has good evidence at ≤2B for faithfulness *to context*. DoLa was validated only on LLaMA 7B–65B and targets the model's own facts, not the passages. A 2025 study of 1.5B–70B models found many models with no gain, or a loss, from layer-contrast and steering methods. Expert/amateur contrastive decoding was designed around large size gaps (OPT-13B vs 125M), and I found no faithfulness results for a Qwen 1.7B/0.6B pair. All three rank below a gated CAD for Fred.

### Cited Findings
- DoLa's original evaluation used LLaMA 7B, 13B, 33B and 65B only — [DoLa, arXiv:2309.03883](https://arxiv.org/abs/2309.03883)
- "Steering off Course" (2025) tested up to 36 models from 14 families, 1.5B to 70B. It found that "a large number of models" show no improvement and sometimes degradation from DoLa-style and steering methods, attributed to models not sharing similar layer-wise patterns — [arXiv:2504.04635](https://arxiv.org/html/2504.04635v1)
- PruneCD (EMNLP 2025) reports that DoLa often picks the earliest possible exit layer, terminating its contrast prematurely, and "fails to correct hallucinated responses from greedy decoding" — [PruneCD, EMNLP 2025](https://aclanthology.org/anthology-files/pdf/emnlp/2025.emnlp-main.1651.pdf)
- Contrastive decoding (Li et al.) scores tokens by the log-likelihood gap between an expert and an amateur, under a plausibility constraint. It was evaluated with GPT-2 XL/small and OPT-13B/125M, for open-ended generation, not context faithfulness — [Li et al., arXiv:2210.15097](https://arxiv.org/abs/2210.15097)
- LightReasoner (a training method, Qwen2.5) found that the amateur's domain knowledge, more than its parameter count, drives useful contrast — [arXiv:2510.07962](https://arxiv.org/pdf/2510.07962)
- DeCoRe (contrasting masked retrieval heads) reports contextual-faithfulness gains over DoLa on Mistral-7B and Qwen2-7B. It needs head masking, i.e. model surgery — [DeCoRe, arXiv:2410.18860](https://arxiv.org/pdf/2410.18860)

### Inferences
- A Qwen3-1.7B vs Qwen3-0.6B pair would add ~0.35x compute and ~0.4–0.5 GB of memory. But the contrast targets fluency and genericness, not passage grounding, and there's no small-model evidence. Low priority.
- DoLa needs logits from intermediate layers. llama.cpp doesn't expose an early-exit lm_head through its public API (the header exposes final logits and embeddings), so it would need a fork. Not worth it given the evidence.
- Activation steering needs custom control vectors. llama.cpp has control-vector support in its tools (not verified this session), but there's no evidence for context faithfulness at this size.

### Gaps
- No paper found with DoLa or expert/amateur CD results on ≤2B models for RAG faithfulness.
- I did not verify current llama.cpp control-vector API status.

## 3. Greedy-compatible uncertainty and abstention (token entropy, first-token confidence, P(True))

### Takeaway
Single-greedy-pass confidence signals exist and are cheap (top-K logprobs come free from llama.cpp). On 7–8B models they roughly match sampled self-consistency for spotting wrong answers. The authors say they will not reliably catch high-confidence falsehoods, and a plant-fact hallucination copied from memory is often exactly that. Semantic entropy needs sampling, so it's out. Treat logprob signals as a trigger ("this answer is shaky: retry, decline, or show the card") rather than a guarantee.

### Cited Findings
- **First-token confidence:** normalized entropy of the top-K distribution at the first content-bearing answer token of one greedy decode. On PopQA and TriviaQA with three 7–8B instruct models it matches or modestly beats semantic self-consistency (one greedy decode plus 10 samples with NLI clustering), at one decode instead of 11. The authors say it is not expected to reliably identify high-confidence falsehoods. Not tested on RAG — [arXiv:2602.02888](https://arxiv.org/pdf/2602.02888)
- **Entropy production rate** detects hallucinations from a single generation's top-10 logprobs, including a financial RAG example. It was run with sampling at T=1.0 on 10–24B models — [arXiv:2509.04492](https://arxiv.org/html/2509.04492v2)
- **Gray-box detection with token identities (2026):** uses greedy decoding with Llama-3.2-3B-Instruct and Ministral-8B, top-10 candidates per position, including context-based NQ prompts. I did not verify its detection numbers — [arXiv:2610.19996](https://arxiv.org/pdf/2610.19996)
- CAD-family papers effectively use a related signal: the JSD between the with-passage and no-passage distributions measures how much a token depends on the passage (AdaCAD, NWCAD above) — [AdaCAD](https://arxiv.org/html/2409.07394v2); [NWCAD](https://arxiv.org/html/2604.16686v1)

### Inferences
- **Greedy-compatible idea for plant facts (untested):** run the no-passage stream alongside the greedy answer. Tokens that carry content words, are high-probability *without* the passage, and appear nowhere in the passages are "from memory, not from source". That is the exact signature of the thinking-mode drift (lynx/wolverines added to a bear answer). Flagging rather than rewriting keeps the greedy answer unchanged, so it can't add unsafe text.
- P(True)-style self-grading ("Is this answer supported by the passages? yes/no", read the logit) costs one short prefill plus one token. It is greedy-compatible. Fred's history (NLI verifier rejected, vector judges ~random) suggests a 1.7B self-judge will be weak, so it would need its own measurement.

### Gaps
- Found no study of token-entropy or P(True) abstention on ≤2B models in RAG, and none on a plant/animal fact set.
- I didn't fetch Kadavath et al. (P(True)) or the semantic entropy papers this session. Their known results are on large models and need sampling (semantic entropy).

## 4. Constrained and extractive decoding (copy-biasing, GBNF, quote-then-answer)

### Takeaway
llama.cpp and llama.rn fully support grammar-constrained (GBNF and JSON-schema) and logit-bias decoding today, so a forced "quote → answer" structure or a passage-token bias is cheap to build. I found no ≤2B evidence that it reduces unsupported claims in free-form answers. Fred's own evidence-first prompting result (27/33 answers changed, net worse) is a direct local warning against restructuring the answer. Treat copy-biasing as a variant of CAD with the same overcorrection risk.

### Cited Findings
- llama.rn supports "GBNF and JSON schema support for structured, constrained output generation", and converts `response_format` JSON schema to GBNF — [llama.rn README](https://github.com/mybigday/llama.rn)
- The llama.cpp public header exposes `llama_sampler_init_grammar`, `llama_sampler_init_grammar_lazy_patterns`, `llama_sampler_init_logit_bias`, `llama_sampler_init_penalties`, `llama_sampler_init_dry` and `llama_get_logits_ith` — [llama.cpp include/llama.h (master, fetched 2026-11-20)](https://github.com/ggml-org/llama.cpp/blob/master/include/llama.h)
- Fred local result: evidence-first prompting changed 27 of 33 first drafts and netted worse — `docs/results-deep-thinking.md`

### Inferences
- A GBNF grammar can force the output to begin with a verbatim span. But GBNF can't easily express "a substring of these 4 passages" without generating a grammar per query. A per-query logit bias over passage token IDs is easier, but it boosts every passage token everywhere, which is crude.
- A safer use of copy constraints is *checking* rather than *generating*: after the greedy answer, test whether its content words or numbers appear in the passages. Fred's "words kept from sources" judge already exists. Its known weakness is that it rewards copying and can't see a dangerous conclusion.

### Gaps
- No paper found with measured effects of grammar-forced quote-then-answer on ≤3B RAG faithfulness.

## 5. Greedy diversity without sampling (diverse beam, passage-order permutation, paraphrase ensembles)

### Takeaway
Deterministic variants are the safest way to get "several drafts" given Fred's finding that sampling caused every unsafe answer. Reordering the passages is the best-supported option: RAG answers are highly sensitive to passage order, and smaller Qwen3 models are more sensitive. 2024–2026 papers use agreement across orders to stabilize answers. But I found no direct measurement that cross-order agreement predicts correctness, and none at ≤2B.

### Cited Findings
- **Stable-RAG (2026):** RAG systems are "highly sensitive to document order" even with the gold document fixed, and "smaller Qwen3 models tend to exhibit higher sensitivity to document order changes". Top-5 retrieval gives 120 orderings. Order-sensitive samples split into 10+ answer clusters versus 1–2 for insensitive ones. Vanilla RAG's perturbation success rate on NQ with DPR is 50.8 with the gold document first and 84.4 with it fifth. Backbones: LLaMA3-8B-Instruct and Qwen3-8B. No majority-vote baseline and no direct agreement-vs-correctness correlation — [Stable-RAG, arXiv:2601.02993](https://arxiv.org/html/2601.02993v2)
- **Inference Scaling for Bridging Retrieval and Augmented Generation (2024):** self-consistency over permuted document orders mitigates position bias by marginalizing over orderings. It includes a baseline that counts consistent outputs across permutations, and links the bias to "lost in the middle" — [arXiv:2412.10684](https://arxiv.org/html/2412.10684v1)
- llama.rn has slot-based parallel completion (`context.parallel.enable({n_parallel: 4})`, which splits n_ctx across slots), so 3–4 greedy variants can run as one batched job — [llama.rn README](https://github.com/mybigday/llama.rn)

### Inferences
- **Concrete Fred design (untested):** greedy answers for 3 passage orders (shipped order plus 2 fixed reorderings, e.g. reversed and best-passage-last). If all 3 agree on their key content, keep the shipped greedy answer. If they disagree, treat the answer as unstable and fall back to a quote/card or decline. This never emits text that greedy-with-some-order didn't produce, and it can always prefer the shipped answer. So the extra risk is limited to the fallback path. Cost is about 3x generation (batched), within budget.
- The hard part is judging "agreement" for 2–3 sentence answers. Vectors failed (differences of ~0.01). Comparing content-word or number overlap is cheap but crude.
- Diverse beam search: llama.cpp removed its built-in beam search API at some point (not verified this session). With multiple sequences plus logits access it can be written by hand. No small-model RAG faithfulness evidence was found.

### Gaps
- No evidence found that agreement across passage orders or paraphrases predicts correctness at ≤2B, or for free-form safety answers.
- I didn't fetch diverse beam search (Vijayakumar et al., 2016) or prompt-paraphrase-ensemble papers this session.

## 6. What llama.cpp / llama.rn can do today

### Takeaway
At the C API level everything needed for CAD/NWCAD, logprob abstention, grammars and multiple greedy variants exists: `llama_get_logits_ith`, multi-sequence batches (`n_seq_max`), and custom samplers. llama.cpp's old built-in classifier-free guidance (negative prompt) no longer appears in the public header, so CAD has to be written by hand. llama.rn's JS API exposes grammars, parallel slots and (per llama.cpp server convention) n_probs. It does not obviously expose per-step raw logits for two contexts, so CAD on the phone probably needs a native (C++) patch to llama.rn.

### Cited Findings
- **llama.cpp had CFG/negative-prompt support:**
  - PR #2591 added `--cfg-negative-prompt-file` — [PR #2591 (semanticdiff mirror)](https://app.semanticdiff.com/gh/ggml-org/llama.cpp/pull/2591/overview)
  - Commit #4951 introduced `llama_sample_apply_guidance` — [commit mirror](https://cdn04132025.gitlink.org.cn/replica/llama.cpp/commit/4483396751c79dea540808b9cb9238245d06da2b)
  - The CFG-for-LLMs paper says its work was incorporated into Hugging Face and llama.cpp — [Sanchez et al., arXiv:2306.17806](https://arxiv.org/html/2306.17806v1)
- **Current master `llama.h` (fetched 2026-11-20):** grep for "guidance" or "cfg" returns nothing. Present are `llama_get_logits_ith`, `n_seq_max` ("Each token can be assigned up to n_seq_max sequence ids"), and the grammar, logit-bias, penalties and DRY samplers. The sampling API was refactored (#9294) around `llama_sampler` objects — [llama.h](https://github.com/ggml-org/llama.cpp/blob/master/include/llama.h); [refactor sampling v2 #9294 mirror](https://cdn04132025.gitlink.org.cn/replica/llama.cpp/commit/df270ef74596da8f1178f08991f4c51f18c9ee82)
- LLamaSharp (a binding) implements CFG by hand with a batched executor: two sequences, then applying guidance to the logits. This shows the two-sequence pattern works on llama.cpp — [LLamaSharp BatchedExecutorGuidance](https://code-kyxt.pcl.ac.cn/scisharp/LLamaSharp/src/branch/master/docs/Examples/BatchedExecutorGuidance.md)
- **llama.rn features:** GBNF/JSON-schema grammars, parallel slots, and MTP/draft speculative decoding (text-only) — [llama.rn README](https://github.com/mybigday/llama.rn)

### Inferences
| Method | Implementable on llama.rn today? | Compute | Greedy-safe? |
|---|---|---|---|
| NWCAD-gated CAD | Needs a native patch: two seq_ids in one batch, custom logits combine | ~2x decode, small extra prefill | Mostly. Identical to greedy when the gate backs off |
| Fixed-α CAD/COIECD/ACD | Same patch | ~2x | No. Large regressions on low-conflict questions |
| No-context "memory token" flagging | Same two-stream patch, read-only | ~2x | Yes. Doesn't change text |
| Token entropy / first-token confidence | Likely via n_probs in completion results (not verified in the llama.rn README) | ~1x | Yes |
| P(True) self-check | Yes: extra short prompt, read the yes/no probability | +1 prefill | Yes, if it only triggers fallback |
| Passage-order greedy ensemble | Yes: parallel slots | ~3x | Yes, if it only selects among greedy outputs or falls back |
| GBNF quote-then-answer | Yes | ~1.2x | Unknown. Local evidence-first result is a warning |
| DoLa | No (needs intermediate-layer logits) | ~1.1x | No small-model evidence |
| Expert/amateur CD with 0.6B | Needs a second model plus a patch | ~1.35x + memory | No evidence |

### Gaps
- I did not find the exact PR that removed CFG from llama.cpp. Its absence from the header is the evidence.
- I did not verify whether llama.rn's completion result returns per-token top-K probabilities (`n_probs`) on the current version. The README grep didn't show it.
- No on-phone timing for two-sequence decoding with Qwen3-1.7B Q4_K_M.
