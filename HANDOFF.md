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

**70.0% held out (28.0/40), target 80%; 84.0/104 tuning; 0 safety failures.**
`docs/METRICS.md`. Since phase 3 (2026-09-26/27):

- WHO drug, oxygen and IV steps removed at ingest (#61); plant-database
  passages about animals eating carry a "not food for people" note in the
  prompt (last held-out safety failure gone); a location is asked for only
  when unknown; referral fires on any near-top provider-only passage.
- **Field cards, batch 3:** nine cards on wilderness first-aid syllabus topics
  (spinal, chest wound, pelvis, belly wound, altitude, seizure, low blood
  sugar, dehydration, signalling), self-reviewed per Ryan's standing rule
  (`corpora/cards/self-reviews.json`) and on the review page. Held-out: the
  pelvis card rescues a declined question (+1); the belly card answers "can I
  pack a wound in someone's belly?" without a "no" first (-0.5).
- **Known card gap, deliberately not fixed:** the belly card should say "don't
  pack a belly wound". It was found through a held-out answer, so adding it
  makes `hf-woundpack-01` a tuning question; do it with that noted.
- **Measured and rejected:** contextual retrieval (`results-contextual.md`),
  Qwen3 thinking mode (`results-thinking.md`), lay-vocabulary expansion (the
  refusals are gate misses with the right passage ranked 1-2, not vocabulary).
- **Next card batch** (same syllabus): eye injuries, river crossing, knots and
  cordage, staying healthy (hygiene, insects), heart attack and stroke.

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
   - **Coverage redesigned and built for all 52 (2026-09-26, #57, #58).** The
     map now warns instead of reassuring: amber where *your* carrier reports
     no coverage (another does, so 911 may connect), red where *no* carrier
     does (911 may fail; satellite SOS mentioned). Unshaded = assumed covered.
     `scripts/build-state-coverage.mjs` pulls every provider's FCC **mobile
     voice** file (Dec 2025 filing) via the API and writes
     `coverage-<ST>-voice.bin` (carriers kept apart, 0.2-37 KB); bundles build
     it on demand. Carrier: Android reads the SIM (expo-cellular, no
     permission), with a picker on the map; iOS has only the picker. Red is
     bounded to the state outline so sea and neighbours are never "dead".
     Carriers claim all but 3.9% of California, so red is a floor, not the
     real extent. Small networks are counted as carriers on purpose: 1.8% of
     US ground is covered only by them, nearly all real public carriers (GCI
     and Alaska co-ops). **Seen working on the phone 2026-09-26** with test
     locations (`cmd location providers set-test-provider-location`):
     Saline Valley and Evolution Basin, SIM read as T-Mobile, picker switch to
     AT&T. The map now uses a TextureView: the default GLSurfaceView drew over
     the left third of every overlay on this phone.
2. **Downloads.** Bundles are the unit; the recommendation is a signed catalog
   on a static host (Cloudflare R2 or GitHub Releases), with the 1.4 GB of models
   fetched on first run. Not built.
3. **Trim the app.** Done for now: the APK is arm64-only (148 MB) and the
   phone no longer carries the unused gte-small encoder.
4. **Conversation memory (#60): built, measured, seen on the phone.**
   Held-out two-turn conversations 46% → 81%, single questions byte for byte
   unchanged, no unsafe answers (`docs/results-memory.md`). Retrieval tries
   the previous question joined to the new one under measured rules; the model
   sees the previous *question* only. Next it enables #50 (clarifying
   questions). Saving turns (US-10, #31) is separate.
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
- `~/fred-maps/` — basemaps, contours, coverage; `~/fred-bundles/<STATE>/` — bundles.
  Caches, safe to delete: `.contours-work` (31 GB elevation), `.fcc-work` (12 GB FCC zips).
- `~/toolchain/pmtiles/pmtiles` — go-pmtiles 1.31.2 (set `PMTILES_BIN`).

## Commands

```
npm test                                                   # 215 tests
npm run typecheck                                          # packages, tools and the app
EVAL_SET=holdout node tools/eval/src/run-graded.ts out.jsonl
node scripts/build-state-coverage.mjs CA ~/fred-maps       # FCC carrier coverage
node scripts/build-state-bundle.mjs CA ~/fred-bundles      # map + contours + coverage + flora
scripts/build-all-bundles.sh                               # every state, resumable
tools/eval/build-apk.sh [--field-test]
tools/eval/stage-bundle.sh ~/fred-bundles/CA
```

Ingest and measurement must not share a machine: a build at 1504% CPU once
turned a 5 s eval question into 98 s (`docs/results-m2.md`).
