# Conversation memory: what it costs, and how much of it the model should see

Desk research plus measurements from existing logs and the llama.rn source,
2026-09-25. No code.

**Short version: storing conversations is nearly free. The cost of memory is
accuracy, and it depends on how much of the previous turn the generator sees.
Make retrieval aware of the previous question, show the generator only that
question, and never carry old sources forward.**

## Why this matters now

Every question Fred answers is independent. Nothing in `pipeline.ts`,
`engine.ts` or `App.tsx` carries a previous turn. So "no, it's still bleeding"
after a bleeding answer is retrieved and answered as if it were the first thing
the user ever said. It also means Fred cannot ask "does that help?", because
he could not use the reply.

US-10 (re-read previous conversations, Core, RC) needs conversations stored
regardless. That is a separate and much cheaper problem than the generator
*using* them, and the two should not be confused.

## The budget, measured

| | Value | Where from |
|---|---|---|
| Context window | 4,096 tokens | `device-pack.ts` `N_CTX` |
| Prompt, median / p90 / max | 719 / 847 / 1,066 tokens | `graded-runs-1.7B.jsonl` (52 runs) |
| Prompt, held-out median | 826 tokens | `holdout-runs-1.7B.jsonl` |
| Answer, median | ~250 characters (~60 tokens) | same |
| Retrieval, on device | 54-106 ms | `METRICS.md` |
| Time to first token, on device | 6.0-8.7 s | `METRICS.md` |

**Prefill is the expensive part.** TTFT of about 7 s over roughly 570 uncached
tokens is **about 80 tokens a second on the phone's CPU**. That is an estimate
from these numbers, not a direct measurement. Every token of history placed
where the cache cannot reuse it costs about 12 ms.

**Memory is already paid for.** Qwen3-1.7B has 28 layers, 8 KV heads and a head
dimension of 128. In f16, since q8_0 KV was word salad (`results-m3.md`), that
is **~112 KB per token**, so the 4,096-token window is ~450 MB, allocated at
init whether it is used or not. History held in context costs no extra RAM.

## How llama.rn reuses work between turns

Verified in `node_modules/llama.rn/cpp/rn-completion.cpp` (0.12.9):
`find_common_prefix_length` compares the new prompt with what is already in the
KV cache, keeps the shared prefix, and removes only the rest
(`llama_memory_seq_rm(kv, 0, n_past, -1)`). This is the mechanism
`SYSTEM_PREFIX` already relies on.

Two consequences for memory:

- **Where history goes decides what it costs.** History appended after the
  previous turn, as a normal chat thread, is already in the cache and is nearly
  free. History inserted into the per-query user message sits after the system
  prefix but before new material, so it is re-prefilled every turn.
- **Any other completion evicts the cache.** A separate generation pass with a
  different system prompt, such as a query rewriter or `SUFFICIENCY=1`,
  overwrites everything after the shared prefix, so the next answer re-prefills
  the system prefix too.

One thing to check if a native chat thread is ever tried: Qwen3's template may
render a previous assistant turn differently from how it was generated (the
empty think block for `enable_thinking: false`). That would break reuse at the
start of the previous answer and cost ~60 tokens. Small, but worth seeing in
the log rather than assuming.

## What outside research says

