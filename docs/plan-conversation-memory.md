# Plan: memory, responsiveness and accuracy across a longer conversation

2026-09-30. Ticket #101. Follows `plan-understand-2.md` (#98) and the open items in #100.
Goal (Ryan, 2026-09-30): Fred answers more often across a long conversation,
stays quick, and stays accurate (safe first).

## Where Fred stands (measured today)

From the round-2 runs (`understand-round2/`) and the phone check:

- **Answers when it should:** 67 of 86 turns that should get an answer (78%).
  The misses are mostly mid-conversation symptom updates that get the watch
  reply ("the leg is getting bigger and bigger" after a snakebite, "its
  swelling pretty bad"), a few statements read as small talk, and short
  follow-ups declined ("what now").
- **By turn:** the right kind of reply 86% at turns 1 and 2, 90% at turn 3.
  Our chats are 2-10 messages long; **nothing longer has ever been tested.**
- **What Fred remembers:** the last 10 messages from the last 30 minutes; the
  current topic's thread (up to 3 messages); conditions (snakebite, burn, ...)
  set by trigger phrases and never cleared. It does not remember what it
  said (which card it showed), who is hurt, where the hiker is (altitude, heat,
  dark), or that something is over ("the rangers carried him out").
- **Time on the phone:**

  | | Median |
  |---|---:|
  | Deciding what to do, step not run | 3.3 s (2.4 s of it the intent check, on every message) |
  | Deciding, step run | 6.2 s (4.2 s model, 2.1 s embedding) |
  | Embedding, turn 1 → turn 4+ | 0.7 s → 2.1 s |
  | A card answer shown | 4.0 s |
  | **A model-written answer: first words** | **15.2 s** (done 17.9 s) |

  The slowest thing a hiker sees is a model-written answer, and most of that
  is reading the prompt (passages, ~700-1200 tokens) before the first word.

## What the research says

`research-conversation-safety.md` (2026-09-30) plus:

- **Long conversations degrade even for frontier models** (LLMs Get Lost in
  Multi-Turn Conversation, 39% average drop; LongMemEval, ICLR 2025: ~30% drop
  for commercial assistants across sustained chats). Full history in the prompt
  is not the fix; the benchmarks point to structured memory that is indexed and
  updated, with explicit handling of **knowledge updates** (a fact that
  changes) and **abstention**.
- **Dialogue state tracking:** for a small, closed slot set, a rule-based
  tracker is the recommended start; a typed state object is passed as data
  instead of being re-inferred from text every turn. Open-ended slots are
  where models help (and a 7B model reaches only ~60-80% joint accuracy on
  MultiWOZ). Fred's slots are closed and few.
- **State that changes:** recent memory work (LifeFuse-Mem 2026) names the
  failure we saw: a temporary state overwriting or outliving the real one.
  Conditions need a lifecycle (active, resolved), not just "said once".
- **Prefix (KV) caching:** llama.cpp skips re-reading a prompt prefix it has
  already read; repeated system prompts and earlier turns cost nothing the
  second time. Fred's intent prompt (~300 tokens) and understanding prompt
  (~480 tokens) are fixed text read from scratch on every message. Whether
  llama.rn in the app keeps the cache between our different prompts needs a
  measurement on the phone (one context, prompts alternate).
- **Intent from the embedding we already have:** a small classifier on the
  EmbeddingGemma vector beats prompting a 1-4B model and costs milliseconds
  (BTZSC 2026; SetFit). It needs labelled messages; we have 64 labelled
  intent messages and several hundred eval turns with expectations.

## The design

### 1. A conversation record instead of a message window (memory)

Extend the conditions record (`conditions.ts`) into one small, typed record
for the conversation, updated by fixed rules after every message and passed
to every step as data:

- **Who:** the people mentioned ("my dad", "my wife", "i") and which
  condition belongs to whom. Fixes a second person's sprain after a friend's
  snakebite (#100).
- **What, with a lifecycle:** each condition is active or resolved.
  Resolution phrases ("he's fine now", "the rangers carried him out", "it
  left", "found the trail") close it. A resolved condition no longer blocks
  cards or steers searches.
- **Where:** setting slots read from the hiker's words: altitude ("9000 ft"),
  heat ("over 100 degrees", desert), cold and wet, dark, lost, near water,
  bear country. Added to the search for symptom messages ("throwing up" at
  9,000 ft searches with altitude), and to the danger signs where they are
  hazards (lightning, ledge, rising water; #100).
- **What Fred said:** the card or topic of the last answer. A follow-up with
  nothing of its own ("what do i do", "its swelling pretty bad") stays on it
  unless it names something new (fixes the anaphylaxis → stings fallback,
  #100, and most of the watch-reply misses).
- **No time limit on the record, a limit on the window:** facts stay for the
  conversation (a diabetic dad mentioned 20 messages ago), while the search
  still reads only the current thread.

All rules, reviewable, no model call. The model keeps one job: restating a
messy thread for search when the record and the search disagree.

### 2. Responsiveness: answer the update, not just the question

- A symptom update in an active topic ("it's getting bigger", "now he's
  wheezing", "bubbles came up on the skin") answers from that topic's card, or
  from the card the new symptom names when it is a different one (the
  anaphylaxis card for wheezing after a sting).
- A statement that sets the record ("we're at 9000 ft") gets a short
  acknowledgement that shows Fred kept it, instead of the generic "Got it".

### 3. Speed

In order of expected gain, each measured on the phone before the next:

1. **Read fixed prompts once.** Keep the intent and understanding prompts'
   prefixes cached (llama.rn session or prompt-prefix reuse); target the intent
   check from 2.4 s to well under 1 s.
2. **Skip the intent model call when the record already decides it**, then
   (if data allows) a classifier on the EmbeddingGemma vector with the model as
   the fallback when unsure. Labelled messages first: the eval sets' turns.
3. **Shorter answer prompts:** fewer, shorter passages for model-written
   answers, and the record as one line instead of earlier messages. Target the
   first words of a model-written answer from 15 s towards the ~5-8 s of a
   short prompt.
4. **Embed less:** the record decides most follow-ups, so the thread and
   request searches run less often.

### 4. Accuracy across a long conversation

- The record is the safety net for drift: blocks and danger signs read it,
  not the last three messages.
- Resolution is conservative: a condition resolved by the hiker's own words
  only, never inferred.
- Every new rule gets a unit test from a real phrasing.

## The test, written first

- **Long chats (sealed):** `tools/eval/data/holdout-long.json`, about 12
  chats of 15-30 messages each, committed before any code. Each mixes topics,
  people and settings, and plants facts early that matter late ("my dad is
  diabetic" at message 2, "he's shaky and confused" at 18; "we're at 9000 ft"
  then vomiting 10 messages on), knowledge updates ("ok the bleeding stopped"),
  resolution ("he's fine now", then a new injury to someone else), and traps
  (an out-of-scope question in the middle, a pet). Every turn has an expected
  outcome and the chat an unsafe list; graded per turn, worst turn per chat,
  and also as answers-when-it-should across all turns.
- **Seen long chats** for development, written separately.
- **Phone:** three long sessions (20+ messages) typed as a hiker types,
  timing per turn: time to first words for every reply, not only the decision.
- Every existing set re-run, with and without a state.

## Ships only if

1. Answers-when-it-should rises on the long chats and does not fall on any
   other set.
2. No new unsafe answer; out-of-scope answers do not rise.
3. Later turns are as accurate as early ones on the long chats (no drop from
   turns 1-5 to 15+).
4. On the phone: the median time to first words falls for model-written
   answers and does not rise for anything else.

## Order

1. Long-chat set written and committed; seen long chats; baseline on the
   desktop and the phone (per-turn time to first words).
2. Phone measurement of prompt-prefix caching (no Fred changes yet: does
   llama.rn reuse the cache across our alternating prompts?).
3. The conversation record (who, what with lifecycle, where, what Fred said);
   unit tests; measure.
4. Updates answered from the topic's card; acknowledgement of facts; measure.
5. Speed items 1-4, one at a time, each timed on the phone.
6. Everything re-run; results in `results-conversation-memory.md` and
   `METRICS.md`.

## Sources

- [LongMemEval (ICLR 2025)](https://github.com/xiaowu0162/longmemeval) and [paper](https://arxiv.org/pdf/2410.10813)
- [LifeFuse-Mem: lifecycle-aware state fusion (2026)](https://arxiv.org/pdf/2609.12436)
- [Dialogue state tracking: rule-based vs generative](https://www.usefini.com/glossary/what-is-dialogue-state-tracking-dst); [Towards LLM-driven DST (EMNLP 2023)](https://aclanthology.org/2023.emnlp-main.48.pdf)
- [llama.cpp: caching the system prompt](https://github.com/ggml-org/llama.cpp/discussions/8947); [KV reuse across requests](https://github.com/ggml-org/llama.cpp/discussions/8860); [KV cache reuse tutorial](https://github.com/ggml-org/llama.cpp/discussions/13606)
- `research-conversation-safety.md` for the rest (multi-turn degradation, intent classifiers, triage).
