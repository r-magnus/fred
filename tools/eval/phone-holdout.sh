#!/usr/bin/env bash
# Ask the phone every held-out question, one app session each (no history),
# as shipped: for the A-KR3 speed figure and a check against the desktop run.
#
#   tools/eval/phone-holdout.sh [log]     # default docs/phone-holdout.log
#
# Waits for thermal status 0 before each question. Stops with "PHONE GONE" if
# the phone is unplugged; run it again and it carries on from the log.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ADB="${ADB:-$HOME/toolchain/platform-tools/adb}"; export ADB
PKG=dev.fred.app
OUT="${1:-$ROOT/docs/phone-holdout.log}"
TMP="$(mktemp -d)"
cd "$ROOT"
node -e "
import('./tools/eval/src/graded-types.ts').then(async (m) => {
  const fs = await import('node:fs');
  const qs = m.setsFor('holdout').flatMap((s) => m.loadGradedSet(s, (p) => fs.readFileSync(p, 'utf8')));
  fs.writeFileSync('$TMP/holdout.tsv', qs.map((q) => [q.id, q.question.replace(/\s+/g, ' '), q.state ?? ''].join('\t')).join('\n') + '\n');
});"
cool () {
  local by=$((SECONDS + 300)) s=
  while [ $SECONDS -lt $by ]; do
    s=$("$ADB" shell dumpsys thermalservice | grep -m1 'Thermal Status' | grep -o '[0-9]*' | head -1)
    [ "${s:-9}" = "0" ] && return 0
    sleep 10
  done
  echo "WARN thermal ${s:-?}" >> "$OUT"
}
# adb reads stdin: keep the question list on its own descriptor.
exec </dev/null
touch "$OUT"
"$ADB" get-state >/dev/null 2>&1 || { echo "no device" >&2; exit 1; }
"$ADB" shell "run-as $PKG sh -c 'touch files/devhooks; rm -f files/devhooks-no-opener'"
while IFS=$'\t' read -r id q st <&3; do
  grep -A3 "^=== $id\$" "$OUT" 2>/dev/null | grep -qE '\[fred\] (answer|abstain|chat|needs-location|error) ' && continue
  "$ADB" get-state >/dev/null 2>&1 || { echo "PHONE GONE at $id" >> "$OUT"; exit 3; }
  cool
  if [ -n "$st" ]; then printf '%s\t%s\n' "$q" "$st" > "$TMP/h.tsv"; else printf '%s\n' "$q" > "$TMP/h.tsv"; fi
  echo "=== $id" >> "$OUT"
  timeout 600 "$ROOT/tools/eval/ask-phone.sh" "$TMP/h.tsv" 2>&1 | grep -E "\[fred\] (text|answer|abstain|chat|needs-location|error) " >> "$OUT" || echo "NO RESULT LINE" >> "$OUT"
done 3< "$TMP/holdout.tsv"
echo DONE >> "$OUT"