- **Multi-turn degrades every model tested.** Laban et al. (ICLR 2026 best
  paper) found an **average 39% drop** from single-turn to multi-turn across
  six tasks. Most of it is unreliability, not aptitude: models rely on their
  own earlier answers, assume too early, and **do not recover once they take a
  wrong turn**. Those were frontier models; a 1.7B model has no reason to do
  better. [arXiv 2505.06120](https://arxiv.org/abs/2505.06120)
- **Irrelevant but related passages cost accuracy.** One hard distractor next to
  the gold passage typically costs **6-11 points**. The previous turn's sources
  are exactly that kind of distractor.
  [Shi et al.](https://arxiv.org/abs/2302.00093),
  [Amiraz et al.](https://arxiv.org/html/2505.06914v1)
- **Follow-ups retrieve badly on their own**, which is why multi-turn RAG
  rewrites the latest turn into a standalone query
  ([ChatQA](https://arxiv.org/pdf/2401.10225),
  [SemEval-2026 Task 8](https://arxiv.org/pdf/2606.28352)). The cheap
  alternative in production is concatenating previous user queries before
  retrieval ([NVIDIA RAG
  Blueprint](https://docs.nvidia.com/rag/2.4.0/multiturn.html)), at the risk
  of polluting the embedding when the topic changes.

## The options

| Approach | Added latency | Accuracy risk | Storage |
|---|---|---|---|
| **Store turns** in op-sqlite (US-10) | none | none, the model never sees it | ~1-2 KB a turn |
| **Retrieval sees the previous question**, keep whichever search scores higher | ~50-100 ms | low | none |
| **Generator sees the previous question only** (~20 tokens) | ~0.3 s | low, but count refusals | none |
| Generator sees previous question and answer (~100-300 tokens) | ~1-4 s | medium: builds on its own wording | none |
| Native chat thread, previous sources included | ~0 s, cache reuse | **high**: old sources as distractors, plus the multi-turn drop | window fills in ~4 turns, then a full re-prefill |
| Model rewrites each follow-up first | ~3-6 s (estimate) | medium | none |
| Persist the KV cache to resume a chat | load time | none | **~110 MB per 1,000 tokens** |

The native chat thread is the tempting one because cache reuse makes it nearly
free in time. It is also the design that puts two sets of `SOURCE 1-4` in front
of a 1.7B model, which is what both findings above warn against.

## Recommendation

1. **Store conversations in op-sqlite.** It closes US-10 by itself. A thousand
   ten-turn conversations are 10-20 MB. Store the question, the answer, the
   outcome kind and the citations, so a re-read shows what Fred showed.
2. **Retrieval memory, scored rather than guessed.** For every turn after the
   first, retrieve twice: the message alone, and the previous question joined
   to it. Keep whichever result has the higher top fused score. A topic switch
   ("also, my friend got bitten by something") keeps the standalone result
   because it scores higher, so no follow-up detector has to be right. Cost:
   one more embedding and search, under 100 ms.
3. **Generator memory: the previous question, nothing else.** One line,
   `EARLIER QUESTION: ...`, in `buildQuerySuffix` above `QUESTION:`. Keep it
   out of `SYSTEM_PREFIX` so the prefix cache survives. Always use fresh
   sources, and never include the previous answer, which is the
   "relies on its own earlier attempt" failure Laban et al. describe.
4. **Defer long-term memory** ("I'm diabetic", "I have my dog with me"). It is a
   different feature with its own safety questions, such as a stale fact
   changing a medical answer weeks later.

## How to measure it before it ships

Nothing in `tools/eval/data` is multi-turn today. Three small sets would cover
it:

- **Follow-up pairs.** A tuning question, then a follow-up that only makes sense
  with it ("what if it's still bleeding?"). Graded on the second answer.
- **Topic switches.** A tuning question, then an unrelated one. Pass if the
  second answer shows no trace of the first topic.
- **Single-turn regression.** Every tuning question re-run with an unrelated
  earlier question attached. Answers and **the in-prose refusal count** should
  not move. `results-answer-shape.md` is the reason: an instruction that never
  mentions abstention still moved refusals 18 → 22.

Held-out runs only once, after the design is fixed, as with everything else.

## Not recommended, and why

- **Summarised memory** (the model writes a running summary). A second
  generation per turn, evicts the cache, and gives a small model its own prose
  to rely on.
- **Keeping old sources "just in case".** Distractor cost with no upside, since
  retrieval already brings back what the new question needs.
- **Saving KV state to disk.** ~110 MB per 1,000 tokens to save a few seconds
  on reopening an old chat. Re-prefilling is cheaper than the storage.
