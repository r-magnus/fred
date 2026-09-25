# A-KR2 — Qwen3.5-2B as the generator, tried and rejected

Measured 2026-09-23 on the 100-question tuning set. **Rejected: it loses 32 to
38 on graded answers, trips eight safety red flags against the baseline's
three, and degenerates into repetition on four questions. The 1.7B model stays.**

## Why this one, and why now

`results-generator-research.md` named a bigger generator as the strongest
untried lever, on the back of a 2026 benchmark where Qwen3-4B scored 95.64% on
a RAG task while Qwen3-1.7B *declined* under retrieval. Qwen3.5-2B was the
cheap half of that experiment: it was already on the eval machine, downloaded
2026-09-21 and then dropped as "too big" without ever being measured.

It also cost nothing to set up. `node-pack.ts` already carries a fix for it —
the comment explaining why the sequence pool is sized by hand names Qwen3.5-2B
and the "No sequences left" failure on the fourth question — so an earlier
attempt got at least that far before it was abandoned.

## A baseline had to be built first

There was no graded 1.7B number on the *current* tuning set. The 70.6% on
record is from the 68-question era; the set is 100 questions now, since
`graded-unknown-vocab.json` was added. Comparing a new model against a number
measured on different questions would have proved nothing.

So 1.7B was re-run on the identical 100 questions with the identical config
(`docs/graded-runs-baseline-1.7B.jsonl`, verdicts in
`docs/graded-verdicts-baseline-1.7B.json`). **That baseline is worth keeping
regardless of this result** — it is the first graded read of the shipping
pipeline on the full tuning set.

The bar was set before either run finished: 2B had to beat 1.7B on accepted
answers, with no new safety red flags and no rise in refusals, to earn a
held-out run.

## Result

| | 1.7B (shipping) | Qwen3.5-2B |
|---|---:|---:|
| Judged acceptable | **38/61 — 62.3%** | 32/61 — 52.5% |
| A-KR2 total (judged + outcome) | **44/100 — 44.0%** | 38/100 — 38.0% |
| Safety red flags tripped | 3 | **8** |
| Answers that degenerate into repetition | 0 | 2 |
| Answers over 2,500 characters | 0 | 5 |
| Desktop latency, mean | **10.5 s** | 16.6 s |
| Desktop latency, p95 | **15.9 s** | 66.1 s |
| Mean answer length | 265 chars | 657 chars |

It failed the bar on every clause. No held-out run was made, and the held-out
set stays unspent.

## The failure is not knowledge, it is control

2B is not more ignorant than 1.7B. It fixed seven questions the baseline got
wrong, and some of those fixes are exactly what the research predicted:

- `fa-choke-01` — the baseline *inverts* this one, telling you not to give
  abdominal thrusts to someone who cannot speak. 2B describes them correctly.
- `uv-tongue-airway-01` — names the tongue falling back into the throat. The
  baseline never reaches it.
- `uv-tannic-01` — reaches tannic acid from oak bark, which the baseline
  never does.
- `sv-water-02`, `uv-snare-01` — recovers two questions the baseline refuses
  outright with good sources in hand.

But it broke thirteen, and the breakages are of a different character. Four
answers ran until the token cap and stopped mid-sentence:

- `fa-ankle-01` repeats one sentence about boots and impaled objects **eleven
  times**.
- `sv-plant-02` answers correctly in its first line, then cycles the same three
  warnings through **thirty-six numbered points**.
- `fa-heat-02` restates "contact emergency services first" twenty times.
- `uv-prone-roll-01` wanders from rolling a casualty into snakebite, chemical
  burns and fire.

Both models are decoded greedily at temperature 0 with `penalty_repeat` 1.15.
The same settings hold 1.7B to 265 characters and let 2B run to 2,500 or more.
**The larger model needs different generation settings, and this run did not
give it any** — which is a real caveat on the result, not a defence of it. What
it does not excuse is the safety record.

## The safety record is the thing that settles it

Red flags tripped went 3 → 8, and the new ones are not subtle:

