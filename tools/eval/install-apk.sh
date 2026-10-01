#!/usr/bin/env bash
# Install the release APK over a USB link that stalls on large transfers.
#
#   tools/eval/install-apk.sh [apk]
#
# `adb install` of the 150 MB APK hung for eleven minutes and installed nothing
# (2026-09-24), the same failure as large `adb push` (docs/results-phase1.md §6).
# So the APK goes up in checksummed 45 MB pieces (push_verified), and is
# installed from there with `pm install`. App data (models, packs, maps)
# survives, because this is an upgrade of the same signed package.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ADB="${ADB:-$HOME/toolchain/platform-tools/adb}"
APK="${1:-$ROOT/apps/mobile/android/app/build/outputs/apk/release/app-release.apk}"
REMOTE=/data/local/tmp/fred-app.apk

"$ADB" get-state >/dev/null 2>&1 || { echo "no device" >&2; exit 1; }
# push_verified comes from adb-lib.sh, shared with the staging scripts.
source "$(dirname "${BASH_SOURCE[0]}")/adb-lib.sh"
push_verified "$APK" "$REMOTE"
"$ADB" shell pm install -r "$REMOTE"
"$ADB" shell dumpsys package dev.fred.app | grep -m1 lastUpdateTime
