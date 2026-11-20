# Retrieval-side and question-understanding compute for a ≤2B offline RAG (Fred)

Scope: ways to spend extra compute *around* Qwen3-1.7B (retrieval, reranking, context filtering, question checks) rather than more free generation. Fred context (from local docs, 2026-11-15/16): shipped "deep thinking" = rephrase + second search only after a flat decline (+1.5 on 275 unseen questions, safe, ~0.7 s desktop). Failed: Qwen3 thinking mode, sampled best-of-3 (all unsafe answers came from sampled drafts at T=0.6), evidence-first prompting, sentence-vector judging. Unsolved: #21-class "answered a different question" (belly-wound packing, scalp bleeding, plant cordage, marsh plants). Retrieval: EmbeddingGemma-300M, ~4 passages, cosine floor. More passages (8) never properly tested.

Source note: items marked *(abstract, not re-fetched)* are well-known papers cited from their arXiv abstract pages from prior knowledge; everything else was read via search/fetch this session (2026-11-20).

## 1. Query rewriting / expansion (HyDE, query2doc, multi-query/RAG-Fusion), decomposition, step-back — evidence with ≤3B generators

### Takeaway
Evidence with ≤3B generators is thin and mostly negative or neutral for *retrieval quality*; LLM expansion helps weak retrievers and hurts strong ones, and HyDE with a small generator adds hallucination risk. For Fred, the only well-supported use is the one already shipped: a targeted rewrite when the first search fails. Decomposition and step-back are effectively untested at ≤2B without fine-tuning and target multi-hop questions Fred rarely gets.