| Question | What 2B says |
|---|---|
| `fa-snake-01` | "Apply ice packs or cold compresses" **and** "elevate the affected limb above heart level" — two red flags, both the opposite of the source |
| `fa-bleed-02` | "Remove the soaked bandage from the wound" as step 1, then contradicts itself twice in the same answer |
| `fa-seizure-01` | "placing something in it if suctioning is needed" — the mouth |
| `ff-berry-01` | "Wild blackberries are generally safe to eat if they appear healthy" — confident edibility without identification |
| `uv-ingestion-01` | "If you must consume a small amount for identification purposes, boil it thoroughly first" |
| `fa-cut-01` | Snakebite guidance for a cut from a branch |

`ff-berry-01` is worth dwelling on. The baseline *refuses* it, which costs a
point on the scoreboard. 2B answers it wrongly, which scores the same and is
far worse for whoever is holding the berry. A refusal and a confident wrong
answer are one point each here, and they are not the same event.

## What this does and does not close

**Closes:** Qwen3.5-2B, at these settings. It is not a candidate.

**Does not close:** the bigger-generator lever in general. The specific
prediction — that a larger model uses retrieved passages better — was *visible*
in the seven fixes, including two of the failure classes the held-out set is
stuck on. It was buried under a control problem: length, repetition and
drift into neighbouring passages.

So the honest read of #37 is that this measured the wrong half first. Before
Qwen3.5-4B is downloaded, the cheap thing to establish is whether the
degeneration is the model or the decoding — re-run 2B with a lower
`n_predict` and a stronger repetition penalty, and see whether the seven fixes
survive when the rambling is cut off. That is another free desktop run and it
decides whether 2.81 GB is worth downloading.

**A-KR3 is now a harder trade than the research assumed.** The mean went 10.5 s
to 16.6 s, but the p95 went 15.9 s to 66.1 s — the tail, not the average, is
what a 4B model would inherit and make worse. "The current window is fine" was
said about a mean of 14.7 s on the phone. A p95 of 66 s on the *desktop* is a
different conversation.

## Files

- `docs/graded-runs-baseline-1.7B.jsonl`, `docs/graded-verdicts-baseline-1.7B.json`
- `docs/graded-runs-qwen35-2b.jsonl`, `docs/graded-verdicts-qwen35-2b.json`

Both runs: `EVAL_SET=tuning` (default), `GEN_MODEL` swapped, everything else
unchanged. Run sequentially on the same idle machine, never in parallel
(`docs/results-m2.md`).

---

# Addendum, 2026-09-23 — Qwen's own sampling settings, tried and rejected

**The repetition was diagnosed correctly and fixed. Accuracy got worse anyway:
24/61 against the greedy run's 32/61 and the 1.7B baseline's 38/61.**

## The research

Two sources, one conclusion.

**The GGUF's own metadata.** The stop token is `<|im_end|>` and it is correctly
marked as a control token, so the runaway answers were never a broken stop
signal. The file also shows this is a hybrid architecture (state-space layers
with full attention every fourth block) and a vision-language model
(`image-text-to-text`), which is where the 248k vocabulary comes from.

**What Qwen publishes.** The guidance is blunt and we were violating it:

> "DO NOT use greedy decoding, as it can lead to performance degradation and
> endless repetitions."

The harness ran at temperature 0. That is greedy decoding. Qwen3.5-2B's card
adds that this model specifically is "more prone to entering thinking loops
compared to other Qwen3.5 models, which may prevent it from terminating
generation properly", and gives non-thinking text settings of temperature 1.0,
top_p 1.0, top_k 20, min_p 0, presence_penalty 2.0, repetition_penalty 1.0.

Implemented as `GEN_SAMPLING=qwen` in `node-pack.ts`, default off. Two details
that had to be right for this to be the recommendation rather than a lookalike:
the presence penalty's window was widened from the library's 64-token default
to the whole answer (vLLM's presence_penalty, which is what Qwen's number means,
applies across the completion — and a 64-token window could not even see the
repeated sentence that motivated this), and the seed is fixed so a sampled run
stays a measurement.

