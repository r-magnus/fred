#!/usr/bin/env bash
# Install one state's bundle (scripts/build-state-bundle.mjs) on the phone.
#
#   tools/eval/stage-bundle.sh <bundle-dir>      e.g. ~/fred-bundles/CA
#
# Every file is checked against bundle.json on the desktop before anything is
# sent, pushed with push_verified (adb-lib.sh), then copied into the app's
# Documents directory at the same relative path. The bundle's flora pack
# replaces any older version of that pack; other packs are left alone, unlike
# stage-phone.sh, which replaces the whole pack set.
#
# The installed app must be a field-test build: run-as needs it debuggable.
set -euo pipefail
ADB="${ADB:-$HOME/toolchain/platform-tools/adb}"
PKG=dev.fred.app
STAGE=/data/local/tmp/fred-bundle
DIR="${1:?usage: stage-bundle.sh <bundle-dir>}"
source "$(dirname "${BASH_SOURCE[0]}")/adb-lib.sh"

[ -f "$DIR/bundle.json" ] || { echo "no bundle.json in $DIR" >&2; exit 1; }
echo "== verifying $DIR against bundle.json"
python3 - "$DIR" <<'PY'
import hashlib, json, os, sys
d = sys.argv[1]; b = json.load(open(os.path.join(d, 'bundle.json')))
bad = []
for f in b['files']:
    p = os.path.join(d, f['path'])
    h = hashlib.sha256()
    with open(p, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''): h.update(chunk)
    if os.path.getsize(p) != f['bytes'] or h.hexdigest() != f['sha256']: bad.append(f['path'])
print(f"{b['state']}: {len(b['files'])} files, {b['bytes']/1e6:.1f} MB" + (f"  missing: {', '.join(b['missing'])}" if b['missing'] else ''))
if bad: print('MISMATCH:', bad); sys.exit(1)
PY

"$ADB" get-state >/dev/null 2>&1 || { echo "no device" >&2; exit 1; }
flags=$("$ADB" shell dumpsys package $PKG)
grep -q 'DEBUGGABLE' <<<"$flags" || { echo "installed $PKG is not debuggable; install a field-test build: tools/eval/build-apk.sh --field-test && tools/eval/install-apk.sh" >&2; exit 1; }

echo "== pushing"
"$ADB" shell "mkdir -p $STAGE"
mapfile -t FILES < <(python3 -c "import json,sys;[print(f['path']) for f in json.load(open(sys.argv[1]))['files']]" "$DIR/bundle.json")
for f in "${FILES[@]}"; do
  "$ADB" shell "mkdir -p $STAGE/$(dirname "$f")"
  push_verified "$DIR/$f" "$STAGE/$f"
done

echo "== installing as the app user"
# No flora pack in DC and PR bundles (bundle.json lists it as missing).
FLORA=$(python3 -c "import json,sys;print((json.load(open(sys.argv[1]))['components']['flora'] or {}).get('path',''))" "$DIR/bundle.json")
[ -n "$FLORA" ] && "$ADB" shell "run-as $PKG sh -c 'rm -rf files/$FLORA && mkdir -p files/$FLORA'"
for f in "${FILES[@]}"; do
  "$ADB" shell "run-as $PKG sh -c 'mkdir -p files/$(dirname "$f") && cp $STAGE/$f files/$f'"
done
"$ADB" shell "rm -rf $STAGE"
echo "done"
