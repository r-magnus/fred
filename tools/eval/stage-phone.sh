#!/usr/bin/env bash
# Stage Fred's packs and models onto the phone, replacing whatever is there.
#
#   tools/eval/stage-phone.sh <packs-dir> [pack ...]
#
# With no pack names, every pack in <packs-dir> is staged. Packs are replaced
# wholesale: an old pack left beside new ones fails the load, because every pack
# must share one encoder (verifyEmbedderParity) and a leftover gte-small pack
# next to EmbeddingGemma packs is exactly that mismatch.
#
# Large files go up in 45 MB pieces, each verified by size, then reassembled and
# checksummed on the phone. A single `adb push` of a large file over this USB
# link reports success while writing a fraction of it (307 MB of 3.1 GB,
# docs/results-phase1.md §6).
#
# The encoder file is chosen from the packs' manifests, matching what the app
# does at load (embedderFilesFor in apps/mobile/src/device-pack.ts).
set -euo pipefail

ADB="${ADB:-$HOME/toolchain/platform-tools/adb}"
PKG=dev.fred.app
STAGE=/data/local/tmp/fred
MODEL=Qwen3-1.7B-Q4_K_M.gguf
SRC="${1:?usage: stage-phone.sh <packs-dir> [pack ...]}"
shift
PACKS=("$@")
if [ ${#PACKS[@]} -eq 0 ]; then
  mapfile -t PACKS < <(find -L "$SRC" -mindepth 1 -maxdepth 1 -type d -exec test -f {}/manifest.json \; -printf '%f\n' | sort)
fi
[ ${#PACKS[@]} -gt 0 ] || { echo "no packs in $SRC" >&2; exit 1; }

"$ADB" get-state >/dev/null 2>&1 || { echo "no device" >&2; exit 1; }

# run-as works only on a debuggable build. A shippable build (the default since
# #30) is not, so say which build to install instead of failing obscurely.
flags=$("$ADB" shell dumpsys package $PKG)
grep -q 'DEBUGGABLE' <<<"$flags" || { echo "installed $PKG is not debuggable; install a field-test build: tools/eval/build-apk.sh --field-test && tools/eval/install-apk.sh" >&2; exit 1; }

# One encoder for all packs, or the app will refuse to load.
ENCODERS=$(for p in "${PACKS[@]}"; do python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['embedding']['modelId'])" "$SRC/$p/manifest.json"; done | sort -u)
[ "$(echo "$ENCODERS" | wc -l)" -eq 1 ] || { echo "packs use different encoders: $ENCODERS" >&2; exit 1; }
case "$ENCODERS" in
  Supabase/gte-small) ENC_FILES=(gte-small.onnx gte-small-vocab.txt) ;;
  google/embeddinggemma-300m) ENC_FILES=(embeddinggemma-300M-Q8_0.gguf) ;;
  *) echo "no on-device encoder for $ENCODERS" >&2; exit 1 ;;
esac
echo "encoder: $ENCODERS"

# push_verified comes from adb-lib.sh, shared with stage-bundle.sh.
source "$(dirname "${BASH_SOURCE[0]}")/adb-lib.sh"

echo "== models =="
"$ADB" shell mkdir -p "$STAGE"
for f in "$MODEL" "${ENC_FILES[@]}"; do push_verified "$HOME/models/$f" "$STAGE/$f"; done

echo "== packs =="
"$ADB" shell "rm -rf $STAGE/packs && mkdir -p $STAGE/packs"
for p in "${PACKS[@]}"; do
  id=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['id'])" "$SRC/$p/manifest.json")
  "$ADB" shell mkdir -p "$STAGE/packs/$id"
  for f in "$SRC/$p"/*; do push_verified "$f" "$STAGE/packs/$id/$(basename "$f")" >/dev/null; done
  echo "  staged $id"
done

echo "== copying in as the app user =="
# adb shell joins its arguments with spaces, so the whole remote command is one
# quoted string; passed as separate words, sh -c receives only "rm".
"$ADB" shell "run-as $PKG sh -c 'rm -rf files/packs && mkdir -p files/packs && cp -r $STAGE/packs/. files/packs/'"
for f in "$MODEL" "${ENC_FILES[@]}"; do
  "$ADB" shell "run-as $PKG sh -c 'cmp -s $STAGE/$f files/$f || cp $STAGE/$f files/$f'"
done
"$ADB" shell run-as $PKG ls files/packs
echo "done"
