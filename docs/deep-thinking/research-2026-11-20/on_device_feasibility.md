# On-device feasibility and compute budget for "deep thinking" (multi-pass inference) in Fred

Researched 2026-11-20. Scope: phones only. Fred's own phone measurements, from this repo, are cited as repo paths. They are the most relevant numbers here: same model, same runtime (llama.rn 0.12.9), same phone (Nothing Phone (3), Snapdragon 8s Gen 4, 12 GB RAM, Android 15, CPU only).

## 1. Measured prefill and decode speed for ~0.6-2B Q4 models on recent phones, and the cost of a 4-passage prompt

### Takeaway
On Fred's own phone (8s Gen 4, CPU, 8 threads), llama.cpp prefills Qwen3-0.6B at ~420 tok/s. In the app, a Qwen3-1.7B answer's first token arrives in 6-9 s, and a model-written answer takes 15.3 s on average. So **prefill of the 4-passage prompt (≈0.6-1.1k uncached tokens) is the single largest cost of one pass, ~6-9 s.** A 2,000-2,500-token prompt would cost roughly 15-30 s of prefill on this CPU. Recent iPhones decode a ~2B Q4 model at ~40 tok/s with llama.cpp on Metal (A19 Pro), but no published llama.cpp iPhone prefill figure was found for this model size.