### Cited Findings
- Gemma 1B vs 4B on-device assistant (June 2025): HyDE "improves semantic relevance, especially for complex physics prompts" but adds 25–40% response time and "a non-negligible hallucination rate in personal-data retrieval"; plain RAG reduced latency up to 17% and eliminated factual hallucinations on domain queries. Abstract only reports these figures; no absolute scores. — [Sorstkins, arXiv 2506.21568](https://arxiv.org/abs/2506.21568)
- A secondary summary of the same search says "neither RAG nor HyDE improved the retrieval performance for the query" in that study (not verified in full text). — [arXiv 2506.21568 PDF](https://arxiv.org/pdf/2506.21568)
- Original HyDE: with a small instruction-tuned generator (Flan-T5 11B) plus Contriever, HyDE performance "drastically degraded" (secondary summary of Gao et al. 2022). — [Medium summary of HyDE](https://medium.com/papers-i-found/e11-hypothetical-document-embedding-hyde-acee7e56bd08); original: [HyDE, arXiv 2212.10496](https://arxiv.org/abs/2212.10496) *(abstract, not re-fetched)*
- Weller et al. (EACL 2024 Findings; 11 expansion methods, 12 datasets, 24 retrievers): "strong negative correlation between retriever performance and gains from expansion"; expansions add noise causing false positives; advice: use expansion only for weak retrievers or big format shift, "otherwise, avoid expansions". — [When do Generative Query and Document Expansions Fail?, arXiv 2309.08541](https://arxiv.org/abs/2309.08541)
- HyDE and query2doc "do not consistently enhance" learned sparse retrievers. — [arXiv 2506.04760](https://www.arxiv.org/pdf/2506.04760) (via search snippet)
- Multi-query rewriting paper (7–8B models): RRR, Rewrite and HyDE are inferior to original-query retrieval in some scenarios. — [DMQR-RAG, arXiv 2411.13154](https://arxiv.org/pdf/2411.13154)
- Industrial RAG (EasyRAG, network ops, GLM4): query rewriting brought no benefit; HyDE 89.2 vs original query 92.7. — [EasyRAG, arXiv 2410.10315](https://arxiv.org/html/2410.10315v1)
- RAG-Fusion = rewrite into multiple queries + Reciprocal Rank Fusion; no benchmark against a strong dense retriever found. — [RFG Framework (SciTePress 2025)](https://scitepress.org/publishedPapers/2025/138369/pdf/index.html)
- Decomposition with small models: "Using SLMs directly for question decomposition is often ineffective"; a fine-tuned 3B decomposer beats a frozen one (decomposer feeds a larger black-box LLM). — [Collab-RAG (Emory)](https://www.cs.emory.edu/~jyang71/files/collab-rag.pdf)
- AtomRAG: gains with a Llama model came "not from retrieving more relevant documents, but rather from more effective problem decomposition"; on BRIGHT the no-retrieval baseline scored highest for Llama (model size not stated). — [AtomRAG](https://www.academia.edu/3071-0286/2/2/10.20935/AcadAI8242)
- Step-back prompting was introduced and measured on PaLM-2L (large model); later uses cited Mistral-7B as the step-back model. No ≤3B evidence found. — [Step-Back, arXiv 2310.06117](https://arxiv.org/abs/2310.06117) *(abstract, not re-fetched)*; [RE-GAINS, arXiv 2401.15724](https://arxiv.org/pdf/2401.15724)
- Rewrite-Retrieve-Read trained a small (T5-large) rewriter with RL from the reader's feedback — i.e., small rewriters work when trained. — [arXiv 2305.14283](https://arxiv.org/abs/2305.14283) *(abstract, not re-fetched)*

### Inferences
- EmbeddingGemma-300M on a narrow, curated corpus is a relatively strong retriever for in-domain phrasing, so Weller et al. predicts general expansion (HyDE/multi-query on every question) would add noise; Fred's "only after a flat decline" gate is exactly the regime where expansion is supported (weak first retrieval / vocabulary mismatch).
- HyDE is risky for Fred specifically: the hypothetical document is an unreviewed 1.7B generation; even if never shown, it steers retrieval toward passages that match the model's guess (e.g., an unsafe plant-edibility guess pulls edibility passages). Multi-query with RRF over *reviewed* passages is safer: the rewrites only choose which reviewed text is seen.
- Cost: HyDE = 1 extra generation (~100 tokens) + 1 search; multi-query = 1 generation emitting 2–4 rewrites + 2–4 embeddings/searches (embedding 300M is cheap vs generation); decomposition/step-back = 1 generation + N searches, and only helps multi-part questions.
- All of these can use greedy decoding (rewrites need no sampling), so they don't reintroduce the sampled-draft safety problem.

### Gaps
- No study found benchmarking HyDE/query2doc/RAG-Fusion with 1–2B generators on standard RAG QA (BEIR-style) with ablations.
- No ≤3B step-back result found.
- Whether rewriting helps the #21 failure class (wrong question answered) at all: no evidence; those failures are likely interpretation, not recall.

## 2. Iterative / adaptive retrieval: Self-RAG, CRAG, FLARE, IRCoT, Adaptive-RAG — small-model viability; small evaluators

### Takeaway
Self-RAG needs a fine-tuned generator (7B/13B) and is out. FLARE relies on token-probability confidence of large models. IRCoT and Adaptive-RAG are prompt/classifier pipelines that reportedly work with Flan-T5-class models, but they target multi-hop QA. The reusable piece is CRAG's idea: a small (~0.77B, or LoRA SLM) *retrieval evaluator* deciding "correct / ambiguous / incorrect" before generation — but all evidence for useful evaluators involves fine-tuning, and the original evaluator fails on domain transfer.

### Cited Findings
- CRAG's retrieval evaluator is a fine-tuned T5-large (0.77B), much lighter than Self-RAG's instruction-tuned Llama-2-7B critic; CRAG improved standard RAG and Self-RAG on PopQA, Biography, PubHealth, ARC-Challenge (Jan 2024). — [CRAG, arXiv 2401.15884](https://arxiv.org/html/2401.15884v3)
- CRAG reproduction (Mar 2026): open-source components (Wikipedia instead of web search, rule-based keyword extraction) reach comparable performance; SHAP shows the evaluator "relies primarily on named entity alignment and exhibits systematic domain transfer failure on science questions". — [arXiv 2603.16169](https://arxiv.org/html/2603.16169v1)
- Self-RAG requires fine-tuning on curated (input, output, reflection) triples, limiting domain adaptation. — [Financial QA self-improving RAG, arXiv 2608.26706](https://arxiv.org/pdf/2608.26706); original trained Llama-2 7B/13B: [Self-RAG, arXiv 2310.11511](https://arxiv.org/abs/2310.11511) *(abstract, not re-fetched)*
- Tiny-Critic RAG (Mar 2026): a LoRA-tuned SLM as binary gatekeeper (retrieval good enough vs fallback) with constrained decoding and non-thinking mode; routing accuracy "comparable to GPT-4o-mini" on noise-injected data; latency an order of magnitude lower than LLM evaluators. Parameter count not given on abstract page. — [arXiv 2603.00846](https://arxiv.org/abs/2603.00846)
- Adaptive-RAG (NAACL 2024): a T5-large classifier routes queries among no-retrieval, single-step and iterative (IRCoT-style) retrieval; results reported on GPT-3.5 and FLAN-T5 series. A secondary summary says classifier size (T5-small→large) made minimal difference (unverified). — [Adaptive-RAG, arXiv 2403.14403](https://arxiv.org/html/2403.14403v2); [repo](https://github.com/starsuzi/adaptive-rag)
- IRCoT interleaves retrieval with CoT steps; its abstract reports gains also hold for smaller models such as Flan-T5-large without extra training (multi-hop datasets). — [IRCoT, arXiv 2212.10509](https://arxiv.org/abs/2212.10509) *(abstract, not re-fetched)*
- FLARE triggers retrieval when the next sentence contains low-probability tokens; evaluated with GPT-3.5 (large-model only). — [FLARE, arXiv 2305.06983](https://arxiv.org/abs/2305.06983) *(abstract, not re-fetched)*
- Agentic RAG vs enhanced RAG (Jan 2026): agentic settings ~1.5× more time and more expensive. — [Is Agentic RAG worth it?, arXiv 2601.07711](https://arxiv.org/html/2601.07711v2)
- Small frozen RAG models (3.8B–8B; AACL 2026): abstain reliably when evidence is missing, but with explicit abstention prompting still answered 41.6% of misleading-context questions (63% repeating the planted wrong entity); CoT added little; a generator-side conflict check cut misleading answers to 13.3% but discarded many correct answers; an NLI verifier kept coverage but failed when parametric memory agreed with the misleading passage. "Prompt-based abstention asks whether context is sufficient, not whether it is correct." — [arXiv 2608.22228](https://arxiv.org/abs/2608.22228)

### Inferences
- Fred already has the CRAG skeleton without a trained evaluator: cosine floor + scope scorer = "incorrect → decline", card matcher = reviewed rescue, deep-thinking rewrite = "corrective re-search". A new evaluator would only add value if it judges *passage-question fit* better than cosine — i.e., a cross-encoder reranker score (section 3) is the practical "small evaluator" (0.6B Qwen3-Reranker is pointwise yes/no relevance, effectively a CRAG-style evaluator, and needs no fine-tuning by Fred).
- Using Qwen3-1.7B itself as the evaluator (prompted yes/no "does this passage answer the question?") is cheap (1 short greedy generation, or a single forward pass reading yes/no logits per passage, ~4 passes) but the 2608.22228 result suggests prompt-only checks on small models are weak at judging correctness; they may be better at judging topical fit, which is Fred's problem.
- IRCoT/FLARE-style multi-step loops are poor fits: Fred's questions are mostly single-hop, and each extra step is a generation by the model whose drift is the failure.
- Prior Fred finding (NLI checking model rejected, `docs/results-verifier-test.md`) matches 2608.22228: verifiers don't catch what the evidence doesn't contradict.

### Gaps
- No head-to-head of CRAG/Self-RAG/Adaptive-RAG at 1–2B generator scale found.
- Tiny-Critic's model size and numbers not available from the abstract page.
- No off-the-shelf ≤1B evaluator trained for first-aid/survival domain; CRAG's T5 evaluator is shown to transfer poorly.

## 3. Reranking: small cross-encoders and LLM rerankers — size, gain over bi-encoder top-k, phone feasibility

### Takeaway
Qwen3-Reranker-0.6B is the only small reranker with published gains *over a modern 0.6B embedder's own top-100* (+4.0 MTEB-R, +1.7 MMTEB-R); older/smaller cross-encoders (bge-reranker-v2-m3, jina, gte) actually scored *below* that first stage in the same table, and off-the-shelf MiniLM rerankers hurt on technical corpora in one study. Since Fred only takes ~4 passages from a small curated corpus, reranking a top-20 with Qwen3-Reranker-0.6B (same tokenizer family as the generator, GGUF-able, supported by llama.cpp's rerank endpoint) is the most promising retrieval-side lever — but gains must be measured on Fred's own sets. Zero-shot listwise reranking by a 1.7B model is not supported by evidence.

### Cited Findings
- Qwen3 Embedding report (June 2025), reranking top-100 from Qwen3-Embedding-0.6B: first stage MTEB-R 61.82 / MMTEB-R 64.64 / MLDR 50.26; Qwen3-Reranker-0.6B 65.80 / 66.36 / 67.28; Qwen3-Reranker-4B 69.76 / 72.74 / 69.97; BGE-reranker-v2-m3 (0.6B) 57.03 / 58.36 / 59.51; Jina-multilingual-reranker-v2-base (0.3B) 58.22 / 63.73 / 39.66; gte-multilingual-reranker-base (0.3B) 59.51 / 59.44 / 66.33. Scores are the authors' own runs. — [Qwen3 Embedding, arXiv 2506.05176](https://arxiv.org/html/2506.05176v3)
- Qwen3-Reranker scoring is pointwise: chat template, system prompt "answer can only be yes or no", user turn `<Instruct>/<Query>/<Document>`, score = softmax over P(yes), P(no) of next token; instruction is customizable per task. — [arXiv 2506.05176](https://arxiv.org/html/2506.05176v3); [model card](https://huggingface.co/Qwen/Qwen3-Reranker-0.6B)
- ms-marco-MiniLM-L6-v2 (≈22M params): NDCG@10 74.30 on TREC DL 2019 (L-4 73.04, L-12 74.31, TinyBERT-L-2 69.84); in-domain MS MARCO numbers, not BEIR. — [model card](https://huggingface.co/cross-encoder/ms-marco-MiniLM-L6-v2)
- On technical/scientific corpora, off-the-shelf cross-encoders (ms-marco-MiniLM, BGE-reranker-base) changed NDCG by −0.3% to −3.1% while adding 560–2100 ms. — [vstash, arXiv 2604.15484](https://arxiv.org/pdf/2604.15484)
- Stronger retrievers surface more highly distracting passages, reducing accuracy up to 11 points when included. — [Beyond Relevance (CEUR-WS Vol-4026)](https://ceur-ws.org/Vol-4026/paper7.pdf)
- On-device latency data points (not phones, not peer-reviewed): GGUF MiniLM-L6 Q4_K ~0.8 s per candidate in one llama.cpp-based benchmark (recall@5 +0.031, MRR +0.028 vs no rerank); ONNX/transformers.js MiniLM-L6 q8 on M4 Mac, 20 docs: p50 188 ms 1 thread, 97 ms 4 threads. ~8× discrepancy, likely runtime-dependent. — [integrallis/models #360](https://github.com/integrallis/models/issues/360); [natively #765](https://github.com/Natively-AI-assistant/natively-cluely-ai-assistant/issues/765)
- LLM rerankers: listwise rerankers output a permutation of doc IDs and suffer positional bias (degrade when input order changes); Rank-without-GPT built open-source listwise rerankers via fine-tuning; a bi-encoder plus pointwise cross-encoder can surpass smaller LLM rerankers. — [Rank-without-GPT, arXiv 2312.02969](https://arxiv.org/pdf/2312.02969); [How Good are LLM-based Rerankers?, EMNLP 2025 Findings](https://aclanthology.org/2025.findings-emnlp.305.pdf)
- Provence reranker (DeBERTa-v3, 430M, 512 tokens, CC BY-NC 4.0): combined reranking + sentence pruning in one pass (see section 4). — [model card](https://huggingface.co/naver/provence-reranker-debertav3-v1)

### Inferences
- Phone cost estimate (inference, not measured): Qwen3-Reranker-0.6B is ~1/3 the size of the generator; scoring 20 passages × ~300 tokens = ~6k tokens of prefill, no decoding. At typical phone prefill speeds for a 0.6B Q4/Q8 model this is plausibly a few seconds — within "tens of seconds" — and it's deterministic (no sampling). It adds ~400–600 MB to the download/memory unless shared; memory budget is the real constraint (a 4B didn't fit).
- Cheaper alternative with zero extra download: use Qwen3-1.7B itself as a pointwise yes/no reranker (same prompt format as Qwen3-Reranker, read yes/no logits after one prefill per passage). Not a trained reranker, so quality unknown; but it costs only prefill, keeps greedy, and adds no text.
- Reranking also gives a better gate than cosine: a calibrated relevance probability could replace/augment the cosine floor and the "flat decline" trigger.
- Reranking chooses among reviewed passages only, so it adds no unreviewed claims. Risk: a reranker can promote a distracting passage (Beyond Relevance), so it should be validated with Fred's pass rule (zero new unsafe).
- bge-reranker-v2-m3 / jina / gte are not worth it over EmbeddingGemma based on the Qwen3 table (they fell below a 0.6B embedder's first stage on English retrieval) — caveat: authors' own runs.

### Gaps
- No published phone (Android/iOS) latency for Qwen3-Reranker-0.6B via llama.cpp/llama.rn found.
- No result for reranking over EmbeddingGemma-300M specifically.
- No measured zero-shot pointwise reranking quality for Qwen3-1.7B (non-reranker) found.

## 4. Context compression / filtering (RECOMP, relevance filtering, sentence selection) to stop drift or off-question answers

### Takeaway
Small models are more distractible: 3B models are measurably more susceptible to irrelevant passages than larger siblings, and more passages raise recall but lower precision and can lower accuracy. Sentence-level pruning (Provence, RECOMP-extractive) removes off-topic sentences at near-zero quality cost and can output "nothing relevant" — directly relevant to Fred's off-question answers, where a passage about a neighboring topic likely pulls the answer sideways. This argues *against* simply going from 4 to 8 passages without filtering.

### Cited Findings
- "The 3B versions across all model families show greater susceptibility to distraction compared to their larger counterparts"; fine-tuning on hard distracting passages gave +5.3–16.1 points for Llama-3.2-3B. — [The Distracting Effect, arXiv 2505.06914](https://arxiv.org/pdf/2505.06914)
- More retrieved passages raise recall but lower precision; RAG accuracy stays below recall at every k because hard negatives mislead (Gemma-2-9B); stronger retrievers can produce more harmful negatives. — [Long-Context LLMs Meet RAG, arXiv 2410.05983](https://arxiv.org/pdf/2410.05983)
- Top-1→Top-3 generally helps, but Llama-2-7B-Chat and GPT-3.5 show decreased scores with additional noisy chunks. — [MIRAGE, arXiv 2504.17137](https://arxiv.org/pdf/2504.17137)
- RAGGED: Llama and Claude readers are more noise-sensitive; Flan/GPT more robust; optimal k is reader-dependent. — [RAGGED, arXiv 2403.09040](https://arxiv.org/html/2403.09040v2)
- RECOMP (ICLR 2024): extractive compressor selects helpful sentences (contrastively trained); abstractive compressor summarizes; both can output an empty string when retrieval is irrelevant ("selective augmentation"); compression to 6% with minimal loss on LM and open-domain QA. — [RECOMP, arXiv 2310.04408](https://arxiv.org/abs/2310.04408)
- Provence (ICLR 2025, NAVER): sentence-level binary pruning head added to a DeBERTa-v3 reranker; selects 0..all sentences per passage; reported "negligible to no drop in performance" across domains; adds almost no cost beyond reranking; English only (XProvence for multilingual). — [Provence, arXiv 2501.16214](https://arxiv.org/html/2501.16214v1); [HF blog](https://huggingface.co/blog/nadiinchi/provence); [XProvence, arXiv 2601.18886](https://arxiv.org/html/2601.18886v1)
- Lost in the Middle: models use information at the start/end of context better than the middle. — [arXiv 2307.03172](https://arxiv.org/abs/2307.03172) *(abstract, not re-fetched)*

### Inferences
- For the #21 class (belly-wound packing answered as generic wound packing; scalp bleeding answered as general bleeding), a likely mechanism is a top passage on the neighboring topic. Sentence/passage filtering conditioned on the *specific* question (Provence-style, or the reranker's yes/no on each passage with a threshold) attacks that directly; adding more passages likely worsens it for a 1.7B reader.
- Filtering preserves greedy decoding and only removes reviewed text, so it adds no unreviewed claims; risk is removing a needed caveat sentence (e.g., "do not push organs back in"), so prune at passage level first, sentence level only with a conservative threshold, and keep safety-warning sentences pinned.
- Provence's CC BY-NC license may block use in a distributed app; check before adopting. Qwen3-Reranker (Apache-2.0 per Qwen's usual license — verify) at passage level is the license-safe path.
- Cost: passage filtering = same as reranking (prefill only). Sentence filtering via the 1.7B model = 1 extra greedy generation listing sentence IDs (cheap output, but a new failure surface).

### Gaps
- No direct evidence that context filtering reduces "answered a different question" errors specifically (vs factual errors).
- No measurement of Provence or RECOMP with ≤2B readers found.
- Fred's own data on whether the 4 held-out #21 failures had an off-topic passage ranked first isn't in the notes read — this is the cheap diagnostic to run first.

## 5. Question-understanding checks: restate intent, verify the answer addresses the question (RAGAS answer relevance); evidence they catch off-question answers

### Takeaway
"Answer relevance" via reverse-question generation (RAGAS, SCORE) is a well-defined check and off-topic answers are a large share of errors (≈1/3 of wrong answers in multi-hop QA); Dr3 shows an LLM can detect and repair some (−13% off-topic, +3 EM) — but all evidence uses large judge models, none ≤2B. For Fred, the deterministic form is attractive: have Qwen3-1.7B greedily generate the question its draft answers, embed it with EmbeddingGemma, and compare to the user's question; a low score triggers a reviewed fallback (card/quote/decline) or a re-answer with filtered context, never a sampled redraft.

### Cited Findings
- Dr3 (LREC-COLING 2024): off-topic answers are ~1/3 of incorrect answers in open-domain multi-hop QA; a Discriminator (the LLM itself) flags off-topic answers and a Corrector revises the reasoning chain; off-topic answers reduced by nearly 13%, EM +~3% on HotpotQA/2WikiMultiHopQA. Model sizes not stated on abstract page (large LLMs presumed). — [Dr3, arXiv 2403.12393](https://arxiv.org/abs/2403.12393)
- RAGAS answer relevance: generate questions from the answer with an LLM and score cosine similarity to the original question (reference-free). — [RAGAS, arXiv 2309.15217](https://arxiv.org/abs/2309.15217) *(abstract, not re-fetched)*
- SCORE (Feb 2026): prompts an LLM to generate five candidate questions the answer would fit and compares them with the original query; notes high relevance scores can come from superficial lexical overlap with domain keywords and applies masking to counter it. — [SCORE, arXiv 2602.10017](https://arxiv.org/pdf/2602.10017)
- An answer that merely restates the question scores high on similarity without answering; similarity to the question is not a proxy for relevance. — [vizlearn guide (practitioner)](https://vizlearn.in/gen_ai/relevance_in_llm_evaluation.html)
- LLM-judge answer relevance metrics penalize extraneous content and may flag extra detail as lower relevance even when on-topic. — [Opik docs](https://www.comet.com/docs/opik/evaluation/metrics/answer_relevance)
- Formalizing the information need (explicit statement of what the user wants) improves LLM relevance judgments. — [arXiv 2604.04140](https://arxiv.org/pdf/2604.04140) (search snippet only)
- Fred's own earlier evidence: a sentence-vector check between drafts failed (scores differed ~0.01). — local `docs/results-deep-thinking.md`

### Inferences
- The reverse-question check differs from Fred's failed sentence-vector check: it compares *question vs inferred question* (a sharper contrast: "how to pack a belly wound" vs "how to pack a wound"), not draft vs draft. Whether EmbeddingGemma separates those finely enough is unknown — SCORE's lexical-overlap warning applies; a token-level check on the question's key qualifiers (body site, "belly", "scalp") could be a deterministic complement.
- A "restate the question first" step (model writes a one-line intent, then answers) changes the prompt and therefore most answers, like evidence-first did (27/33 changed, net worse) — risky. Using restatement only as a *check* (separate generation, answer unchanged unless the check fails) preserves the normal answer on the pass path.
- Intent-specific retrieval: feeding the qualifier-preserving restatement into the reranker instruction (`<Instruct>`) rather than into the generator is a lower-risk use.
- Cost: 1 extra short greedy generation (~20–40 tokens) + 1 embedding per answer; on failure, a fallback (zero generation) or 1 re-answer with filtered passages.

### Gaps
- No evidence found for answer-relevance or off-topic detection using ≤2B judges.
- No calibration data on how often a check like this would wrongly reject correct Fred answers (false-reject rate would turn good answers into declines).

## 6. Which preserve greedy decoding and add no unreviewed claims; compute cost summary

### Takeaway
Everything that only *selects or filters reviewed text* (reranking, passage/sentence filtering, multi-query+RRF, relevance gating) keeps greedy decoding and adds no new claims; methods that inject model-written text into retrieval or the answer (HyDE, query2doc, step-back abstractions, Self-RAG critiques, sampled redrafts) either add unreviewed content or steer retrieval with it. Ranked for Fred: (1) Qwen3-Reranker-0.6B or 1.7B-as-pointwise-judge over top-20, then keep top-k above a threshold; (2) passage filtering for off-topic neighbors; (3) reverse-question relevance check routing to reviewed fallbacks; (4) multi-query+RRF only in the existing decline gate.

### Cited Findings
- All unsafe answers in Fred's deep-thinking rounds came from sampled drafts (T=0.6), never greedy. — local `docs/results-deep-thinking.md`
- Reranker scoring is a single forward pass reading yes/no probabilities (no free generation). — [arXiv 2506.05176](https://arxiv.org/html/2506.05176v3)
- Provence pruning reuses the reranking forward pass (near-zero extra cost). — [HF blog](https://huggingface.co/blog/nadiinchi/provence)
- HyDE introduces hallucination risk at small scale. — [arXiv 2506.21568](https://arxiv.org/abs/2506.21568)
- Prompt-only conflict checks on small models trade coverage for safety (13.3% misleading answers but many correct answers discarded). — [arXiv 2608.22228](https://arxiv.org/abs/2608.22228)

### Inferences
Cost table (extra work per question; phone timings are estimates, not measured):

| Method | Extra generations | Extra searches/passes | Greedy? | Unreviewed text? | Small-model evidence |
|---|---|---|---|---|---|
| Rerank top-20 with Qwen3-Reranker-0.6B | 0 | 20 prefill-only passes (extra ~0.5 GB model) | yes | no | yes (0.6B, MTEB-R +4.0 over 0.6B embedder) |
| 1.7B as pointwise yes/no reranker | 0 (1 token each) | ~10–20 prefills | yes | no | none found |
| Passage/sentence filter (Provence-style) | 0 | shared with rerank | yes | no (can drop caveats) | Provence: no drop (large readers) |
| Multi-query + RRF (decline gate only) | 1 short | 2–4 searches | yes | rewrites steer only | weak / mixed |
| HyDE | 1 (~100 tok) | 1 search | yes | steers retrieval with a guess | negative/hallucination at 1B |
| Reverse-question relevance check | 1 short | 1 embedding | yes | no (check only) | large judges only |
| CRAG-style evaluator | 0 if reranker reused | — | yes | no | needs trained evaluator |
| Self-RAG / FLARE | many | many | — | yes | needs fine-tuning / large models |
| More passages (4→8) | 0 | longer prefill | yes | no | small models more distractible |

- These combine: rerank-and-filter is a pipeline change (affects every answer, needs full held-out run); reverse-question check is a post-hoc gate (affects only flagged answers), fitting Fred's "deep thinking only changes what would otherwise fail" pattern.

### Gaps
- No end-to-end study combining reranking + filtering + relevance check with a ≤2B generator.
- Phone timings for every row are unmeasured; the RELEASE-HANDOFF notes phone timing of deep thinking itself is still emulator-only.
