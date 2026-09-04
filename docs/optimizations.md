# PocketRAG optimizations → Fred implementation

Where each technique from Kang et al. lives in this codebase, and what to expect
from it. **Measure everything; do not report the paper's numbers as your own.**

| Paper technique | Where it lives | Notes |
|---|---|---|
| Hybrid retrieval Stage 1 (§3.3.1) | `PackStore.searchLexical` (FTS5) | Paper uses a hashmap capped at 5,000 keywords. FTS5 is faster and unbounded. Keep the hashmap as an ablation. |
| Lexical score `S_lex` (Eq. 2) | `score.ts:lexicalScore` | Generalized to weighted terms; reduces exactly to the paper's formula at equal weights. |
| Hybrid fusion (Eq. 3) | `score.ts:fuse`, α = 0.6 | Cosine clamped to [0,1] first — see below. |
| Stage 2 semantic re-rank (§3.3.2) | `retrieve.ts:retrieve` | Runs only over Stage-1 survivors. |
| Selective Context (§3.4.1) | `compress.ts:compressContext` | Extended with procedure atomicity — see below. |
| Batched prompt decoding (§3.4.2) | `initLlama({ n_batch: 512, n_ubatch: 512 })` | See the honesty note below. |
| KV cache quantization (§3.4.3) | `cache_type_k/v: 'q8_0'` | **Requires `flash_attn: true`.** Hard dependency. |
| Weight quantization (§3.4.3) | Offline `llama-quantize` → Q4_K_M | Paper uses 8-bit PTQ; Q4_K_M is a better size/quality point at this scale. |
| Adaptive memory (§3.5, Eq. 5) | `pipeline.ts:maxTokensForPressure` | 1024 / 768 / 256 at ρ < 0.70 / 0.70–0.85 / ≥ 0.85. |
| **Prompt prefix caching** | `prompt.ts:SYSTEM_PREFIX` | **Not in the paper.** Our addition. |

## Three deviations, and why

### 1. Procedure blocks are atomic during compression
The paper compresses by dropping low-scoring sentences. First-aid and survival
content is largely *ordered procedure*. Dropping step 3 of a 5-step bleeding-control
sequence yields fluent, confident, incomplete instructions — the worst failure mode
this system has. So `blockKind: 'procedure'` chunks are never split, and
`looksLikeProcedure()` re-checks at runtime in case ingest mislabels one.

Consequence: when retrieved context is mostly procedural, the 20–40% reduction
target is not met. `CompressionResult.reduction` reports what was actually achieved.
**Report the real distribution, not the target.**

### 2. Cosine is clamped before fusion
Eq. 3 mixes a cosine (which can be negative) with `S_lex` (which cannot). Left
unclamped, a strongly negative cosine can cancel a perfect keyword match and rank a
chunk below an unrelated one. Clamping to [0,1] preserves the intent.

### 3. An abstention gate that the paper has no equivalent of
Below `DEFAULT_ABSTAIN_THRESHOLD` on the fused score, Fred declines to answer. A
multiple-choice benchmark cannot reward abstention — the model always picks an
option — which is precisely why the paper's format hides this failure mode. Tune τ
against abstention precision/recall on your eval set.

## Honesty note on the batching speedup

The paper reports 14.2s → 4.8s from batched prompt decoding alone. **llama.cpp
already batches prefill by default.** Their baseline was almost certainly an
unbatched or misconfigured build, so setting `n_batch` will not reproduce a 3×
win on top of a correctly configured llama.cpp.

This is not a problem for your project — it is a finding. Measure a properly
configured llama.cpp baseline, report the real delta, and note the discrepancy.
"We could not reproduce X because the baseline was misconfigured" is a legitimate
and valuable result.

## The memory budget, recalculated

The paper reports a 120 MB vector index for 8,000 chunks (§3.2.1). At 384 dimensions
INT8 that should be `8000 × (384 + 2)` ≈ **3.1 MB** — roughly 40× smaller. Their
figure appears to include chunk text, or is an error.

Either way you have far more headroom than the paper implies, which means a 1B–1.7B
model is affordable where they used 0.6B. Verify on device before relying on it.

---

# Early measured findings

## Qwen3 thinking mode costs 3.1× latency, and it is a one-line fix

Measured on desktop (Ryzen 7 3700X, 16 threads), Qwen3-0.6B-Q4_K_M, identical prompt:

| Configuration | Total | Thought chunks | Answer chunks | Budget wasted |
|---|---|---|---|---|
| Default (thinking on) | 4469 ms | 161 | 56 | **74%** |
| `/no_think` | 1438 ms | 4 | 65 | 6% |

**Qwen3 is a reasoning model with thinking enabled by default.** Three quarters of
the generation budget went to tokens the user never sees. On a first run with
`maxTokens: 120` the model produced an *entirely empty* answer — the whole budget
was consumed inside the `<think>` block before it reached any visible text.

This matters more than it looks:

- **3.1× is larger than the entire speedup the paper attributes to batched prompt
  decoding**, and it costs one token in the prompt rather than an engine change.
- It interacts with the adaptive memory manager (§3.5). At critical pressure the
  budget drops to 256 tokens — with thinking on, that can be *entirely consumed by
  reasoning*, yielding an empty answer exactly when the device is most stressed.
  Anything that caps `maxTokens` must disable thinking, or the cap becomes a
  silent failure mode.

**Action:** disable thinking for the shipping path. Keep it as an ablation axis —
thinking may buy accuracy on the MCQ evaluation, and *accuracy vs. TTFT with
thinking on/off* is a genuinely original experiment the paper does not run. Report
both.

**Consequence for model choice:** this strengthens the case for evaluating Gemma 3
1B alongside Qwen3. It is not a reasoning model, so it carries no thinking overhead
to suppress in the first place.

## Vanilla 0.6B gives dangerous first-aid advice — the motivating example

The same runs, asked how to control severe external bleeding with **no retrieval**:

> *(thinking)* "2. **Elevate the injured area** to reduce swelling and promote blood flow."
>
> *(no_think)* "2. **Immobilize the area** to prevent further damage and allow the blood to clot."

Both are fluent, confident, correctly formatted, and **wrong**. "Promote blood flow"
is the opposite of the goal in hemorrhage control, and elevation is not current WHO
BEC guidance — the sequence is direct pressure, then wound packing or more pressure,
then a tourniquet.

Keep these verbatim outputs. This is the "before" case that motivates the entire
project, captured on the first run, and it is far more persuasive in a report than
an accuracy delta on a multiple-choice table.
