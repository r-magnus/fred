#!/usr/bin/env bash
# 4B answer-model research (2026-11-21). $1 = out dir; ANSWER_MODEL / ANSWER_THINKING from the caller.
cd ~/code/fred-4b; O=$1; mkdir -p $O
export PACKS_DIR=$HOME/fred-runs/258/packs INTENT=1 OPENER=1 VOICE=1 STATE=CA SCOPE=tools/eval/data/scope-model.json SAID=tools/eval/data/said-as-model.json
export ANSWER_LOG=$O/answers.jsonl
[ "$ANSWER_GPU" = 1 ] && export LD_LIBRARY_PATH=$HOME/fred-runs/4b/cuda/lib:/usr/lib/wsl/lib
for s in ${SETS:-breadth assembled}; do [ -s $O/$s.jsonl ] || EVAL_SET=$s node tools/eval/src/run-graded.ts $O/$s.jsonl > $O/$s.log 2>&1; done
for c in ${CHATS:-chats-phone chats-long-dev}; do [ -s $O/$c.jsonl ] || node tools/eval/src/run-chats.ts $O/$c.jsonl tools/eval/data/$c.json > $O/$c.log 2>&1; done
echo done $O
