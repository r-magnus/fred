#!/usr/bin/env bash
# On-device inference baseline (M0).
#
# Runs llama-bench as a native arm64 binary under `adb shell`. This deliberately
# avoids React Native, Expo, Gradle and APK signing so that a failure here means
# "this hardware cannot run this model fast enough" and nothing else.
#
# IMPORTANT: a native binary under adb shell is NOT subject to Android's per-app
# memory ceiling. These numbers are honest for SPEED and THERMAL behaviour, but
# they do not validate the ~2GB app-sandbox budget of PocketRAG §3.1. That still
# requires the APK.
#
# Usage: tools/eval/bench-device.sh <model.gguf> [prompt_tokens] [gen_tokens]
set -euo pipefail

ADB="${ADB:-$HOME/toolchain/platform-tools/adb}"
BENCH="${BENCH:-$HOME/toolchain/llama.cpp/build-android/bin/llama-bench}"
COMPLETION="${COMPLETION:-$HOME/toolchain/llama.cpp/build-android/bin/llama-completion}"
MODEL="${1:-$HOME/models/Qwen3-0.6B-Q4_K_M.gguf}"
PP="${2:-512}"   # prompt tokens — drives the TTFT estimate
TG="${3:-128}"   # tokens to generate
REMOTE=/data/local/tmp/fred

[ -f "$BENCH" ] || { echo "missing $BENCH — build it first" >&2; exit 1; }
[ -f "$MODEL" ] || { echo "missing $MODEL" >&2; exit 1; }

echo "== device =="
"$ADB" shell getprop ro.product.model
"$ADB" shell getprop ro.build.version.release
"$ADB" shell getprop ro.soc.model || true

echo
echo "== cpu topology (measured, not assumed) =="
# Max frequency per core identifies the big/little split on this specific SoC.
"$ADB" shell 'for c in /sys/devices/system/cpu/cpu[0-9]*; do
  n=${c##*/}
  f=$(cat $c/cpufreq/cpuinfo_max_freq 2>/dev/null || echo "?")
  echo "$n max_khz=$f"
done'

# The slowest-frequency cores approximate a mid-range SoC, giving a performance
# floor from the same handset. Without this, a flagship-only result overstates
# what most users will see — the weakness PocketRAG lists in its own §5.4.
# Parsed on the host: remote shell quoting is fragile and this is pure arithmetic.
TOPO=$("$ADB" shell 'for c in /sys/devices/system/cpu/cpu[0-9]*; do
  n=${c##*/}
  f=$(cat $c/cpufreq/cpuinfo_max_freq 2>/dev/null || echo 0)
  echo "${n#cpu} $f"
done' | tr -d '\r')

read -r LITTLE_MASK LITTLE_LIST LITTLE_MHZ <<<"$(printf '%s\n' "$TOPO" | awk '
  $2 > 0 { f[$1] = $2; if (min == "" || $2 < min) min = $2 }
  END {
    mask = 0; list = ""; n = 0
    for (i = 0; i < 64; i++) if (i in f && f[i] == min) {
      mask += 2 ^ i; list = (list == "" ? i : list "," i); n++
    }
    printf "%x %s %d", mask, list, min / 1000
  }')"

echo "little cores: cpu[$LITTLE_LIST] @ ${LITTLE_MHZ}MHz  (taskset mask 0x$LITTLE_MASK)"

echo
echo "== pushing =="
"$ADB" shell mkdir -p $REMOTE
"$ADB" push "$BENCH" $REMOTE/llama-bench >/dev/null
"$ADB" shell chmod 755 $REMOTE/llama-bench
if [ -f "$COMPLETION" ]; then
  "$ADB" push "$COMPLETION" $REMOTE/llama-completion >/dev/null
  "$ADB" shell chmod 755 $REMOTE/llama-completion
fi
LOCAL_SZ=$(stat -c%s "$MODEL")
REMOTE_SZ=$("$ADB" shell "stat -c%s $REMOTE/model.gguf 2>/dev/null || echo 0" | tr -d '\r')
if [ "$LOCAL_SZ" = "$REMOTE_SZ" ]; then
  echo "model already on device ($REMOTE_SZ bytes) — skipping push"
else
  "$ADB" push "$MODEL" $REMOTE/model.gguf >/dev/null
  echo "pushed $(basename "$MODEL")"
fi

thermal () {
  "$ADB" shell 'for z in /sys/class/thermal/thermal_zone*; do
    t=$(cat $z/temp 2>/dev/null || continue); ty=$(cat $z/type 2>/dev/null)
    case "$ty" in *cpu*|*soc*|*skin*) echo "  $ty=$((t/1000))C";; esac
  done' 2>/dev/null | sort -u | head -8
}

echo
echo "== thermal before =="; thermal

echo
echo "== full speed (all cores) =="
"$ADB" shell "cd $REMOTE && ./llama-bench -m model.gguf -p $PP -n $TG -r 3"

echo
NLITTLE=$(echo "$LITTLE_LIST" | tr ',' '\n' | wc -l)
echo "== little cores only: cpu[$LITTLE_LIST] @ ${LITTLE_MHZ}MHz — mid-range proxy =="
"$ADB" shell "cd $REMOTE && taskset $LITTLE_MASK ./llama-bench -m model.gguf -p $PP -n $TG -t $NLITTLE -r 3" \
  || echo "(taskset unavailable on this device; skipped)"

# Confirm on ARM the 3.1x thinking-mode penalty measured on desktop. Expected to
# matter MORE here: the phone generates far fewer tokens per second, so invisible
# reasoning tokens cost proportionally more wall-clock before the user sees text.
if "$ADB" shell "[ -x $REMOTE/llama-completion ]" 2>/dev/null; then
  for mode in "" " /no_think"; do
    label=$([ -z "$mode" ] && echo "thinking (default)" || echo "/no_think")
    echo
    echo "== generation: $label =="
    "$ADB" shell "cd $REMOTE && ./llama-completion -m model.gguf -n 200 -t 4 --no-warmup \
      -p 'In three short numbered steps, how do you control severe external bleeding?$mode' 2>&1 \
      | grep -E 'load time|prompt eval time|eval time|total time' " || true
  done
fi

echo
echo "== thermal after =="; thermal

echo
echo "TTFT estimate = prompt_tokens / pp_throughput. At $PP tokens, divide $PP by the pp t/s above."