### Cited Findings
**Fred's own phone (Nothing Phone (3), SM8735 / 8s Gen 4, llama.cpp CPU)**
- `llama-bench` with Qwen3-0.6B-Q4_K_M, 8 threads: pp512 **415-421 t/s**, tg128 **75-76 t/s**. On the 2 little cores only: 101.6 / 30.6 t/s. — `docs/results-m0.md`
- In the app, Qwen3-0.6B prefilled a 1,095-token prompt in **2,402 ms**, matching the llama-bench projection (1095/420 ≈ 2.6 s). Retrieval took 159 ms. — `docs/results-m3.md`
- Qwen3-1.7B in the app: time to first token **6.0-8.7 s** over about 570 uncached tokens. The repo estimates this at "about 80 tokens a second on the phone's CPU" (derived, not measured directly). — `docs/results-memory-research.md`
- A-KR3 (2026-10-07, 40 held-out questions): model-written answers had a **mean of 15.3 s and a median of 14.3 s (range 8.2-24.1 s)**. Field-card answers averaged 3.7 s and declines 1.5 s. — `docs/METRICS.md`
- An earlier phone run (2026-09-24): TTFT was 7.6 s for "black bears in this state" (8.3 s total) and 11.0 s for "signal for rescue" (14.4 s total). — `docs/METRICS.md`
- llama.rn defaulted to 4 threads; setting 8 cut model load from 18.2 s to 4.65 s. — `docs/results-m3.md`
- GPU offload (OpenCL + Hexagon HTP via llama.rn's auto `n_gpu_layers`) produced "fluent nonsense", and CPU was faster end to end (4.8 s vs 12.1 s). — `apps/mobile/src/device-pack.ts`. A q8_0 KV cache with flash attention produced word salad and was slower (4.7 s vs 2.4 s TTFT). — `docs/results-m3.md`

**iPhone**
- iPhone 17 Pro (A19 Pro, iOS 26.4.2), 128-token generation, median of 3 cold runs: **llama.cpp GGUF Q4_K_M, Qwen 3.5 2B: 39.1 tok/s decode, 1,479 MB peak**. MLX 4-bit on the same model reached 61.2 tok/s, CoreML/ANE 27.9 tok/s. No prefill numbers. Posted June 2026. — [john-rocky, DEV](https://dev.to/john-rocky/on-device-llm-on-iphone-which-runtime-is-fastest-mlx-vs-llamacpp-vs-litert-lm-vs-coreml-1b42)
- Artificial Analysis (iPhone 17 Pro, llama.cpp, ≤4-bit, 1,024-token prompt + 256-token response, end to end): LFM2.5-2.6B took **8.0 s** at 2.3 GB peak, MiniCPM5-1B 2.9 s, Nanbeige4.2-3B 21.4 s (~14 tok/s). They did not report a separate prefill figure. — [Artificial Analysis](https://artificialanalysis.ai/articles/mobile-phone-intelligence-inference)
- iPhone 16 Pro (A18 Pro), MLX Metal, Qwen2.5-1.5B 4-bit: 37.6 tok/s in iterations 1-2 (peak 40.4), falling to **22.6 tok/s once hot** (iterations 8-20). — [arXiv 2603.23640](https://arxiv.org/html/2603.23640v1)
- iPhone 15 Pro in PocketPal (a llama.cpp app): prompt processing 205 tok/s and generation 13.8 tok/s, model unspecified. — [Gigazine via search](https://www.gigazine.net/gsc_news/en/20260330-pocketpal-ai)
- A 2025 llama.cpp study measured a 1B model on the iPhone 15 Pro at 17 tok/s on CPU vs 12.8 on GPU. This is from a search snippet only; I did not fetch the paper. — [arXiv 2505.06461](https://arxiv.org/html/2505.06461v1)

**Android SoCs (published)**
- llama.cpp on CPU: Snapdragon 8 Gen 3 reaches about 80% of the Dimensity 9300's throughput. Prefill on the Dimensity 9300 is about 60% of an M1's at 64-token prompts and about 20% at 512 tokens. Instruction acceleration (i8mm/dotprod) gives **2.19× prefill**. On the GPU, prefill was **7.81× faster than CPU** with 87.8% less prefill energy (MLC, Pad 6 Pro). Adreno 750 reaches about 20% ALU utilization in prefill; Mali prefill is about 10× slower than Adreno. — [Li et al., arXiv 2410.03613v5](https://arxiv.org/html/2410.03613v5)
- Galaxy S24 Ultra (8 Gen 3), MLC-LLM on Adreno 750, Qwen2.5-1.5B 4-bit: **9.9 tok/s decode, prefill 25.1 s** for the paper's prompt. The GPU was floored at 231 MHz by iteration 6. — [arXiv 2603.23640](https://arxiv.org/html/2603.23640v1)
- On the 8 Gen 3 Hexagon NPU with llama.cpp b7588 and a ~1,281-token prompt, prefill matmuls were **1.27-1.62× slower** than CPU, while decode matmuls were 1.55-1.67× faster. Full NPU offload drained **22-51% more battery** than CPU, more for longer prompts. — [arXiv 2605.27435](https://www.alphaxiv.org/abs/2605.27435.md)
- Arm SME2 (C1-Pro core, 1 thread, Llama-3.2-3B Q4_0): KleidiAI SME2 gave 12.3/9.1 tok/s prefill/decode, vs 7.9/5.9 without, about 1.55× faster. SME2 needs the newer Arm v9.3 cores (C1 family). — [Arm Learning Path](https://learn.arm.com/learning-paths/mobile-graphics-and-gaming/performance_llama_cpp_sme2/run_llm/)
- llama.cpp's OpenCL backend lists Adreno 830 (8 Elite) and 840 (8 Elite Gen 5) as verified. Q4_0 is the optimized path, and the docs recommend `--pure` Q4_0 quantization. They note Qwen2.5-0.5B produces gibberish on the Adreno kernels. — [llama.cpp OPENCL.md](https://raw.githubusercontent.com/ggml-org/llama.cpp/HEAD/docs/backend/OPENCL.md)

### Inferences
- From Fred's numbers, one 1.7B pass on the Nothing Phone costs about 6-9 s of prefill plus 5-10 s of decode. A 2,000-2,500-token prompt on the same CPU would cost about 2-4× the current prefill, roughly 15-30 s for prefill alone. That makes "8 passages instead of 4" expensive on Android CPU.
- Extrapolating from 0.6B's 420 tok/s to 1.7B (about 3× the compute per token) suggests about 120-150 tok/s prefill. The in-app estimate of about 80 tok/s is lower, possibly because of chat-template overhead, threading, or thermal state. A `context.bench()` run on the device would settle it (llama.rn exposes `bench(pp, tg, pl, nr)`).
- iPhone Metal is likely 1.5-3× faster than the Nothing Phone's CPU in both phases, judging from the 2B Q4_K_M decode figure of 39 tok/s on the A19 Pro and 8 s end to end for a 2.6B model at 1k+256 tokens. Older iPhones (A16, A17) will be slower. Budget for the Android phone as the binding case.
- The repo's backlog already names Q4_0 repacking (KleidiAI) and 6 threads as untested prefill wins (`docs/results-strategy-research.md` 4.1/4.2). Any multi-pass mode benefits multiplicatively from these.

### Gaps
- No published llama.cpp **prefill** tok/s was found for a ~1.5-2B model on the A17/A18/A19 Pro, or for the CPU of the Snapdragon 8 Gen 3 / 8 Elite / Dimensity 9400. Most public numbers are decode only, or use MLX or MLC instead of llama.cpp.
- Fred's Qwen3-1.7B decode tok/s on the phone is not recorded directly in the docs I read.

## 2. llama.cpp / llama.rn features that make multi-pass cheap (verified in installed llama.rn 0.12.9)

### Takeaway
llama.rn 0.12.9, already in Fred, exposes nearly everything multi-pass needs:
- prefix KV reuse (automatic, plus session files)
- a parallel slot API (`n_parallel`, `context.parallel.completion/embedding/rerank`) with per-request state save/load
- per-token top-N probabilities (`n_probs`)
- GBNF grammar and JSON schema
- `logit_bias`
- a rerank endpoint (`pooling_type: 'rank'`)
- speculative decoding, both draft-model and MTP

Classifier-free guidance is not exposed. The cheapest multi-pass shape is **prefill once, branch many decodes**: N samples share the expensive prompt.

### Cited Findings
- `completion()` params in `node_modules/llama.rn/src/types.ts` (0.12.9) include:
  - `n_probs` ("probabilities of top N tokens for each generated token"). The result carries `completion_probabilities: [{content, probs:[{tok_str, prob}]}]`.
  - `grammar`, `grammar_lazy`, `grammar_triggers`, and `json_schema` (converted to grammar)
  - `logit_bias`, DRY sampling params, `n_predict: 0` ("prompt is evaluated into the cache")
  - per-request `speculative`
  - `load_state_path`, `save_state_path`, `save_prompt_state_path` for "conversation continuity across requests"
  - Context params include `n_parallel`, `kv_unified` ("Try to disable when n_seq_max > 1 ... when the sequences do not share a large prefix"), `cache_type_k/v`, `ctx_shift`, `swa_full`, `model_draft`, and `speculative`. — local source, `node_modules/llama.rn/src/types.ts`
- Parallel API: `context.parallel.enable({n_parallel, n_batch})`, `.completion(params, onToken)`, `.embedding()`, `.rerank()`, `.disable()`, and status subscribe. Each request returns `{requestId, promise, stop}`. The native slot manager has a `slot_prompt_similarity` threshold for cache reuse and supports continuous batching. — [llama.rn README](https://github.com/mybigday/llama.rn); `node_modules/llama.rn/cpp/rn-slot-manager.h`
- Prefix reuse: `find_common_prefix_length` keeps the shared prefix in the KV cache and drops the rest (`llama_memory_seq_rm`). For pure-attention models, "seq_rm already reuses the prefix for free". State checkpoints are used only for recurrent, hybrid, or SWA models. — `docs/results-memory-research.md`; `node_modules/llama.rn/cpp/rn-completion.h`
- Fred already saves each lane's system prompt to `lane-<kind>-<hash>.session` and loads it back, so a lane call reads only the differing part. Answers deliberately start from an empty context, because a saved answer prompt changed wording relative to the graded desktop runs. — `apps/mobile/src/device-pack.ts`
- `context.rerank(query, documents, {normalize})` requires `embedding: true` and `pooling_type: 'rank'`. Speculative decoding has two modes: `type: 'draft-mtp'` (needs MTP/NextN layers in the GGUF) and `type: 'draft-simple'` with `draft: {model, n_gpu_layers}`. The draft "must share a vocabulary or it throws". Stats are returned as `draft_tokens` and `draft_tokens_accepted`. — [llama.rn README](https://github.com/mybigday/llama.rn)
- llama.cpp supports Qwen3-Reranker-0.6B via `--reranking --pooling rank`, if the GGUF was made by the official converter (extracting the yes/no `cls.output.weight` and setting pooling_type = RANK). Many community conversions are broken and return 0.0000 scores. ggml-org publishes a Q8_0 build. — [Voodisss model card](https://huggingface.co/Voodisss/Qwen3-Reranker-0.6B-GGUF-llama_cpp); [ggml-org Q8_0](https://huggingface.co/ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF)
- Speculative decoding evidence for small targets is weak:
  - With a Qwen3-30B target, the 0.6B draft trailed the 1.7B draft by about 25-35%. — [arXiv 2509.04474 via search](https://arxiv.org/pdf/2509.04474)
  - A Qwen3-0.6B EAGLE-3 card says "on CPU-only, the dual-model overhead outweighs speculation benefits for small models". — [qwen3-eagle card](https://huggingface.co/ichsanlook/qwen3-eagle)
  - No measurement of a Qwen3-0.6B draft for a Qwen3-1.7B target was found.
- llama.rn rejects classic draft speculation for recurrent/hybrid models ("not supported yet"). — [llama.rn README](https://github.com/mybigday/llama.rn)

### Inferences
- **Self-consistency (3-5 samples) can share one prefill.**
  - Prefill the prompt once with `n_predict: 0`, or keep the KV after the first answer, then sample further answers. Each reuses the full prompt prefix and pays decode only.
  - Run serially on the Nothing Phone, that's about 7 s of prefill plus N × 5-10 s of decode. For N=3 that's about 25-35 s, N=5 about 35-55 s. This roughly matches the handoff's 40-70 s guess, minus repeated prefill.
  - Batched slots (`n_parallel`) could cut decode further, since decode on phones is bandwidth-bound and a batch of 3 costs less than 3× one stream. This is unmeasured on this phone; `context.bench(pp, tg, pl=3, nr)` measures it directly.
- **`n_probs` enables cheap confidence and "verifier" signals with no extra pass.** Examples: the mean token probability over a drafted sentence, or the probability of "yes" in a one-token yes/no check under a GBNF `("yes"|"no")` grammar. A one-token judge over an already-prefilled context costs only the judge prompt's prefill (tens to a few hundred tokens), not a full answer.
- Speculative decoding with Qwen3-0.6B is unlikely to pay off on Android CPU. The draft competes for the same cores and memory bandwidth, so the speedup isn't worth testing before other levers. MTP needs a model with MTP heads, which Qwen3-1.7B lacks (my understanding, unverified).
- Determinism caveat (from Fred's own finding): reusing cached state can change greedy output if the prompt is read in different chunks. Any shared-prefix scheme must be graded on the device's actual code path, not assumed equal to the desktop's.

### Gaps
- Classifier-free guidance / negative prompts: not present in llama.rn's types (no `cfg_scale` or guidance field found). Upstream llama.cpp's CFG support status in 2026 was not checked.
- No measured latency for `context.rerank` on a phone, and no measured speedup for `n_parallel` batching on a phone CPU.

## 3. Memory: can a phone hold Qwen3-1.7B + EmbeddingGemma + a ≤600 MB checker at once? iOS and Android limits

### Takeaway
On Android (Nothing Phone, 12 GB), Fred runs at **2.9 GB PSS** with the 1.7B and EmbeddingGemma loaded. Adding a ~400-650 MB reranker or 0.6B checker plus its KV fits under the project's 3-4 GB budget. On iOS, the practical ceiling with `increased-memory-limit` is reported at **about 6 GB on 8 GB and 12 GB Pro iPhones**, so 3.5-4 GB is comfortable there. The trap is extra llama.rn contexts: each one held its own ~0.8 GB copy of the weights.

### Cited Findings
- Phone peak memory: 2.90 GB PSS (phase 1) and 2.92 GB after the shared-context fix. Before the fix, separate contexts pushed the app to 5.40 GB, because "each context held its own copy of the weights, about 0.8 GB". — `docs/METRICS.md`; `docs/results-cold-start-memory.md`; `apps/mobile/src/device-pack.ts`
- KV for Qwen3-1.7B in f16 is about 112 KB/token. The 4,096-token window is about 450 MB, allocated at init. — `docs/results-memory-research.md`
- File sizes: Qwen3-0.6B-Q4_K_M is 372.65 MiB (`docs/results-m0.md`). EmbeddingGemma-300M Q8_0 is 334 MB. The 4B model was ruled out by the 3-4 GB budget (`docs/results-strategy-research.md`).
- iOS: Apple says the increased limit "is only available on some device models" and that apps must cope without it. — [Apple entitlement doc](https://developer.apple.com/tutorials/data/documentation/bundleresources/entitlements/com.apple.developer.kernel.increased-memory-limit.md)
- Measured with `os_proc_available_memory()` + `phys_footprint`:
  - iPhone 16 Pro Max (8 GB) with `increased-memory-limit`: about **6,144 MB**
  - iPhone 17 Pro Max (12 GB): also about 6,144 MB. Adding `extended-virtual-addressing` changed nothing. Adding `increased-debugging-memory-limit` gave about 6,656 MB.
  - No Apple reply (June 2026). — [Apple Dev Forums 834805](https://developer.apple.com/forums/thread/834805)
- Older reports show 4 GB iPhones hitting jetsam at about 2,098 MB, and the entitlement having no effect on some older devices (iPhone 8). — [Apple forums search results](https://developer.apple.com/forums/thread/688973)
- llama.cpp Q4_K_M peak on iPhone 17 Pro: Qwen 3.5 2B 1,479 MB, Gemma 4 E2B 3,156 MB. Gemma 4 E2B under LiteRT-LM INT4 used 641 MB. — [john-rocky, DEV](https://dev.to/john-rocky/on-device-llm-on-iphone-which-runtime-is-fastest-mlx-vs-llamacpp-vs-litert-lm-vs-coreml-1b42)

### Inferences
- Adding Qwen3-0.6B (373 MB, plus about 100-200 MB KV at 1-2k context) or Qwen3-Reranker-0.6B (Q8_0 is probably about 600-650 MB; I did not verify the size) to Fred would raise Android PSS from about 2.9 GB to about 3.4-3.8 GB. That's within budget, but only if the checker is its own small context and the 1.7B is not loaded twice.
- `n_parallel` slots add KV, not weights. With a unified KV buffer, 3 slots sharing a ~1.1k-token prefix plus 3 × 300 decode tokens fit in the existing 4,096-token (~450 MB) window. Otherwise, n_ctx grows about 112 KB/token. This is consistent with the repo's KV figure, but untested.
- iPhones with 6 GB RAM (some older models still on supported iOS versions) will have much less headroom than the ~6 GB budget measured on 8 GB+ Pro models. Gate any extra model on `os_proc_available_memory()`.

### Gaps
- No measured iOS jetsam limit without the entitlement on 8 GB non-Pro iPhones (for example the iPhone 17), and no official Apple figures.
- Android per-app limits: no hard per-process cap was researched. Android's low-memory killer acts on system pressure, not a fixed per-app quota. Fred's 12 GB phone is not a constrained case; 8 GB Androids are untested.

## 4. Thermal throttling, battery cost and UX for 30-70 s of sustained inference

### Takeaway
Battery is not the constraint: 5 passes cost about 1% of a battery. **Heat is.** Fred's own phone hit **86-100 °C on CPU cores after 82 s of sustained generation**. Phones lose about 30-60% of throughput within tens of seconds to a few minutes. A 40-70 s deep-thinking run will slow itself down partway through, and back-to-back runs will be slower still.

### Cited Findings
- Nothing Phone (3) CPU temperatures: 32-35 °C at idle, 63-74 °C after a ~30 s llama-bench, **86-100 °C after 82 s of sustained generation**. — `docs/results-m3.md`
- Energy on the same phone: a written answer costs about **135 J (92-194 J), about 0.19% of a 70.6 kJ battery**. A quick reply costs about 10 J. — `docs/results-battery-estimate.md`, `docs/METRICS.md`
- iPhone 16 Pro, MLX, Qwen2.5-1.5B, about 819 tokens per iteration: "Warm" by iteration 3 (−37% from peak), "Hot" from iteration 8 at 22.6 tok/s (−44%). A 1 s gap between iterations allowed no recovery. Battery drain was 10% over 20 iterations. The authors conclude phones suit "intermittent queries, at roughly 5-10 per hour". — [arXiv 2603.23640](https://arxiv.org/html/2603.23640v1)
- iPhone 17 Pro, Gemma 4 E2B, 10 minutes of decode: MLX GPU 48→18 tok/s (−10% after 5 s, −25% after 35 s); LiteRT GPU 56→27 (−25% at 40 s); CoreML ANE 33→22 (−25% at 390 s). On an M4 Max, llama.cpp on GPU drew 24.5 W vs 12.7 W for the ANE. — [john-rocky, DEV](https://dev.to/john-rocky/iphone-on-device-llm-the-gpu-wins-the-sprint-the-neural-engine-wins-the-marathon-42lo)
- Xiaomi 14 Pro (8 Gen 3): the prime core's frequency nearly halved by round 99. The device warms from about 34 °C to over 40 °C in 500 s. Starting above 35 °C lowers performance. On the iPad, GPU thermal state moves from nominal to serious with long prompts. Measured energy: about 0.013-0.144 mAh per token depending on device and backend, and GPU prefill uses 87.8% less energy than CPU. — [arXiv 2410.03613v5](https://arxiv.org/html/2410.03613v5)
- S24 Ultra (8 Gen 3, MLC on GPU): the GPU was floored at 231 MHz by iteration 6, with the GPU at 78 °C. — [arXiv 2603.23640](https://arxiv.org/html/2603.23640v1)
- Fred already shows a "Working on your answer…" note between the opener and the answer, and the handoff asks to "label the wait honestly". — `docs/METRICS.md`; `RELEASE-HANDOFF.md` §4

### Inferences
- Battery budget: 3-5 written-answer equivalents is about 400-700 J (0.6-1% of a battery) per deep answer, if prefill is shared. That's acceptable for an opt-in mode.
- Thermal budget: the first ~30 s run near full speed. After that, expect decode to slow by about 25-45%, which stretches a nominal 40 s plan toward 50-60 s. A second deep answer soon after will be slower. The app could read the thermal state (iOS `ProcessInfo.thermalState`, Android `PowerManager.getThermalHeadroom`) and cut N samples or skip deep mode when hot. This is a design suggestion, not researched further.
- UX patterns implied by the sources and Fred's context:
  1. Stream the first (greedy) answer immediately and run the extra passes as an optional "double-check" behind it, so an injured user is never blocked.
  2. Show staged progress ("checking answer 2 of 3"), not a bare spinner.
  3. Provide cancel (`stopCompletion()` and per-request `stop()` in the parallel API).
  4. Don't offer deep mode for emergency or card intents.

### Gaps
- No peer-reviewed multi-minute thermal study of llama.cpp on CPU on an iPhone or a Snapdragon 8 Elite-class phone was found. The iPhone thermal data above is from MLX, LiteRT and CoreML.
- Fred's energy for a 30-70 s run has not been measured. The 135 J per answer figure is for about 15 s answers and may scale worse than linearly when hot.

## 5. Small models usable on-device as draft, judge or reranker

### Takeaway
The plausible same-vocabulary companion is **Qwen3-0.6B** (373 MB Q4_K_M, 420 t/s prefill on Fred's phone). It could serve as a one-token yes/no judge or as a draft model, but speculative gains on CPU are doubtful. **Qwen3-Reranker-0.6B** is the most direct "checker", because llama.cpp/llama.rn support rerank natively, though only correctly converted GGUFs work. Gemma 3n / Gemma 4 E2B are too large for llama.cpp's memory budget here.

### Cited Findings
- Qwen3-0.6B-Q4_K_M: 372.65 MiB, pp512 about 420 t/s and tg128 about 75 t/s on the 8s Gen 4 CPU. — `docs/results-m0.md`
- Fred's history: sampling the 1.7B at temperature 0.6 produced every unsafe answer in the deep-thinking runs. Sentence-vector "best of 3" scores differed by about 0.01 (effectively random). A source-phrase-count judge "rewards copying". An NLI checker was rejected. — `docs/results-deep-thinking.md`, `RELEASE-HANDOFF.md` §4
- Qwen3-Reranker-0.6B GGUF works in llama.cpp with rank pooling if properly converted. llama.rn exposes `rerank()`. — [model card](https://huggingface.co/Voodisss/Qwen3-Reranker-0.6B-GGUF-llama_cpp); [llama.rn README](https://github.com/mybigday/llama.rn)
- Gemma 4 E2B on iPhone 17 Pro: 3,156 MB peak under llama.cpp Q4_K_M vs 641 MB under LiteRT-LM INT4. LiteRT memory-maps the per-layer embeddings. — [john-rocky, DEV](https://dev.to/john-rocky/on-device-llm-on-iphone-which-runtime-is-fastest-mlx-vs-llamacpp-vs-litert-lm-vs-coreml-1b42). The repo measured Gemma 4 E2B at 4.7 GB on desktop. — `docs/results-strategy-research.md`
- A small draft (0.6B) underperforms a 1.7B draft even for large targets, and on CPU the dual-model overhead can outweigh the gain. — [arXiv 2509.04474](https://arxiv.org/pdf/2509.04474); [qwen3-eagle card](https://huggingface.co/ichsanlook/qwen3-eagle)

### Inferences
- A **passage-grounding check** costs one rerank call over 3-5 drafted sentences against the 4 passages. It can catch "added things the passages don't say" (the thinking-mode failure) and is likely 1-3 s with a 0.6B rank model. It is deterministic, which avoids sampling unsafe text.
- A Qwen3-0.6B (or the 1.7B itself) one-token yes/no judge ("Does the passage state X?") under a GBNF grammar with `n_probs` is cheap: mostly prefill of a short prompt. The 1.7B as its own judge needs no extra memory and can reuse the answer's KV prefix.
- Given Fred's finding that sampled drafts are the source of unsafe content, the compute budget may be better spent on greedy answer plus verification passes (rerank or judge) than on sampling-based self-consistency.

### Gaps
- No on-device latency or accuracy measurement for Qwen3-Reranker-0.6B or Gemma 3n as a judge.
- Exact GGUF sizes for Qwen3-Reranker-0.6B Q4/Q8 were not verified.
- Gemma 3n under llama.cpp on phones: no memory or speed figures were found in this pass.
