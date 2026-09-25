#!/usr/bin/env bash
# Ask the phone app questions from the desktop, even while the screen is locked.
#
#   tools/eval/ask-phone.sh questions.tsv      # lines: question<TAB>state (state optional)
#
# Turns on the app's development hook (the `devhooks` file; see App.tsx), queues
# the questions in its inbox, restarts the app, and prints the per-question log
# lines: retrieval, time to first token, total time, sources and answer text.
# Needs a debuggable build, because it writes through `adb run-as`.
set -euo pipefail
ADB="${ADB:-$HOME/toolchain/platform-tools/adb}"
PKG=dev.fred.app
Q="${1:?usage: ask-phone.sh questions.tsv}"
n=$(grep -c . "$Q")

# run-as works only on a debuggable build. A shippable build (the default since
# #30) is not, so say which build to install instead of failing obscurely.
flags=$("$ADB" shell dumpsys package $PKG)
grep -q 'DEBUGGABLE' <<<"$flags" || { echo "installed $PKG is not debuggable; install a field-test build: tools/eval/build-apk.sh --field-test && tools/eval/install-apk.sh" >&2; exit 1; }
"$ADB" push "$Q" /data/local/tmp/fred-ask.txt >/dev/null
"$ADB" shell "run-as $PKG sh -c 'touch files/devhooks && cp /data/local/tmp/fred-ask.txt files/devhooks-ask.txt'"
"$ADB" logcat -c
"$ADB" shell am force-stop $PKG
"$ADB" shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
# One "[fred] answer|abstain|needs-location" line per question.
deadline=$((SECONDS + 120 * n + 60))
while [ $SECONDS -lt $deadline ]; do
  done_n=$("$ADB" logcat -d -s ReactNativeJS | grep -cE '\[fred\] (answer|abstain|needs-location) ' || true)
  [ "$done_n" -ge "$n" ] && break
  sleep 5
done
"$ADB" logcat -d -s ReactNativeJS | grep '\[fred\]' | sed 's/^.*ReactNativeJS: //'
