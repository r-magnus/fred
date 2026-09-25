#!/usr/bin/env bash
# Build the Android release APK, and check whether it is debuggable.
#
#   tools/eval/build-apk.sh               # shippable: must NOT be debuggable
#   tools/eval/build-apk.sh --field-test  # debuggable, for adb run-as staging,
#                                         # the devhooks inbox and drive-test data
#
# The check reads the built APK's manifest rather than trusting the Gradle
# setting, which is what #30 asks for. A shippable build that comes out
# debuggable, or a field-test build that does not, fails the script.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AAPT2="${AAPT2:-$(ls -d "$HOME"/toolchain/android-sdk/build-tools/*/aapt2 | sort -V | tail -1)}"
APK="$ROOT/apps/mobile/android/app/build/outputs/apk/release/app-release.apk"
FIELD=false
[ "${1:-}" = "--field-test" ] && FIELD=true

node "$ROOT/scripts/patch-android-fieldtest.mjs" >/dev/null
# Gradle reuses a stale JS bundle unless it is removed (docs/results-phase1.md).
rm -f "$ROOT/apps/mobile/android/app/build/generated/assets/react/release/index.android.bundle"
(cd "$ROOT/apps/mobile/android" && ./gradlew assembleRelease -q -Pfred.fieldTest=$FIELD)

# Captured first: `aapt2 ... | grep -q` under pipefail reads a match as failure,
# because grep exits early and aapt2 dies writing to the closed pipe.
manifest=$("$AAPT2" dump xmltree --file AndroidManifest.xml "$APK")
if grep -q 'android:debuggable.*=true' <<<"$manifest"; then
  debuggable=true
else
  debuggable=false
fi
if [ "$debuggable" != "$FIELD" ]; then
  echo "APK debuggable=$debuggable, expected $FIELD" >&2
  exit 1
fi
echo "built $APK (debuggable=$debuggable)"
