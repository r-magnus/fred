# M3 — The pipeline inside the Android app sandbox

**Device:** Nothing Phone (3), SM8735 (Snapdragon 8s Gen 4), Android 15, 12 GB RAM
**Build:** Expo SDK 57 debug APK, llama.rn 0.12.9, op-sqlite 18.1.4 (FTS5 on)
**Model:** Qwen3-0.6B-Q4_K_M · **Encoder:** gte-small fp16 · **Pack:** 611 chunks

M0 measured `llama-bench` as a native binary under `adb shell`, which is not
subject to Android's per-app limits. This is the same pipeline running inside the
app process, driving the full `rag-core` path: FTS5 Stage 1, INT8 semantic
re-rank, compression, prompt build, generation.

## It fits

| | |
|---|---|
| **TOTAL PSS** | **860 MB** |
| TOTAL RSS | 983 MB |
| Native heap | 518 MB (model weights + KV) |
| Java heap | 27 MB |
| `dalvik.vm.heapgrowthlimit` | 256 MB |
| `dalvik.vm.heapsize` | 512 MB |

**The paper's framing of a "2 GB per-application memory ceiling" (§3.1) conflates
two different limits.** The Dalvik cap on this device is 256 MB, and the app is
nowhere near it (27 MB) — because a GGUF model loaded through JNI is allocated
*natively*, outside the managed heap entirely. Native memory is bounded by device
RAM and the low-memory killer, not by `heapgrowthlimit`.

So the constraint is real but it is not the constraint described. Budgeting
against the Dalvik cap would wrongly conclude a 0.6B model cannot load; budgeting
against total RSS is the meaningful test, and at 983 MB there is substantial room
on a 12 GB device. **A 1B–1.7B model is affordable**, consistent with the vector
index arithmetic in `docs/results-m1.md`.

## Stage timings

| Stage | Time |
|---|---|
| Load pack (611 chunks, SQLite + 230 KB vectors) | **37 ms** |
| Load models (SLM + embedder) | 4,652 ms |
| **Retrieve** (FTS5 + INT8 re-rank + compression) | **159 ms** |
| **TTFT** (1,095-token prompt) | **2,402 ms** |

**Retrieval is not the bottleneck.** The complete hybrid pipeline over 611 chunks
costs 159 ms against 2,402 ms of prefill — about 6%. Every optimization that
matters is on the inference side.

**M0's projection was accurate.** `llama-bench` measured 420 t/s prefill, which
predicts 1095 / 420 ≈ 2.6 s for this prompt. Measured in-app: 2.4 s. The native
benchmark was a sound proxy for speed, which is the thing it was chosen to test.

## Finding: KV cache quantization produces incoherent output

PocketRAG §3.4.3 applies 8-bit KV cache quantization. Configured as the paper
describes — `cache_type_k/v: 'q8_0'` with `flash_attn: true` — llama.rn on this
device produced not degraded answers but **word salad**:

> `inform. URL. '; URAIN. PRORPURINATION. ULONG. FUNCTION. TURRAIN. VURTRUMAN. WARNING.`

Removing KV quantization alone fixed it, and was also **faster**:

| Configuration | TTFT | Output |
|---|---|---|
| `q8_0` KV cache + flash attn | 4,701 ms | incoherent |
| **No KV quantization** | **2,402 ms** | coherent English |

This is a direct reproducibility failure of one of the paper's four headline
optimizations, on current tooling. It is disabled in `device-pack.ts` with the
reason recorded rather than deleted, so M4 can retest against a newer llama.rn.
Whether the fault is the quantized-cache kernel, the flash-attention path, or
their interaction on this SoC is not yet isolated — that is an M4 experiment.

## Finding: llama.rn defaults to 4 threads

The device has 8 cores and M0 measured prefill at 8 threads. llama.rn's default
attaches `n_threads=4`, silently halving throughput and making on-device numbers
incomparable to the baseline. Setting it explicitly cut model load from 18,248 ms
to 4,652 ms.

## Thermal: worse than M0 suggested

| | |
|---|---|
| Idle | 32–35 °C |
| After M0's `llama-bench` (~30 s) | 63–74 °C |
| **After 82 s of sustained generation** | **86–100 °C** |

One core reached **100 °C**. M0's benchmark understated this because it runs in
short bursts; a real answer generates continuously for far longer. For a field
app this is a battery and throttling problem, and it strengthens the case for the
adaptive runtime in §3.5 — which should arguably respond to temperature, not only
to memory pressure. The paper monitors memory alone.

## Open issue: generation quality

Output is coherent but wrong and repetitive:

> "If a woman is conscious and can perform CPR, then perform CPR. If a woman is
> unconscious and cannot perform CPR, then give the man."

`rag-core` builds a raw prompt string and the device backend passes it to
`completion()` as a plain prompt, so no chat template is applied and the model
has no reliable stopping signal — it ran to roughly 1,000 tokens. The eval
harness does not hit this because MCQ scoring constrains output to a single
token, which is precisely the kind of gap a benchmark-only evaluation hides.

Fixing it means using the chat template, which re-introduces Qwen3's thinking
mode (`docs/optimizations.md`) and so must disable it explicitly. That is the
first M4 task, and it is also why generation currently takes 82 s: it is
generating roughly ten times more tokens than the answer needs.