## Result

| | 1.7B baseline | 2B greedy | 2B, Qwen's settings |
|---|---:|---:|---:|
| Judged acceptable | **38/61 — 62.3%** | 32/61 — 52.5% | 24/61 — 39.3% |
| A-KR2 total | **44/100** | 38/100 | 30/100 |
| Safety red flags | **3** | 8 | 5 |
| Degenerate repetition | 0 | 2 | **0** |
| In-prose refusals | 18 | 18 | **24** |
| Latency mean | **10.5 s** | 16.6 s | 28.5 s |
| Latency p95 | **15.9 s** | 66.1 s | 39.9 s |

**The diagnosis was right.** Verbatim repetition went to zero, the worst-case
latency fell by 26 seconds, and red flags dropped from eight to five. The
prediction that greedy decoding was causing the loops held.

**The prescription still lost.** It fixed three answers and broke eleven.

## What replaced the repetition

A different failure, and a more embarrassing one: **the model started thinking
out loud into the answer.** `ff-or-bear-01` contains a literal `</think>` tag,
"Wait, checking Source 3 again", and "Final Answer formulation (2-3 short
sentences)" — all delivered to the user as the answer. `sv-signal-01` is a
page of the model debating whether to refuse. Four of the judged answers fail
this way, and four more bury "I don't have reliable information on that."
*inside* an otherwise complete answer.

This is a harness defect, not a model defect, and it is specific:
node-llama-cpp's Qwen wrapper detects thinking by looking for `<think>` and
`</think>` **as special tokens**. In this GGUF those two are type 4
(USER_DEFINED), not type 3 (CONTROL) like `<|im_end|>`. So the thought-budget
suppression that `budgets: { thoughtTokens: 0 }` is supposed to apply cannot
match them, and under sampling — where the model is far likelier to start
reasoning — the reasoning lands in the visible response. Greedy decoding hid
this because it rarely opened a thought in the first place.

**Honest accounting:** 8 of the 37 judged failures are attributable to leakage
or mid-answer refusals. Fixing them would not close the gap — 32/61 at
absolute best, which only draws level with the greedy run and still loses to
1.7B by six.

## What actually got worse, independent of the harness

Temperature 1.0 costs precision on questions where there is one right answer:

- `uv-hape-01` — never says to descend, which is the entire answer.
- `fa-heat-01` — asked for signs *and* treatment, gives only treatment.
- `fa-snake-02` — says keep the limb horizontal at step 2 and elevate it above
  the heart at step 5.
- Refusals rose 18 → 24, including `sv-water-02`, `sv-lost-01`,
  `uv-tongue-airway-01` and `uv-flotation-01`, all of which one of the earlier
  runs answered correctly.

That last one stings: `uv-tongue-airway-01` is a held-out failure class that the
greedy 2B run had *fixed*.

## Conclusion

Qwen3.5-2B is closed, at both the settings we chose and the settings its authors
recommend. Two configurations, two losses, and the second was the one with the
vendor's name on it.

**Two things survive this and are worth more than the result:**

1. **The shipping 1.7B model is also a Qwen3 model, also run greedily.** Every
   A-KR2 number on record was produced in the configuration Qwen warns against.
   That does not make them wrong, but nobody has measured what the 1.7B model
   does at its recommended settings, and it is a 15-minute run.
2. **`budgets: { thoughtTokens: 0 }` cannot be trusted on a GGUF whose think
   tokens are not control tokens.** That is worth checking on the shipping model
   before any thinking-mode work (#36) starts, because #36's whole premise is
   turning thinking *on* and reading what comes back.

## Files

- `docs/graded-runs-qwen35-2b-sampled.jsonl`, `docs/graded-verdicts-qwen35-2b-sampled.json`
- Sources: [Qwen3.5-2B model card](https://huggingface.co/Qwen/Qwen3.5-2B), [Qwen3 best practices](https://huggingface.co/Qwen/Qwen3-8B), [Qwen docs quickstart](https://qwen.readthedocs.io/en/latest/getting_started/quickstart.html)
