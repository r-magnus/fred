# Handoff — 2026-09-25

Supersedes the 2026-09-22 note and the items added to it earlier today.
Everything measured is in `docs/`; this is the state of play and what to do next.

## The short version

Alpha accuracy moved again after a stall: **66.3% held out** (from 62.5%), with
**one** safety failure left, and PR #55 is merged. All 50 state plant-and-wildlife
packs are rebuilt for EmbeddingGemma. The map is being upgraded to the
topographic version (option B, ~1.2x): contours are built in Node, and each state
now assembles into one downloadable bundle. **Nothing new goes on the phone until
the bundles are complete**, by the owner's decision.

## A-KR2 — accuracy, due 2026-10-12

**66.3% held out (26.5/40), target 80%; 83.0% tuning; 1 safety failure.**
`docs/results-phase3.md`, `docs/METRICS.md`.

- Clinical procedures (IV lines, needle decompression, dose tables) are marked
  provider-only at ingest and get a fixed referral.
- A clearly matching field card is shown **verbatim**, the only mode measured
  that cannot invert a card; card answers take under a second on the phone.
- The hiker's state is named in the prompt when the question points at it.
- FM 21-76 ch. 19 is the signalling source (FM 3-05.70 is distribution-restricted).
- Rejected with measurements: a second search in manual wording (let 14
  out-of-scope questions through), model-picked card steps, card-only rewriting,
  and earlier the NLI verification pass.

What is left: 6 wrongful declines and 7 partly-right answers held out, one
unsafe answer (`hff-bulrush-01`). Untried: Qwen3 thinking mode (#36).
Conversation memory (item 4 below) also bears on accuracy.

## What is owed, in order

1. **Topographic map, per-state bundles (in progress, branch `topo-map`).**
   - Done: `scripts/build-state-contours.mjs` (Node, worker threads; traces
     200/100/40 m contours from Mapterhorn elevation, `tools/ingest/src/contours.ts`).
     California: **137 MB contours** against a 641 MB basemap, **1.21x**,
     6 minutes on 15 threads (now 8 by default). Matches the Python trial tile for tile on
     Yosemite; an independent decoder reads it back.
   - Done: the style draws land cover on every map, fills polygons only, and
     draws cliffs (`earth` lines) as a line layer. **Seen working on the
     Nothing Phone (3) 2026-09-25** with the California bundle: contours with
     heavier index lines, land cover, streams as lines with no wedges, a clean
     coastline. No cliffs were in view, so that layer is still unseen.
   - Done: California bundle installed on the phone with `stage-bundle.sh`
     (every file checksummed on the device); the unused gte-small encoder was
     deleted from the phone (133 MB).
   - Done: `scripts/build-state-bundle.mjs` assembles map + contours + coverage +
     flora pack with a `bundle.json` (sizes, SHA-256, attribution);
     `tools/eval/stage-bundle.sh` installs one. California: 791 MB.
   - **Done 2026-09-25 (16:28-19:03): all 52 bundles built** (50 states, DC,
     PR) with `scripts/build-all-bundles.sh`, in `~/fred-bundles/`: 15.7 GB in
     all, 13.3 GB basemaps + 1.9 GB contours. Largest: AK 1.27 GB, CA 791 MB,
     TX 781 MB. DC and PR have no flora pack, recorded under `missing`.
     Elevation downloads are cached in `~/fred-maps/.contours-work` (31 GB),
     safe to delete. Next: check the style on the phone in other terrain
     (e.g. AK, CO), then stage.
   - **Coverage is missing from every bundle except as a gap in `missing`.** The
     FCC files were downloaded by hand; the California `.bin` exists only on the
     phone. Automating the FCC download is its own task.
2. **Downloads.** Bundles are the unit; the recommendation is a signed catalog
   on a static host (Cloudflare R2 or GitHub Releases), with the 1.4 GB of models
   fetched on first run. Not built.
3. **Trim the app.** Done for now: the APK is arm64-only (148 MB) and the
   phone no longer carries the unused gte-small encoder.
4. **Conversation memory.** Researched, no code: `docs/results-memory-research.md`.
   Build the three multi-turn eval sets first, count refusals before and after.
5. **Parked: the drive test.** Needs a car; one trip serves B-KR1/2/3.

## Traps that already bit, so they do not bite again

- **`adb push` silently truncates large files** over this link. Use
  `tools/eval/adb-lib.sh`'s `push_verified` (45 MB chunks, checksummed), which
  `stage-phone.sh`, `stage-bundle.sh` and `install-apk.sh` do.
- **Gradle reuses a cached JS bundle.** `tools/eval/build-apk.sh` deletes it.
- **Release builds are not debuggable** (#30, fixed): `build-apk.sh` builds a
  shippable APK and checks its manifest; `--field-test` builds the debuggable one
  that `run-as` staging needs. The phone scripts refuse a shippable install.
- **llama.rn reuses an embedding context wrongly**; the app creates a fresh one
  per text (`apps/mobile/src/device-pack.ts`).
- **`pkill -f` with a pattern that also appears in the same command kills the
  shell running it.** Use PIDs.
- **A download that dies at 97% leaves a nearly complete file.**
  `build-state-contours.mjs` extracts to `.partial` and renames on success.
- **The contour build froze WSL on Alaska** (2026-09-25): each worker cached
  three full-width rows of 1 MB elevation tiles, and Alaska is 571 tiles wide at
  z12, so ~25 GB was needed on a 15 GB machine. Workers now take 8 x 64-tile
  blocks (~360 MB each), use half the cores at nice 10, and the batch runs under
  a memory cap. Alaska z12 runs at ~4.4 GB used.
- **Alaska crosses the antimeridian.** `scripts/state-bbox.mjs` clamps to -180;
  the westernmost Aleutians have no map.
- **h3-js crashes Hermes**; `scripts/patch-h3-hermes.mjs` neutralises it.
- **Expo SDK 57 deprecated `writeAsStringAsync`**; use the File/Paths API.

## Commercial use is blocked, and it is not the FCC

`docs/licensing.md`. WHO BEC and PFA are CC BY-NC-SA. Everything else in use is
public domain or open with attribution (OSM via Protomaps, Mapterhorn). Nothing
enforces `nonCommercial` in code, and nobody has measured what dropping WHO would
cost in accuracy.

## Local files, none of them in git

- `~/.config/fred/fcc.env` — FCC API username and token, mode 600.
- `~/fred-tracks/` — drive-test CSVs with real coordinates.
- `~/models/` — GGUFs and encoders, needed by the eval.
- `packs/` — the 55 current packs (EmbeddingGemma); old ones in `~/fred-packs-gte-backup`.
- `~/fred-maps/` — basemaps and contours; `~/fred-bundles/<STATE>/` — bundles.
- `~/toolchain/pmtiles/pmtiles` — go-pmtiles 1.31.2 (set `PMTILES_BIN`).

## Commands

```
npm test                                                   # 200 tests
npm run typecheck                                          # packages, tools and the app
EVAL_SET=holdout node tools/eval/src/run-graded.ts out.jsonl
node scripts/build-state-bundle.mjs CA ~/fred-bundles      # map + contours + flora
scripts/build-all-bundles.sh                               # every state, resumable
tools/eval/build-apk.sh [--field-test]
tools/eval/stage-bundle.sh ~/fred-bundles/CA
```

Ingest and measurement must not share a machine: a build at 1504% CPU once
turned a 5 s eval question into 98 s (`docs/results-m2.md`).
