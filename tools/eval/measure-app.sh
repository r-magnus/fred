#!/usr/bin/env bash
# M3 — measure the RAG pipeline inside the Android app sandbox.
#
# M0 measured llama-bench as a native binary under `adb shell`, which is NOT
# subject to Android's per-app memory ceiling. This is the measurement that
# actually tests PocketRAG §3.1's central constraint, because everything here
# runs inside the app process.
#
# Memory is read from outside with dumpsys rather than from a native module, so
# the spike needs no extra native code. The in-app APIs are only required later,
# for M4's adaptive memory manager.
#
# Usage: tools/eval/measure-app.sh [--no-install]
#
# UNVERIFIED since the 1.7B switch. The staging flow below was rewritten to match
# apps/mobile/App.tsx — multiple packs, internal storage, copied in as the app
# user — but no device has been attached since, so treat the first run as a
# debugging session rather than a measurement.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ADB="${ADB:-$HOME/toolchain/platform-tools/adb}"
PKG=dev.fred.app
APK="$ROOT/apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk"
# Every global pack, plus one state pack so the flora/fauna path is exercised.
# Add or swap states by editing this list.
PACKS=(core-firstaid-v1.0.0 core-firstaid-army-v1.1.0 core-survival-v1.1.0 state-CA-flora-fauna-v1.0.0)
MODEL=Qwen3-1.7B-Q4_K_M.gguf
# Staged through /data/local/tmp and copied in as the app user. Android 15 scoped
# storage denies the app read access to files adb places in its external dir —
# they are owned by shell — so the external path App.tsx used to use no longer
# works. See the comment at the top of apps/mobile/App.tsx.
STAGE=/data/local/tmp/fred

"$ADB" get-state >/dev/null 2>&1 || { echo "no device; re-pair wireless debugging first" >&2; exit 1; }

if [ "${1:-}" != "--no-install" ]; then
  echo "== installing =="
  "$ADB" install -r "$APK"
fi

echo "== staging model + packs =="
"$ADB" shell mkdir -p "$STAGE/packs"

for f in "$MODEL" gte-small.onnx gte-small-vocab.txt; do
  sz=$("$ADB" shell "stat -c%s $STAGE/$f 2>/dev/null || echo 0" | tr -d '\r')
  if [ "$sz" = "$(stat -c%s "$HOME/models/$f")" ]; then
    echo "  $f already staged"
  else
    echo "  pushing $f"
    "$ADB" push "$HOME/models/$f" "$STAGE/$f"
  fi
done

for pk in "${PACKS[@]}"; do
  id="${pk%-v*}"
  [ -d "$ROOT/packs/$pk" ] || { echo "missing pack: $pk — build it first" >&2; exit 1; }
  "$ADB" shell mkdir -p "$STAGE/packs/$id"
  "$ADB" push "$ROOT/packs/$pk/." "$STAGE/packs/$id/" >/dev/null
  echo "  staged $id"
done

echo "== copying in as the app user =="
"$ADB" shell run-as $PKG sh -c "mkdir -p files/packs && cp -r $STAGE/packs/. files/packs/"
for f in "$MODEL" gte-small.onnx gte-small-vocab.txt; do
  "$ADB" shell run-as $PKG cp "$STAGE/$f" "files/$f"
done
echo "  copied"

echo
echo "== launching =="
"$ADB" shell am force-stop $PKG
"$ADB" shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1

echo "  tap 'Run pipeline' on the device, then press Enter here to sample memory"
read -r _

echo
echo "== memory (dumpsys meminfo) =="
# TOTAL PSS is the number to compare against the ~2GB per-app ceiling.
"$ADB" shell dumpsys meminfo $PKG | sed -n '1,28p'

echo
echo "== app log =="
"$ADB" logcat -d -s ReactNativeJS:V RNLlama:V --tail 40 2>/dev/null | tail -25
