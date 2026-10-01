# Shared by the phone staging scripts. Source after setting ADB.
#
# push_verified: a single `adb push` of a large file over this USB link can
# report success while writing a fraction of it (docs/results-phase1.md §6), so
# large files go up in 45 MB pieces, each checksummed and resent until it
# matches, then reassembled and checksummed on the phone. A size check per
# piece was not enough: a right-sized but damaged piece failed the whole APK
# install at the final checksum (2026-09-30).

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
    local want; want=$(sha256sum "$f" | cut -d' ' -f1)
    local ok=0
    for _ in 1 2 3 4 5; do
      local got; got=$("$ADB" shell "sha256sum $remote.parts/$(basename "$f") 2>/dev/null | cut -d' ' -f1" | tr -d '\r')
      if [ "$got" = "$want" ]; then ok=1; break; fi
      timeout 60 "$ADB" push "$f" "$remote.parts/$(basename "$f")" >/dev/null 2>&1 || true
    done
    [ $ok = 1 ] || { echo "piece $(basename "$f") of $(basename "$remote") would not copy intact" >&2; exit 1; }
  done
  "$ADB" shell "cat $remote.parts/part.* > $remote && rm -r $remote.parts"
  rm -r "$tmp"
  have_sum=$("$ADB" shell "sha256sum $remote | cut -d' ' -f1" | tr -d '\r')
  [ "$have_sum" = "$want_sum" ] || { echo "checksum mismatch for $remote" >&2; exit 1; }
  echo "  pushed $(basename "$remote")"
}
