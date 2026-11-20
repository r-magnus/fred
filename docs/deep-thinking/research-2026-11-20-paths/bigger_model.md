# A bigger (3-4B) model for an opt-in "deep thinking" mode only: attainable on phones in 2026, and does it reason better from passages?

Researched 2026-11-20. Scope: phones only. Fred's own measurements are cited as repo paths. The most relevant ones: Qwen3-1.7B Q4_K_M (1.11 GB) on a Nothing Phone (3) (Snapdragon 8s Gen 4, 11.5-12 GB, CPU only, llama.rn) runs at 2.9 GB app PSS. Qwen3 thinking at 1.7B was rejected (`docs/results-thinking.md`), and so was Qwen3.5-2B (`docs/results-qwen35-2b.md`). Qwen3.5-4B was never downloaded (issue #37, closed 2026-10-08).

Evidence-quality flags used below:
- **[vendor]**: self-reported by the model maker.
- **[estimate]**: an aggregator's estimate, not a measurement.
- **[larger-model]**: the evidence is from models well above 4B.
- **[not RAG]**: the benchmark has no retrieved passages.

## 1. Candidates around 3-4B: thinking modes, licences, Q4_K_M size, context

### Takeaway
The realistic shortlist is **Qwen3-4B** (hybrid thinking, Apache 2.0, ~2.5 GB at Q4_K_M), **Qwen3-4B-Thinking-2507 / Instruct-2507**, and **Qwen3.5-4B** (Apache 2.0, thinking on by default, ~2.7-3.0 GB at Q4_K_M). SmolLM3-3B and Gemma-3-4B are weaker or non-thinking on grounded QA. Phi-4-mini-reasoning is a math-only model. **Every 4B Q4_K_M file is larger than Fred's 2 GiB (2.147 GB) per-file GitHub Release limit.** It would have to be split into shards or quantised below ~Q3_K_M.

