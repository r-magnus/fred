# M0 — On-device baseline

**Device:** Nothing Phone (3), `A024`, SoC `SM8735` (Snapdragon 8s Gen 4), Android 15, 12GB RAM
**Model:** Qwen3-0.6B-Q4_K_M (372.65 MiB, 596.05M params)
**Runtime:** llama.cpp `9a4843c`, arm64-v8a, `armv8.2-a+dotprod+i8mm`, NDK r28c
**Method:** `llama-bench` as a native binary under `adb shell`. No RAG, no optimizations
applied — this is the *unoptimized floor* for the inference engine alone.

## Throughput

| Configuration | Threads | pp512 (prefill) | tg128 (decode) |
|---|---|---|---|
| All cores | 8 | **415–421 t/s** | **75–76 t/s** |
| Little cores only (cpu0–1 @ 2016 MHz) | 2 | **101.58 ± 0.25 t/s** | **30.61 ± 0.20 t/s** |

Core topology, measured: 1× 3206 MHz (prime) · 3× 3014 · 2× 2803 · **2× 2016 (little)**.
The little-core run is a proxy for a mid-range SoC on the same handset — it gives a
performance floor without needing a second device, addressing the single-flagship
limitation PocketRAG lists in its own §5.4.

## TTFT vs. context length

TTFT ≈ prompt_tokens / prefill_rate. The paper's stated target is **< 5 s**.

| Context | Flagship (420 t/s) | Mid-range proxy (101.6 t/s) |
|---|---|---|
| 256 tok | 0.61 s | 2.52 s |
| 512 tok | **1.22 s** | **5.04 s** ❌ |
| 1024 tok | 2.44 s | 10.08 s ❌ |
| 1536 tok | 3.66 s | 15.11 s ❌ |

## The finding

**PocketRAG's latency problem is solved on flagship hardware, and unsolved everywhere else.**

Their fully optimized result was 3.7 s TTFT on a 2023 flagship (S23 Ultra). This
device reaches **1.22 s with none of their optimizations applied** — two years of
silicon plus current llama.cpp beat their entire optimization stack by ~3×.

But the mid-range proxy **breaks their own 5 s target at just 512 tokens**, before
any retrieved context is added. A realistic RAG prompt of ~1024 tokens takes over
10 s there.

This does not make the paper's techniques irrelevant. It relocates them:

> The optimizations are unnecessary on flagships and **essential** on the devices
> most people actually own.

That is a stronger and more defensible thesis than replicating the paper on hardware
where the problem no longer binds — and it matches Fred's actual use case, since
someone carrying a budget phone into the backcountry needs this more, not less.

**Prefill is the bottleneck, decode is not.** Even on little cores, decode holds at
30.6 t/s — faster than reading speed. The entire problem is time-to-first-token,
which is precisely what Selective Context Compression (§3.4.1) and prompt prefix
caching attack. Both should now be evaluated primarily against the *little-core*
configuration.

## Thermal

Idle 32–35 °C → **63–74 °C after ~30 s** of sustained benchmarking; peak 74 °C.
A ~40 °C rise that fast confirms §5.3's throttling concern is real and will affect
sustained-use measurements. The planned 20-consecutive-query chart should show it.

## Qwen3 thinking mode, on device

| Mode | Total | Tokens generated | Completed? |
|---|---|---|---|
| Default (thinking) | 3183 ms | 199 | **No — hit the 200-token cap** |
| `/no_think` | 2324 ms | 150 | Yes |

Reproduces the desktop finding. The 1.4× ratio *understates* it: the thinking run
never finished its answer. Disable thinking on the shipping path.

## Caveat

A native binary under `adb shell` is **not** subject to Android's per-app memory
ceiling. These numbers are honest for speed and thermal behaviour but do **not**
validate the ~2 GB app-sandbox budget of §3.1. That still requires the APK.
