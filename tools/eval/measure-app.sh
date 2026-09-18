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
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ADB="${ADB:-$HOME/toolchain/platform-tools/adb}"
PKG=dev.fred.app
APK="$ROOT/apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk"
PACK="$ROOT/packs/core-firstaid-v1.0.0"
REMOTE="/sdcard/Android/data/$PKG/files"

"$ADB" get-state >/dev/null 2>&1 || { echo "no device; re-pair wireless debugging first" >&2; exit 1; }

if [ "${1:-}" != "--no-install" ]; then
  echo "== installing =="
  "$ADB" install -r "$APK"
fi

# The app-specific external dir is created by the installer, but only once the
# app has been launched at least on some ROMs, so make it explicitly.
"$ADB" shell mkdir -p "$REMOTE/pack"

echo "== pushing model + pack =="
for f in Qwen3-1.7B-Q4_K_M.gguf gte-small_fp16.gguf; do
  sz=$("$ADB" shell "stat -c%s $REMOTE/$f 2>/dev/null || echo 0" | tr -d '\r')
  if [ "$sz" = "$(stat -c%s "$HOME/models/$f")" ]; then
    echo "  $f already present"
  else
    "$ADB" push "$HOME/models/$f" "$REMOTE/$f"
  fi
done
"$ADB" push "$PACK/." "$REMOTE/pack/" >/dev/null
echo "  pack pushed"

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