### Cited Findings
- **Qwen3.5-4B** (released 2026-03-02 with 0.8B, 2B and 9B):
  - Apache 2.0, 262K native context.
  - Hybrid thinking/non-thinking, natively multimodal. — [Artificial Analysis, 2026-03-05](https://artificialanalysis.ai/articles/qwen3-5-small-models)
- Qwen3.5-4B model card, architecture:
  - 32 layers in 8 blocks of (3× Gated DeltaNet + 1× Gated Attention).
  - Gated Attention has 16 Q / 4 KV heads, head dim 256. The file metadata says "5B" params.
  - 262,144 context, Apache-2.0. — [Qwen/Qwen3.5-4B](https://huggingface.co/Qwen/Qwen3.5-4B)
- Qwen3.5-4B model card, thinking and sampling:
  - **Thinking is on by default.** Turn it off with `enable_thinking: False`. Qwen3.5 does **not** support Qwen3's `/think` and `/nothink` soft switches.
  - Recommended thinking sampling: temp 1.0, top_p 0.95, top_k 20, presence_penalty 1.5.
  - The card advises keeping ≥128K context "to preserve thinking capabilities". — [Qwen/Qwen3.5-4B](https://huggingface.co/Qwen/Qwen3.5-4B)
- Qwen3.5-4B Q4_K_M GGUF sizes: ~2.7 GB (AtomicChat), 2,783,446,784 bytes (munimentai), **3.01 GB (bartowski)**. Recipes differ by uploader. — [AtomicChat](https://huggingface.co/AtomicChat/Qwen3.5-4B-GGUF); [bartowski](https://huggingface.co/bartowski/Qwen_Qwen3.5-4B-GGUF). Fred's own note lists 2.81 GB, 2.7× today's model (issue #37; `docs/results-generator-research.md`).
- Artificial Analysis Intelligence Index (reasoning variants): Qwen3.5-9B 32, **4B 27, 2B 16**, 0.8B 9. It also reported **AA-Omniscience hallucination rates of 80-82% for the 4B and 9B** [not RAG], and heavy output-token use (4B ~240M tokens on the suite). — [Artificial Analysis](https://artificialanalysis.ai/articles/qwen3-5-small-models)
- Qwen3.5-4B self-reported scores [vendor]: IFEval 89.8, IFBench 59.2, MMLU-Pro 79.1, GPQA-Diamond 76.2, LongBench v2 50.0. No text hallucination benchmark is listed. — [Qwen/Qwen3.5-4B](https://huggingface.co/Qwen/Qwen3.5-4B)
- **Phi-4-mini-reasoning** (3.8B, MIT, 128K context):
  - "Designed and tested for math reasoning only". Trained on ~1M synthetic math problems distilled from DeepSeek-R1.
  - The card warns of limited factual knowledge, and tells developers to add safeguards for "health advice".
  - AIME 57.5, MATH-500 94.6, GPQA-D 52.0. Compare Phi-4-mini base 10.0/71.8/36.9 and Llama-3.2-3B-Instruct 6.7/44.4/25.3. — [microsoft/Phi-4-mini-reasoning](https://huggingface.co/microsoft/Phi-4-mini-reasoning)
- SmolLM3-3B and Gemma-3-4B-it were benchmarked side by side with Qwen3 in OCC-RAG. Both trail Qwen3-4B on grounded QA (numbers in §2). Gemma-3-4B has no thinking mode in that table. — [OCC-RAG, arXiv 2606.00683](https://arxiv.org/html/2606.00683)
- The Qwen3-4B Q4_K_M GGUF is published by lmstudio-community. — [lmstudio-community/Qwen3-4B-GGUF](https://huggingface.co/lmstudio-community/Qwen3-4B-GGUF). I did not re-fetch its exact byte size this session (see Gaps).

### Inferences
- **Download blocker:** every 4B Q4_K_M build (~2.5-3.0 GB) is over the 2 GiB GitHub Release asset limit.
  - Options: llama.cpp's `gguf-split` shards (llama.cpp loads a split model from its first shard, but llama.rn support for split GGUFs is unverified), another host, or a ≤Q3_K_M quant.
  - Q3 has a reasoning-quality cost (§5).
- **Qwen3.5-4B carries known risks for Fred:**
  - It is the same family as the rejected 2B, with the same hybrid architecture and thinking on by default.
  - The `/think` switch Fred's harness uses does not exist on it.
  - The `<think>` tokens were non-control tokens in Fred's 2B GGUF (issue #37 comment), so the thinking-leak bug would need re-checking.
- **Qwen3-4B (original hybrid) is the cleanest A/B against today's model.** It has the same tokenizer, chat template and `/think` switch as the shipping Qwen3-1.7B, so Fred's existing thinking harness (`THINKING=1024`) applies unchanged.
- Phi-4-mini-reasoning is a poor fit: it is math-only, and its vendor says not to rely on it for health without safeguards.

### Gaps
- I did not re-fetch these this session:
  - exact Q4_K_M byte sizes for Qwen3-4B, Qwen3-4B-2507, SmolLM3-3B, Gemma-3-4B, Gemma 3n E4B and Llama-3.2-3B
  - licence texts for Gemma (Gemma Terms of Use, not OSI) and Llama 3.2 (Llama Community License)
  - context lengths for Qwen3-4B (32K native, ~131K with YaRN, from memory) and 2507 (256K, from memory)

  Check the model cards before any decision.
- 2026 successors (Gemma 4 E4B, Nanbeige4.2-3B, LFM2.5-2.6B) show up in phone benchmarks (§3). I did not evaluate their RAG faithfulness or licences.

## 2. Do 3-4B models reason better from retrieved passages than 1.7B? Does thinking at 4B stay faithful?

### Takeaway
**Yes, on published grounded-QA benchmarks, consistently and by a meaningful margin.**
- Qwen3-4B beats Qwen3-1.7B by about 5-13 points on multi-hop and counterfactual-faithfulness QA.
- In one CPU RAG study, correctness rose from 0.58 to 0.69-0.71.
- In those benchmarks, thinking mode *improved* faithfulness at both sizes, and 4B-thinking was the best Qwen3 ≤4B configuration.

**But** none of this is first aid, none of it measures "new unsafe answers", and it conflicts with Fred's own result that 1.7B thinking drifted on plant and animal facts. Qwen's own report says thinking slightly *hurts* retrieval-style long-context tasks [larger-model at 8B]. Treat it as a strong reason to run Fred's graded set, not as a prediction.

### Cited Findings
- **OCC-RAG (arXiv 2606.00683, May 2026)**, Table 2. Format: non-thinking (thinking):

  | | Qwen3-1.7B | Qwen3-4B | SmolLM3-3B | Gemma-3-4B-it |
  |---|---|---|---|---|
  | HotpotQA in-acc | 47.7 (60.9) | 60.6 (67.1) | 49.9 (56.5) | 55.8 |
  | MuSiQue in-acc | 20.1 (30.7) | 33.1 (41.5) | 21.5 (29.4) | 30.1 |
  | ConFiQA in-acc | 64.8 (70.4) | 69.7 (74.1) | 58.6 (60.5) | 69.8 |
  | ConFiQA memorisation ratio (↓) | 12.7 (8.3) | 10.3 (7.5) | 15.4 (13.3) | 8.9 |
  | MuSiQue-Un refusal acc | 54.7 (82.8) | 64.1 (84.0) | 32.1 (77.1) | 55.8 |

  - TAT-QA F1: 1.7B 74.4 (74.8), 4B 76.9 (79.1).
  - The authors' fine-tuned OCC-RAG-1.7B (60.9 / 38.2 / 81.4 / MR 5.0 / 87.2) matches or beats Qwen3-4B-thinking on faithfulness and refusal. The authors say models ≥8B "retain a lead on multi-hop reasoning". These are self-reported results. — [arXiv 2606.00683](https://arxiv.org/html/2606.00683)
- **"Little Brains, Big Feats" (arXiv 2606.30062, ECML PKDD 2026)**: Russian-language RAG, 17 SLMs, multi-judge LLM grading, CPU-only. Correctness / relevance / faithfulness / latency:

  | Model | Correct. | Relev. | Faithful. | Latency |
  |---|---|---|---|---|
  | Qwen3-1.7B Q4_K_M | 0.58 | 0.78 | 0.74 | 55 s |
  | Qwen3-4B Q5_K_M | 0.69 | 0.85 | 0.81 | 205 s |
  | **Qwen3-4B-Instruct-2507 Q5_K_M** | **0.71** | **0.89** | 0.80 | 71 s |
  | Phi-4-mini-Instruct | 0.48 | 0.68 | 0.67 | 44 s |
  | GPT-5-mini (reference) | 0.73 | 0.88 | 0.89 | — |

  - The authors picked Qwen3-4B-Instruct-2507 for production as the best quality/latency trade-off.
  - The 205 s for Qwen3-4B against 71 s for 2507 is unexplained in the paper. — [HF papers 2606.30062](https://huggingface.co/papers/2606.30062)
- Fred's earlier lead (issue #37): arXiv 2601.07790 has Qwen3-4B at 95.64% while Qwen3-1.7B *declined* under RAG (43.30% → 28.96%). That task is log-severity classification, not QA. — [arXiv 2601.07790](https://arxiv.org/pdf/2601.07790)
- **Qwen3 technical report** [not RAG]. Format: thinking / non-thinking:

  | | 1.7B | 4B |
  |---|---|---|
  | MMLU-Redux | 73.9 / 64.4 | 83.7 / 77.3 |
  | GPQA-D | 40.1 / 28.6 | 55.9 / 41.7 |
  | IFEval strict | 72.5 / 68.2 | 81.9 / 81.2 |
  | Arena-Hard | 43.1 / 36.9 | 76.6 / 66.2 |
  | Multi-IF | 51.2 / 44.7 | 66.3 / 61.3 |
  | AIME'25 | 36.8 / 9.8 | 65.6 / 19.1 |

  — [Qwen3 Technical Report, arXiv 2505.09388](https://arxiv.org/html/2505.09388)
- Qwen3 report, RULER long-context retrieval (Table 23):
  - 4B: avg 85.2 non-thinking against 83.5 thinking. 8B: 89.1 against 84.4.
  - The report says performance "slightly degrades" in thinking mode, and suggests thinking does not help retrieval-style tasks and may interfere.
  - No 1.7B RULER numbers. The report has no small-model hallucination benchmark and no budget-scaling curve below 235B. — [arXiv 2505.09388](https://arxiv.org/html/2505.09388)
- **Fred's own results:**
  - 1.7B thinking (`/think`, ≤1,024 reasoning tokens, temp 0.6): about 3.5 rubric points worse, **1 new unsafe answer** (`uv-smoke-01`, "campfire smoke ... water purification"), roughly 2× the time. It helped first-aid procedure and hurt plant and animal facts. — `docs/results-thinking.md`
  - Qwen3.5-2B: 32/61 against 38/61, red flags 3 → 8. Yet it fixed 7 baseline failures, including the `fa-choke-01` inversion. — `docs/results-qwen35-2b.md`
- **Medical QA by size:** no clean head-to-head of Qwen3-1.7B, Qwen3-4B, Phi-4-mini and Llama-3.2-3B on MedQA was found.
  - A 2026 clinical-QA study found Llama 3.2 most accurate among its small models (49-65% across MedQA, MedMobile and PubMedQA). It did not include Qwen3. — [search result, arXiv 2603.00917](https://arxiv.org/html/2603.00917v3)
  - MedPsy (NeurIPS 2026 poster) fine-tunes Qwen3 1.7B and 4B for medicine. It reports MedPsy-4B +19.34 points over MedGemma-1.5-4B, with no base 1.7B-vs-4B split in the snippet. — [NeurIPS 2026 poster](https://neurips.cc/virtual/2026/poster/150557)

### Inferences
- The size gap at 1.7B → 4B is largest exactly where Fred fails: multi-hop (MuSiQue +13 points) and using context over memory (ConFiQA in-acc +5, MR down).
  - Fred's diagnosis: "right passage in hand, model misread it" in ~7 of 23 wrong answers, plus inversions (`docs/results-strategy-research.md`).
  - The 2B run showed the bigger model fixes inversions such as `fa-choke-01`.
- The thinking evidence is mixed by task type:
  - Benchmarks say thinking helps short multi-hop and counterfactual QA (sub-1K-token contexts, similar to Fred's 4 passages).
  - Qwen's own report says it hurts long retrieval [larger-model].
  - Fred says it hurt descriptive species facts at 1.7B.
  - A reasonable guess: 4B-thinking drifts less than 1.7B-thinking, but not zero. No published benchmark counts "added unsafe claims", so Fred's zero-new-unsafe rule can only be checked on Fred's own graded set.
- **Qwen3-4B-Instruct-2507 (non-thinking) is a strong dark horse for "deep mode".** It scored best on correctness in the CPU RAG study at a third of Qwen3-4B's latency. A bigger model *without* a long reasoning trace may deliver most of the gain at a fraction of the phone time and drift risk.
- A fine-tuned 1.7B (OCC-RAG-style faithfulness training) matched 4B-thinking on faithfulness and refusal. That is a credible alternative path to "reason better from passages" with no new download.

### Gaps
- No published grounded-QA evaluation measures *new unsafe or contradicting claims* by model size or thinking mode.
- No faithfulness numbers for Qwen3.5-4B or Qwen3-4B-Thinking-2507 on RAG benchmarks (FaithEval, RAGTruth, FRAMES, ContextualBench) were found.
- I did not fetch FaithEval, RAGTruth or ContextualBench leaderboards.

## 3. Phone feasibility: speed, memory, swap-in time, thermals

### Takeaway
It is feasible on flagship phones, but slow.
- Published 3-4B speeds: **~14-17 tok/s decode on iPhone 17 Pro** (1 measured 3B, estimates for 4B) and **~7-8 tok/s on Snapdragon 8 Elite-class CPUs** (Gemma 4 E4B).
- On Fred's 8s Gen 4 CPU, a 4B deep answer with 500-1,500 reasoning tokens would likely take **~1-3 minutes** (prefill ~15-30 s, then decode). Sustained-load throttling cuts throughput by up to ~40% over 10 minutes.
- Memory fits if the 1.7B is unloaded first: ~4-4.5 GB app total.

### Cited Findings
**iPhone**
- Artificial Analysis (2026-08-24), iPhone 17 Pro, llama.cpp ≤4-bit, 1,024-token prompt + 256-token output, end to end:
  - **Nanbeige4.2-3B: 21.4 s, ~14 tok/s output, 4.0 GB peak** (4K context).
  - LFM2.5-2.6B: 8.0 s, 2.3 GB.
  - Qwen3.5-9B: >25 s, 6.9 GB. — [Artificial Analysis](https://artificialanalysis.ai/articles/mobile-phone-intelligence-inference)
- Same source, "one-minute generation budget" scores, showing how reasoning models suffer on a phone time budget: Qwen3.5-9B (Reasoning) fell to 14 and Nanbeige4.2-3B to 18, while non-reasoning Gemma 4 E4B scored 44. — [Artificial Analysis](https://artificialanalysis.ai/articles/mobile-phone-intelligence-inference)
- Qwen3.5-4B Q4_K_M on iPhone 17 Pro: **16.5 tok/s, 3.4 GB [estimate]**. Qwen3-4B Q4_K_M on iPhone 16 Pro: 14.5 tok/s, 4.2 GB [estimate]. — [llmrun.dev iPhone 17 Pro](https://llmrun.dev/device/iphone-17-pro); [localmodel-run](https://localmodel-run.pages.dev/can-i-run/qwen3-4b/iphone-17)
- Measured, iPhone 17 Pro, llama.cpp Q4_K_M: Qwen3.5-2B 39.1 tok/s at 1,479 MB peak. — [john-rocky, DEV](https://dev.to/john-rocky/on-device-llm-on-iphone-which-runtime-is-fastest-mlx-vs-llamacpp-vs-litert-lm-vs-coreml-1b42)
- **Sustained 10-minute runs** (unplugged iPhone 17 Pro, Gemma 4 E2B, July 2026): LiteRT-LM 57.1 → 35.4 tok/s, MLX 45.7 → 25.1 tok/s (first 5 s against the last 10%). — [apple-silicon-llm-bench](https://github.com/john-rocky/apple-silicon-llm-bench)

**Android**
- Gemma 4 E4B Q4_K_M, llama.cpp via Termux, Oppo Find N5 (Snapdragon 8 Elite, 16 GB): **7-8 tok/s**, sub-second first token. — [search summary of DEV write-up](https://dev.to/baiju_rajyaguru_a70384dfd/i-ran-gemma-4-on-a-mid-range-android-phone-heres-what-actually-happened-40ge)
- The same model on a mid-range Galaxy A35 (llama.cpp-based PocketPal): 3.4-3.6 tok/s. — [DEV](https://dev.to/baiju_rajyaguru_a70384dfd/i-ran-gemma-4-on-a-mid-range-android-phone-heres-what-actually-happened-40ge)
- Gemma 4 E4B on Galaxy S26 Ultra CPU with LiteRT-LM (not llama.cpp): 18 tok/s [vendor]. — [Google LiteRT-LM Gemma 4](https://developers.google.com/edge/litert-lm/models/gemma-4)
- Gemma 3n E4B on CPU, Galaxy Z Fold 4 (2022): ~7.1 tok/s decode, ~35 tok/s prefill. — [Hacker News](https://news.ycombinator.com/item?id=44044199)
- Xiaomi Pad 8 Pro (8 Elite, a tablet; model unnamed in the snippet), llama-bench:
  - CPU: pp512 24.17 / tg128 7.95 t/s.
  - Adreno 830 OpenCL: pp512 ~562 / tg128 31.4. — [llama.cpp discussion #23736](https://github.com/ggml-org/llama.cpp/discussions/23736)
- **Qwen3-4B Q4_0, llama.cpp b7588, Snapdragon 8 Gen 3 (16 GB, Android 15), ~1,281-token prompt, 6 threads** (arXiv 2605.27435, 2026-05-22):
  - Prefill MUL_MAT: CPU 7,181 µs per call against NPU 10,352 (NPU 1.44× slower).
  - Decode: CPU 324 µs against NPU 210 (1.55× faster), but end to end only 1.05×.
  - Full NPU offload raised battery drain 22-51% (Llama-3.2-3B).
  - No absolute tok/s in text. — [arXiv 2605.27435](https://arxiv.org/html/2605.27435)
- Fred's phone (same SoC family as the target):
  - Qwen3-0.6B pp512 ~420 / tg128 ~75 t/s.
  - 1.7B in-app prefill ~80 tok/s (derived), TTFT 6-8.7 s.
  - Model load 4.65 s with 8 threads (18.2 s with 4).
  - GPU and Hexagon offload produced "fluent nonsense". — `docs/deep-thinking/research-2026-11-20/on_device_feasibility.md`; `docs/results-m3.md`

**Memory**
- Fred today: 2.9 GB PSS with 1.7B + EmbeddingGemma in one context. Each extra llama.rn context held its own ~0.8 GB copy of the weights. — `docs/results-cold-start-memory.md`
- iOS with `increased-memory-limit`: ~6 GB practical ceiling measured on Pro models (task brief and `on_device_feasibility.md`).
- Aggregator figures for iOS per-app memory: ~5 GB on 8 GB iPhones and ~7 GB on 12 GB iPhone 17 Pro [estimate]. These conflict slightly with Fred's measured ~6 GB. — [llmrun.dev](https://llmrun.dev/device/iphone-17?featured=0)

### Inferences
- **Speed scaling:** decode is memory-bandwidth-bound, so a 4B Q4_K_M (~2.5-2.8 GB) decodes about 2.3-2.5× slower than the 1.11 GB 1.7B, and prefill scales similarly. On the Nothing Phone (3) CPU, expect roughly:
  - **Prefill ~30-35 tok/s** (80 ÷ 2.4), so the ~600-1,100-token RAG prompt costs **~18-35 s** before the first reasoning token.
  - **Decode ~7-11 tok/s** (consistent with the 8 Elite Gemma 4 E4B figure).
  - Per deep answer: 500 reasoning + 150 answer tokens ≈ 60-90 s of decode. 1,500 + 150 ≈ 150-240 s. **Total ~1.5-4.5 minutes**, plus throttling (the iPhone loses ~40% over 10 minutes; Android CPU throttling was not measured for 4B).
  - iPhone 17 Pro (~15 tok/s): ~45 s-2 min.
  - This is an inference from scaling, not a measurement. Run `context.bench` or llama-bench on the device first.
- **Qwen3.5-4B is cheaper on KV memory than Qwen3-4B:**
  - Qwen3.5-4B has only 8 full-attention layers × 4 KV heads × dim 256, ≈ 32 KB/token at f16 (≈130 MB at 4K), plus a fixed recurrent state.
  - Qwen3-4B (36 layers, 8 KV heads × 128, from memory of its config, unverified this session) is ≈ 147 KB/token (≈ 0.6 GB at 4K).
  - Hybrid models need llama.rn's state checkpoints for prefix reuse, and they block classic draft speculation (`on_device_feasibility.md`).
- **Swap-in plan:**
  - Release the 1.7B context, then load the 4B. Load time should scale from Fred's 4.65 s to roughly 10-15 s from flash (UFS 4.x read speed is not the bottleneck; weight repacking and mmap page-in are). It is faster if the OS page cache still holds the file.
  - Peak memory: 2.9 GB − ~1.1 GB (1.7B weights) + ~2.6-2.8 GB (4B) + KV ≈ **4.2-4.8 GB**. This fits the ~6 GB iOS Pro ceiling and a 12 GB Android phone.
  - Never hold both models loaded: that would be ~5.5-6 GB, and an extra context duplicates weights.
  - Swapping back costs another ~5 s, and the saved lane `.session` files are model-hashed, so they are invalid for the 4B. The 4B needs its own lane caches or none (deep mode only needs the answer lane).
- Deep mode should stream visible progress, and disable itself or warn on low battery or high thermal state.

### Gaps
- No measured llama.cpp prefill or decode for any 4B on Snapdragon 8s Gen 4, 8 Elite phones, or iPhones. The snapbench results JSON and Qualcomm's QMX blog (April 2026) were not readable.
- No published cold-load times for 4B GGUFs on phones.
- No thermal data for a 1-3 minute 4B CPU run on Android.

## 4. Which phones could run it, and product patterns

### Takeaway
Gate deep mode to devices with ≥8 GB RAM on iOS (iPhone 15 Pro and later) and ≥12 GB on Android, measured at runtime. Ship it as an optional extra download (~2.5-3 GB) with an explicit "takes 1-3 minutes" label. 6 GB Android phones and 6 GB iPhones should not get it. 8 GB Android phones are marginal and need testing.

### Cited Findings
- Artificial Analysis's phone suite required models to fit within 8 GB including the KV cache at 8K. — [Artificial Analysis](https://artificialanalysis.ai/articles/mobile-phone-intelligence-inference)
- An aggregator rates base iPhone 17 (8 GB, A19) as able to run "up to 4B" with ~5 GB usable per app. Qwen3-4B Q4_K_M needs ~3.8 GB at 4K context [estimate]. — [llmrun.dev iPhone 17](https://llmrun.dev/device/iphone-17?featured=0); [localmodel-run](https://localmodel-run.pages.dev/can-i-run/qwen3-4b/iphone-17)
- Mid-range Android phones (Galaxy A35) reached only ~3.5 tok/s on a 4B-class model. That would mean ~5-8 minutes for a 1,500-token reasoning trace. — [DEV](https://dev.to/baiju_rajyaguru_a70384dfd/i-ran-gemma-4-on-a-mid-range-android-phone-heres-what-actually-happened-40ge)
- A RunAnywhere SDK test ran Qwen3-4B Q4_K_M via llama.cpp on a Galaxy S24 (8 Gen 3). It was the only model to complete their agent tasks, but no speed was reported. — [RunAnywhere assessment](https://runanywhereai.github.io/runanywhere-sdks/Playground/android-use-agent/ASSESSMENT.html)

### Inferences
- **iOS:**
  - The 8 GB devices are iPhone 15 Pro/Pro Max, all iPhone 16s and iPhone 17. The 12 GB ones are the 17 Pro and Pro Max.
  - Older 6 GB iPhones (iPhone 15/14) likely cannot hold ~4.5 GB under jetsam.
  - The ~6 GB measured ceiling is from Pro models. Confirm on an 8 GB non-Pro.
  - Use `os_proc_available_memory()` at runtime rather than a model list.
- **Android:**
  - 12 GB flagships (8 Gen 3 and later, 8s Gen 4, 8 Elite) are comfortable.
  - 8 GB phones may fit ~4.5 GB but face low-memory-killer pressure.
  - 6 GB phones: no.
  - Gate on `ActivityManager.MemoryInfo.totalMem` plus a decode-speed self-test (for example, refuse if a quick bench gives <5 tok/s).
- **Product pattern:**
  - Deep mode is opt-in: an extra pack download, ideally on Wi-Fi.
  - The UI says "slower, more careful", streams a progress indicator (not the raw think trace), and offers cancel.
  - Never use deep mode for emergencies (fire, bleeding, choking): those keep the 3 s card path.
  - Fall back to the 1.7B if the load fails or memory is low.
- Given the iOS external-testing goal, any new pack and download changes the app-size and privacy story only marginally (it stays offline). Apple's guidelines on on-demand content still apply. That is a note to check, not researched here.

### Gaps
- No source measured jetsam limits on 8 GB non-Pro iPhones with the increased-memory entitlement.
- No data on 8 GB Android phones running 4B under real app memory pressure.

## 5. Smaller quantisations (Q3_K, IQ4_XS) and reasoning quality

### Takeaway
4-bit is near-lossless for reasoning. 3-bit is "risky", and it hurts small models and hard multi-step tasks most. Quantised reasoning models also **think longer** (token inflation), which on a phone means slower answers. IQ4_XS is the only sensible way below Q4_K_M. Q3_K to squeeze under the 2 GiB file limit is not advisable for a safety-critical deep mode.

### Cited Findings
- "Quantization Hurts Reasoning?" (Liu et al., arXiv 2504.04823):
  - 4-bit weight-only is nearly lossless, and 3-bit becomes risky (≥3% drop).
  - Harder tasks (AIME) degrade up to 4× more than easy ones (GSM8K).
  - Models studied: R1-distilled 1.5B-70B and Qwen3-8B. — [arXiv 2504.04823](https://arxiv.org/html/2504.04823v2)
- A 2026 follow-up reports that **Qwen3-4B suffers a large absolute AIME25 drop under INT4, and INT3 increases degradation further**. Qwen3-30B stays within negligible-to-moderate drops. — [search summary; arXiv 2601.14888](https://arxiv.org/html/2601.14888v1)
- Token inflation: 3-bit AWQ cut MATH-500 from 85.6% to 47.0% and lengthened average chains of thought from 5.2K to 23.4K tokens. The effect was strongest for smaller models. — [search summary; arXiv 2606.25519 / 2606.00206](https://arxiv.org/pdf/2606.25519)
- 4-bit group-wise (g128) QAT is near-lossless. 3-bit has large drops, "remarkably larger on reasoning tasks". — [arXiv 2601.14888](https://arxiv.org/html/2601.14888v1)

### Inferences
- These are math-reasoning results, with GPTQ/AWQ-style quantisers rather than llama.cpp K-quants. The direction should transfer, but the magnitudes may not.
- For Fred: use Q4_K_M (or IQ4_XS for ~10% less memory and bandwidth), and solve the 2 GiB file limit by sharding, not by dropping to Q3.
- Longer think traces under quantisation compound the phone latency problem. Cap the reasoning budget (Fred's `THINKING=1024`) and measure trace length on the device's actual quant.

### Gaps
- No published RAG or faithfulness evaluation of Q3_K or IQ4_XS against Q4_K_M at 4B was found.
- llama.cpp K-quant-specific reasoning studies (perplexity aside) were not found.
