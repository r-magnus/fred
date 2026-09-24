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

# One encoder for all packs, or the app will refuse to load.
ENCODERS=$(for p in "${PACKS[@]}"; do python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['embedding']['modelId'])" "$SRC/$p/manifest.json"; done | sort -u)
[ "$(echo "$ENCODERS" | wc -l)" -eq 1 ] || { echo "packs use different encoders: $ENCODERS" >&2; exit 1; }
case "$ENCODERS" in
  Supabase/gte-small) ENC_FILES=(gte-small.onnx gte-small-vocab.txt) ;;
  google/embeddinggemma-300m) ENC_FILES=(embeddinggemma-300M-Q8_0.gguf) ;;
  *) echo "no on-device encoder for $ENCODERS" >&2; exit 1 ;;
esac
echo "encoder: $ENCODERS"

# push_verified <local> <remote>: chunked, size-checked, checksum-verified.
push_verified() {
  local local_file=$1 remote=$2
  local want_sum; want_sum=$(sha256sum "$local_file" | cut -d' ' -f1)
  local have_sum; have_sum=$("$ADB" shell "sha256sum $remote 2>/dev/null | cut -d' ' -f1" | tr -d '\r')
  if [ "$have_sum" = "$want_sum" ]; then echo "  $(basename "$remote") already there"; return; fi
  local tmp; tmp=$(mktemp -d)
  split -b 45M -d -a 3 "$local_file" "$tmp/part."
  "$ADB" shell "rm -rf $remote.parts && mkdir -p $remote.parts"
  for f in "$tmp"/part.*; do
    local want; want=$(stat -c%s "$f")
    for _ in 1 2 3 4; do
      local got; got=$("$ADB" shell "stat -c%s $remote.parts/$(basename "$f") 2>/dev/null || true" | tr -d '\r')
      [ "$got" = "$want" ] && break
      timeout 60 "$ADB" push "$f" "$remote.parts/$(basename "$f")" >/dev/null 2>&1 || true
    done
  done
  "$ADB" shell "cat $remote.parts/part.* > $remote && rm -r $remote.parts"
  rm -r "$tmp"
  have_sum=$("$ADB" shell "sha256sum $remote | cut -d' ' -f1" | tr -d '\r')
  [ "$have_sum" = "$want_sum" ] || { echo "checksum mismatch for $remote" >&2; exit 1; }
  echo "  pushed $(basename "$remote")"
}

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
