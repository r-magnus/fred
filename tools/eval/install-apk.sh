#!/usr/bin/env bash
# Install the release APK over a USB link that stalls on large transfers.
#
#   tools/eval/install-apk.sh [apk]
#
# `adb install` of the 150 MB APK hung for eleven minutes and installed nothing
# (2026-09-24), the same failure as large `adb push` (docs/results-phase1.md §6).
# So the APK goes up in verified 45 MB pieces, is checksummed on the phone, and
# is installed from there with `pm install`. App data (models, packs, maps)
# survives, because this is an upgrade of the same signed package.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ADB="${ADB:-$HOME/toolchain/platform-tools/adb}"
APK="${1:-$ROOT/apps/mobile/android/app/build/outputs/apk/release/app-release.apk}"
REMOTE=/data/local/tmp/fred-app.apk

"$ADB" get-state >/dev/null 2>&1 || { echo "no device" >&2; exit 1; }
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
split -b 45M -d -a 3 "$APK" "$tmp/part."
"$ADB" shell "rm -rf $REMOTE.parts && mkdir -p $REMOTE.parts"
for f in "$tmp"/part.*; do
  want=$(stat -c%s "$f")
  for _ in 1 2 3 4; do
    got=$("$ADB" shell "stat -c%s $REMOTE.parts/$(basename "$f") 2>/dev/null || true" | tr -d '\r')
    [ "$got" = "$want" ] && break
    timeout 60 "$ADB" push "$f" "$REMOTE.parts/$(basename "$f")" >/dev/null 2>&1 || true
  done
done
"$ADB" shell "cat $REMOTE.parts/part.* > $REMOTE && rm -r $REMOTE.parts"
[ "$("$ADB" shell "sha256sum $REMOTE | cut -d' ' -f1" | tr -d '\r')" = "$(sha256sum "$APK" | cut -d' ' -f1)" ] \
  || { echo "checksum mismatch after push" >&2; exit 1; }
"$ADB" shell pm install -r "$REMOTE"
"$ADB" shell dumpsys package dev.fred.app | grep -m1 lastUpdateTime
