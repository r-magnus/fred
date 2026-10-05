#!/usr/bin/env bash
# Ask the phone app questions from the desktop, even while the screen is locked.
#
#   tools/eval/ask-phone.sh questions.tsv      # lines: question<TAB>state (state optional)
#   ASK_AFTER=8 tools/eval/ask-phone.sh q.tsv   # ask 8 s after the app is ready, as a person typing would
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
# Stop the running app before filling its inbox: a live instance checks the
# inbox every two seconds and took the first question just before it was
# killed, so that question was never answered (2026-09-30, twice).
"$ADB" shell am force-stop $PKG
"$ADB" push "$Q" /data/local/tmp/fred-ask.txt >/dev/null
if [ -z "${ASK_AFTER:-}" ]; then
  "$ADB" shell "run-as $PKG sh -c 'touch files/devhooks && cp /data/local/tmp/fred-ask.txt files/devhooks-ask.txt'"
else
  "$ADB" shell "run-as $PKG sh -c 'touch files/devhooks && rm -f files/devhooks-ask.txt'"
fi
# The default 256 KB buffer holds seconds of this phone's lowmemorykiller
# chatter (~10 lines/s), so the answer lines scroll out before they are read.
"$ADB" logcat -G 16M
"$ADB" logcat -c
"$ADB" shell am force-stop $PKG
"$ADB" shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
# ASK_AFTER: the questions go in only once the app has been ready that long.
if [ -n "${ASK_AFTER:-}" ]; then
  ready_by=$((SECONDS + 180))
  until "$ADB" logcat -d -s ReactNativeJS | grep -q '\[fred\] engine ready'; do
    [ $SECONDS -lt $ready_by ] || { echo "app not ready after 180 s (screen off?)" >&2; exit 2; }
    sleep 1
  done
  sleep "$ASK_AFTER"
  "$ADB" shell "run-as $PKG sh -c 'cp /data/local/tmp/fred-ask.txt files/devhooks-ask.txt'"
fi
# One "[fred] answer|abstain|needs-location|chat|error" line per question.
deadline=$((SECONDS + 120 * n + 60))
while [ $SECONDS -lt $deadline ]; do
  done_n=$("$ADB" logcat -d -s ReactNativeJS | grep -cE '\[fred\] (answer|abstain|needs-location|chat|error) ' || true)
  [ "$done_n" -ge "$n" ] && break
  sleep 5
done
"$ADB" logcat -d -s ReactNativeJS | grep '\[fred\]' | sed 's/^.*ReactNativeJS: //'
