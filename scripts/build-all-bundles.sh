#!/bin/bash
# Build every state's bundle, one state at a time, skipping any state whose
# bundle.json already exists, so a re-run resumes where the last one stopped.
# Runs under an 8 GB memory cap: a runaway build is killed, not WSL.
#
# Usage: scripts/build-all-bundles.sh [out-root]    (default ~/fred-bundles)
# Progress: <out-root>/build-all.log; each state's output: <out-root>/log-<USPS>.txt
OUT=${1:-$HOME/fred-bundles}
cd "$(dirname "$0")/.."
export PMTILES_BIN=${PMTILES_BIN:-$HOME/toolchain/pmtiles/pmtiles}
mkdir -p "$OUT"
if [ -z "$FRED_CAPPED" ] && command -v systemd-run >/dev/null; then
  exec env FRED_CAPPED=1 systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0 "$0" "$OUT"
fi
for S in $(node -e "import('./scripts/state-bbox.mjs').then(m=>console.log(m.knownStates()))"); do
  [ -f "$OUT/$S/bundle.json" ] && continue
  echo "$(date '+%F %H:%M') $S start" | tee -a "$OUT/build-all.log"
  if nice -n 10 node scripts/build-state-bundle.mjs "$S" "$OUT" > "$OUT/log-$S.txt" 2>&1; then
    echo "$(date '+%F %H:%M') $S ok" | tee -a "$OUT/build-all.log"
  else
    echo "$(date '+%F %H:%M') $S FAILED (exit $?), see log-$S.txt" | tee -a "$OUT/build-all.log"
  fi
done
echo "$(date '+%F %H:%M') all done" | tee -a "$OUT/build-all.log"
