# Verification, critique and answer-selection methods for a small on-device RAG model (Fred)

Context: generator Qwen3-1.7B Q4_K_M, about 4 retrieved passages, offline phone. These approaches have already failed locally: best-of-3 sampled drafts (both unsafe answers came from sampling), picking by sentence-vector similarity, a phrase-counting judge, a DeBERTa-small NLI verifier (`docs/results-verifier-test.md`: no usable threshold, and the two least-supported answers were acceptable paraphrases), and Qwen3 thinking mode. Research date: 2026-11-20. About 16 tool calls were used, so some areas are thin and are listed under Gaps.

## 1. Do small (≤3B) models self-correct?

### Takeaway
Not without outside help. Intrinsic self-correction (the model critiquing itself with no new information) lowers accuracy, and it hurts small models most. Gains appear only with reliable external feedback or a strong separate verifier. For small models, the verifier is the bottleneck, not the reviser.

### Cited Findings
- Huang et al., "Large Language Models Cannot Self-Correct Reasoning Yet" (ICLR 2024; arXiv Oct 2023). Intrinsic self-correction lowered accuracy in nearly every setting. Llama-2: GSM8K 62.0 → 43.5 → 36.5, CommonSenseQA 64.0 → 37.5 → 36.5 over two rounds. GPT-3.5 on CommonSenseQA: 75.8 → 38.1. Even GPT-4 on GSM8K: 95.5 → 91.5 → 89.0. Gains appeared only with oracle labels deciding when to stop. — [arXiv 2310.01798](https://arxiv.org/html/2310.01798v2)
- Same paper: Llama-2 "frequently" turned correct answers into incorrect ones, and correct→incorrect flips outnumbered incorrect→correct for GPT-3.5. — [arXiv 2310.01798](https://arxiv.org/html/2310.01798v2)
- Same paper: multi-agent debate was no better than plain self-consistency at equal response counts (GSM8K, 9 responses: debate 83.0 vs self-consistency 88.2). The authors attribute any gain to consistency, not to correction. — [arXiv 2310.01798](https://arxiv.org/html/2310.01798v2)
- Kamoi et al. survey (TACL 2024; arXiv Jun 2024). No prior work shows successful self-correction from feedback by a prompted LLM, except on tasks exceptionally suited to it. Self-correction works when reliable external feedback exists, and large-scale fine-tuning also enables it. — [arXiv 2406.01297](https://arxiv.org/abs/2406.01297)
- Zhang et al., "Small Language Models Need Strong Verifiers to Self-Correct Reasoning" (Apr 2024; LLaMA-2-13B-chat, Gemma-7B-it). On GSM8K, LLaMA-2-13B went 37.2 → 37.5 with its own fine-tuned verifier, 41.4 with a GPT-4 verifier, and 46.0 with an oracle. Gemma-7B went 36.3 → 36.7 / 42.5 / 47.4. The self-verifier's F1 was 51–57, against 88–90 for GPT-4. Their summary: "bottlenecked by the verifier rather than the refiner"; a weak self-verifier may be "misguiding the refiner." Note that these models are 7–13B, larger than Fred's. — [arXiv 2404.17140](https://arxiv.org/html/2404.17140v1)
- Han et al., "Small Language Model Can Self-Correct" (AAAI 2024). Intrinsic self-correction in about 6B models required **fine-tuning** (Partial Answer Masking); it was not achieved by prompting. — [AAAI](https://ojs.aaai.org/index.php/AAAI/article/view/29774)
- In 7–9B models, self-critique prompts lowered reasoning quality while RAG raised it (2026 preprint). — [arXiv 2601.00513](https://arxiv.org/pdf/2601.00513)
- RAG-specific: ALIGNRAG reports that a trained 8B critic beat a Self-Refine baseline by 12.1% out of domain, and argues that self-generated feedback is circular. — [arXiv 2504.14858](https://arxiv.org/pdf/2504.14858)

### Inferences
- Prompting Qwen3-1.7B to "check your answer against the passages and fix it" is the setup these papers find harmful. It also repeats the failure seen in thinking mode: a second free-form generation that drifts from the passages. Expect correct→incorrect flips, which under Fred's rule cost more than the fixes gain.
- Retrieved passages count as "external information," but not as reliable feedback. Feedback is a judgement on the draft, and the 1.7B model would still have to produce that judgement itself. The external-feedback evidence supports using a separate trained checker (section 3), not self-critique.
- If any revision step is used, it should be constrained (delete or replace flagged sentences) rather than a free rewrite, and it should run only when an external checker flags something. This matches the "verifier decides when to stop" condition under which the oracle gains appeared.

### Gaps
- No study found of prompted self-refine on 1–3B models in RAG question answering specifically, so the evidence is extrapolated from 7–13B models and reasoning tasks.
- No measurements found for Qwen3 or Qwen2.5 at 1.5–1.7B.

## 2. Chain-of-Verification (CoVe) and claim-level fact checking

### Takeaway
CoVe works on large models, but it was shown only on Llama-65B, closed-book, without retrieval. Its key ingredient is answering each verification question independently of the draft, with no view of it. Claim decomposition adds 2–4× cost, and the MiniCheck authors found it does not consistently improve a good checker's accuracy.

### Cited Findings
- CoVe (Dhuliawala et al., Meta, arXiv Sep 2023). The base model was Llama 65B (few-shot). FActScore on biographies: baseline 55.9, joint 60.8, factored 63.7, factor+revise 71.4 (ChatGPT 58.7, PerplexityAI 61.6). Wikidata list precision: 0.17 → 0.36 (two-step) or 0.32 (factored). **Large-model-only result.** — [arXiv 2309.11495](https://arxiv.org/html/2309.11495v2)
- CoVe failure mode: in the "joint" variant, verification answers condition on the draft and repeat its hallucinations. The factored variant, which keeps the draft out of context, beat joint on all tasks. — [arXiv 2309.11495](https://arxiv.org/html/2309.11495v2)
- CoVe's stated limitations: it reduces hallucinations but does not eliminate them. It evaluated only directly stated factual errors, not flawed reasoning. Gains are capped by the model's knowledge. It did not explore retrieval or tool use. — [arXiv 2309.11495](https://arxiv.org/html/2309.11495v2)
- MiniCheck (EMNLP 2024): claim decomposition "did not consistently improve" accuracy, raised inference cost 2–4×, and "should not be used until it provides a clear accuracy benefit." The authors suggest it only for interpretability. — [arXiv 2404.10774](https://arxiv.org/html/2404.10774v2)

### Inferences
- For Fred, a RAG version of CoVe is plausible: generate questions, answer each from the passages only (not from the draft), then revise. But every step is a 1.7B generation. Section 1 suggests the revise step is where harm enters, and the questions themselves may miss the dangerous claim. A cheaper, more reliable variant is to split the answer into sentences and score each sentence against the passages with a trained checker (section 3). This is CoVe's "factored" principle without generation.
- "Does the source support this?" answered by a 1.7B model is the weak-self-verifier case from section 1 (F1 around 50 even at 7–13B).

### Gaps
- No CoVe results found on ≤3B models or in RAG settings (not searched in depth). SAFE (Google, 2024) and FActScore rely on large LLMs and web search; they were not researched further because they are not usable offline.

## 3. Small fact-checkers and grounding judges

### Takeaway
Purpose-trained grounding checkers of 0.1–0.8B now score near GPT-4 on LLM-AggreFact (about 75 vs 75.3 balanced accuracy). Plain NLI models score far lower (about 61). That gap is the most likely reason Fred's DeBERTa-small NLI verifier failed. All of these models measure **support by the passage**, not danger. A dangerous conclusion is caught only if it is unsupported or contradicted by the passages.

### Cited Findings

LLM-AggreFact table from the MiniCheck paper (balanced accuracy, no per-dataset threshold tuning, 10 datasets) — [arXiv 2404.10774](https://arxiv.org/html/2404.10774v2):

| Model | Avg BAcc | Size |
|---|---|---|
| GPT-4 | 75.3 | – |
| MiniCheck-FT5 (Flan-T5-L) | 74.7 | 770M |
| Claude-3 Opus | 74.1 | – |
| MiniCheck-RoBERTa-L | 72.7 | 355M |
| MiniCheck-DeBERTa-L | 72.6 | 355M |
| AlignScore | 70.4 | 355M |
| GPT-3.5 | 69.6 | – |
| SummaC-ZS | 67.9 | 60M |
| FT5-ANLI-L (plain NLI) | 61.4 | 770M |
| T5-NLI-Mixed (plain NLI) | 61.0 | 11B |

Current leaderboard ("Average" across 11 datasets including RAGTruth; no update date shown) — [LLM-AggreFact](https://llm-aggrefact.github.io/):

| Model | Size | Average | RAGTruth |
|---|---|---|---|
| Bespoke-MiniCheck-7B | 7B | 77.4 | 84.0 |
| Granite Guardian 3.3 | 8B | 76.5 | 82.2 |
| gpt-4o-2024-05-13 | – | 75.9 | 84.3 |
| FactCG-DeBERTa-L | 0.4B | 75.6 | 82.3 |
| MiniCheck-Flan-T5-L | 0.8B | 75.0 | 78.0 |

The top entries are 9–27B (79.5 at best).

- Why NLI underperforms: MiniCheck's authors say MNLI- and ANLI-style training data "do not feature instances that reflect the complexity of LLM fact-checking." Older checkers also fail to consider all atomic facts in a claim and to reason across sentences. MiniCheck trains on GPT-4-synthesized hard examples built for exactly that. The paper claims GPT-4-level accuracy at about 400× lower cost. — [arXiv 2404.10774](https://arxiv.org/html/2404.10774v2)
- Thresholds: specialized checkers do worse without per-dataset threshold tuning, and MiniCheck's synthetic data is claimed to make it more robust to a fixed threshold. The leaderboard runs zero-shot. — [MiniCheck](https://arxiv.org/html/2404.10774v2), [LLM-AggreFact](https://llm-aggrefact.github.io/blog)
- HHEM-2.1-Open (Vectara) is fine-tuned from flan-t5-base (about 0.1B parameters). It uses under 600MB RAM at fp32 and takes about 1.5 s for a 2k-token input on a modern x86 CPU. Context is unlimited (HHEM-1.0 was capped at 512 tokens). Balanced accuracy: AggreFact-SOTA 76.55 (GPT-4 zero-shot 73.78), RAGTruth-QA 74.28 (GPT-4: 74.11), RAGTruth-Summ 64.42. Apache-2.0. — [HF model card](https://huggingface.co/vectara/hallucination_evaluation_model)
- LettuceDetect (Feb 2025) is ModernBERT-based and does token- and span-level hallucination detection with 8k context. RAGTruth example-level F1 is 79.22, 14.8% above Luna, the previous best encoder. It runs 30–60 examples/s on one GPU, and the authors describe it as about 30× smaller than the best models. — [arXiv 2502.17125](https://arxiv.org/abs/2502.17125)
- Granite Guardian (IBM, Dec 2024; 2B and 8B) covers broad risks including RAG groundedness, with a reported AUC of 0.854 on RAG-hallucination benchmarks. The 8B is stronger than the 2B, and I did not confirm a per-size breakdown. — [arXiv 2412.07724](https://arxiv.org/html/2412.07724v1)
- Bespoke-MiniCheck-7B, at 7B, is the best small entry. At Q4 it would be about 4GB, so it is over Fred's 600MB budget. — [LLM-AggreFact](https://llm-aggrefact.github.io/)

### Inferences
- **Why Fred's NLI verifier probably failed.** Four likely reasons:
  1. It was a small plain-NLI DeBERTa, the class that scores about 61 against about 73–75 for MiniCheck-style models.
  2. Min-over-sentences aggregation punishes any one paraphrased or connective sentence ("Stay calm.").
  3. q8 quantization may have cost some discrimination.
  4. Fred's good answers paraphrase, and NLI models trained on MNLI tend to reward lexical overlap.

  MiniCheck, FactCG and HHEM are trained on LLM-style paraphrase and multi-sentence evidence, so they may separate better. That is plausible, not proven. Untested HHEM remains the open caveat from the verifier test.
- **Candidates within 600MB** (sizes from model cards and papers; quantized sizes are my estimates):
  - HHEM-2.1-Open: about 0.1B, the cheapest to run on a phone.
  - MiniCheck-RoBERTa-L, MiniCheck-DeBERTa-L or FactCG-DeBERTa-L: about 0.36–0.4B, roughly 400MB at fp16 and less at int8.
  - MiniCheck-Flan-T5-L: 0.77B, fits only quantized.
  - LettuceDetect (ModernBERT base or large).

  FactCG-DeBERTa-L is the strongest of these on the leaderboard (75.6).
- **Unsafe conclusions.** None of these checkers models harm. "Burn poison oak" would be flagged only if the passages do not support it or contradict it. If the passages say "never burn," a checker trained on contradictions should mark it unsupported. That is the hopeful case. A dangerous answer that is supported by a retrieved passage would pass, for example a wrong passage retrieved, or a procedure applied to the wrong patient such as an adult CPR rate given for an infant. The local test's two safety defects (wound packing, infant CPR) ranked mid-pack under NLI, which fits that pattern. Expect a grounding checker to catch drift-type unsafe answers, which is the sampled and thinking-mode failure, but not wrong-retrieval or wrong-applicability errors.
- Any checker must be calibrated on Fred's own graded answers. The leaderboard numbers are zero-shot and averaged over news, dialogue and summarization data, not first-aid or survival text.

### Gaps
- Lynx (Patronus, 8B and 70B) was not researched further; it is too big either way.
- No measured phone (ARM, ONNX, llama.cpp) latencies found for MiniCheck or FactCG. HHEM's 1.5 s figure is for an x86 CPU.
- I did not verify that ONNX or GGUF exports of MiniCheck or FactCG exist. FactCG paper details (NAACL 2025?) were not fetched.
- I found no evaluation of any of these checkers on safety-critical domains, or on "contradicted" vs "merely unsupported" in medical or first-aid text.

## 4. Attribution: draft-then-cite, quote-then-answer, "every sentence must cite"

### Takeaway
Quote-first and sentence-interleaved citation improve citation quality, but the evidence comes from **fine-tuned** 7–8B models. Small models prompted with in-context examples cite only a small share of their sentences. For Fred, a "drop uncited sentences" rule is more realistic when enforced by an external checker than by the model's own citations.

### Cited Findings
- FRONT (ACL 2024 Findings): first extract supporting quotes, then answer conditioned on them. Citation quality rose 14.21% on average across ALCE datasets with **fine-tuned** LLaMA-2-7B, surpassing ChatGPT. — [arXiv 2408.04568](https://arxiv.org/abs/2408.04568v1)
- ReClaim (2024): interleaves a sentence-level reference with the claim it supports. Fine-tuned Llama3-8B-Instruct showed much better citation quality than a ChatGPT baseline. — [arXiv 2407.01796](https://arxiv.org/html/2407.01796v1)
- Even with in-context examples, base LLaMA-2-7B "can only generate citations for a very small portion of sentences." — [arXiv 2402.04315](https://arxiv.org/pdf/2402.04315)
- Local result: "evidence first" changed 27 of 33 first drafts and netted worse (`docs/results-deep-thinking.md`, round 1).

### Inferences
- Prompted quote-then-answer is roughly what Fred's "evidence first" already tried, and it lost. Fine-tuning Qwen3-1.7B for citation is out of scope for an opt-in mode.
- A safer form uses no new generation: take the normal greedy answer, score each sentence against the passages with a small checker, and drop or flag sentences below threshold. That keeps the right-answer text unchanged and removes drifted sentences. The risk: dropping a sentence can change meaning, for example deleting "do not" context or a qualifier. Also, as the verifier test showed, declining or truncating a correct answer costs points.

### Gaps
- No published measurement found of "drop sentences an external checker can't support" on a ≤3B generator. The numbers above are citation quality, not counts of unsupported claims.

## 5. Selecting among deterministic candidates; universal self-consistency; small reward models

### Takeaway
Universal Self-Consistency (USC) uses the LLM to pick the most consistent of N samples. It matches majority voting on math and improves open-ended generation, but it was shown on large models with sampled candidates. For Fred, the defensible variant is **deterministic diversity**: greedy answers from different passage subsets or orderings, or different prompts, ranked by an external grounding checker. I found no ≤1B process reward model for RAG faithfulness. The trained grounding checkers in section 3 fill that role.

### Cited Findings
- USC (Chen et al., Google DeepMind, Nov 2023; ICML 2024): the LLM selects the response most consistent with the others. It matches standard self-consistency on GSM8K and MATH, matches execution-based voting on code, and "consistently improves" over greedy on open-ended tasks. All N samples must fit in one prompt. **Large-model result.** — [arXiv 2311.17311](https://arxiv.org/abs/2311.17311v1)
- Huang et al.: consistency (voting), not critique, accounts for the gains attributed to debate. — [arXiv 2310.01798](https://arxiv.org/html/2310.01798v2)
- Tiny-Critic RAG (2026 preprint): a LoRA-tuned small model gates RAG, with faithfulness 0.86 vs 0.88 for heavy CRAG at about 492 ms vs 1235 ms TTFT. Under 45% noise, naive RAG faithfulness fell from 0.89 to 0.44. — [arXiv 2603.00846](https://arxiv.org/html/2603.00846v1)
- Local: sampling at temperature 0.6 produced every unsafe answer in Fred's runs; vector-similarity scores between drafts differed by about 0.01 (`docs/results-deep-thinking.md`).

### Inferences
- USC with Qwen3-1.7B as the selector stacks two weak points: a 1.7B judge, and 3+ answers in one context, which gets long with 4 passages each. Not recommended.
- Proposed candidate set, all greedy (so no sampling risk):
  - (a) the normal answer
  - (b) the answer from passages reordered or from the top-3 only
  - (c) the answer with one different system phrasing

  Score each by its lowest-scoring sentence under a MiniCheck- or FactCG-class checker. Pick a candidate over the normal answer **only if** it beats the normal answer by a margin and the normal answer has a sentence below threshold. Otherwise keep the normal answer. This makes "the normal answer" the default and limits changes to cases where the checker sees a problem. That is the same structure as the round-4 rule that passed (act only after a flat decline).
- Agreement between deterministic candidates (two of three greedy variants make the same claim) can serve as a second, model-free signal. But vector similarity already proved too coarse, so agreement would need checker-based cross-entailment (does candidate A support B's sentences?).

### Gaps
- I found no PRM or outcome reward model of 1B or less trained for RAG faithfulness. Known small PRMs (math-focused) were not searched in this pass.
- No published result found for "greedy answers from different passage subsets, selected by a grounding checker" on small models.

## 6. Abstain when unsure: a checker score as a fallback

### Takeaway
Use the checker to **gate** and keep the normal answer as the fallback. Do not let the checker turn answers into declines across the board. Fred's own verifier test shows false alarms cost accuracy points. A checker that only decides whether deep mode's alternative may replace the normal answer cannot make a correct normal answer worse by declining it.

### Cited Findings
- Local: at an NLI threshold of 0.30, the verifier flagged 3 of 9 failures and 2 of 22 acceptable answers. Catching both safety defects required flagging 13 of 22 acceptable answers. Declining scores 0, the same as a wrong answer (`docs/results-verifier-test.md`).
- Checkers need threshold calibration, and a fixed 0.5 default may transfer poorly across domains. — [MiniCheck](https://arxiv.org/html/2404.10774v2), [LLM-AggreFact blog](https://llm-aggrefact.github.io/blog)
- Self-correction gains in Huang et al. came only when an oracle decided when to stop. A good stopping or gating signal is the valuable part. — [arXiv 2310.01798](https://arxiv.org/html/2310.01798v2)

### Inferences
- Three tiers fit Fred's rules:
  1. Checker is happy with the normal answer: show it unchanged. This is most answers, and nothing changes.
  2. A sentence in the normal answer is low and an alternative greedy candidate scores clearly higher everywhere: show the alternative.
  3. A sentence is very low (contradicted) and no candidate is clean: drop that sentence if what remains stands alone, or else show the normal answer with a "check the source card" note. A full decline is reserved for the case where the low sentence is the main instruction.
- The thresholds must be set on the tuning set and confirmed on held-out sets, under the same zero-new-unsafe rule. With only 9 failures in the last verifier test, the go/no-go set should be enlarged first. Older run outputs include the sampled unsafe drafts ("burn poison oak", "wild beans safe"). Those make a cheap first test: does FactCG, MiniCheck or HHEM score them below the greedy drafts? That costs one desktop script, with no phone work.

### Gaps
- No published study found of checker-gated fallback in a safety-critical consumer RAG app with a small generator.
- I found no reliable calibration curves (score vs. precision) for HHEM, MiniCheck or FactCG on QA-style RAG answers beyond the RAGTruth balanced-accuracy figures above.
