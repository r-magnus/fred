# B-KR2 / B-KR3 — what to build the map with

Desk research plus three real measurements, done 2026-09-21, before any code.
**Short version: MapLibre React Native reading a Protomaps PMTiles archive off
local storage. California at zoom 12 is 95 MB, measured, not estimated. The
deciding fact is that both map KRs are graded at ±1 km, which is far coarser
than a street navigator and keeps every number small.**

## What the KRs actually ask for

| KR | Deliverable | WiFi | Grade A | Due |
|---|---|---|---|---|
| B-KR2 | A map with an estimated location zone | off | ±1 km | 2026-11-10 |
| B-KR3 | The same map plus a shaded "possible service" region | off | ±1 km | 2026-11-16 |

Both are verified by driving, so both consume the same trip. Neither asks for
routing, turn-by-turn, trails or building footprints. The map is a backdrop for
two shapes: where you probably are, and where signal probably is.

**This is the whole reason the sizes below are manageable.** Zoom 12 renders
about 38 m per pixel, so a 1 km uncertainty circle is roughly 26 pixels across
with room for context around it. Every zoom level past that doubles the file for
detail the grading rubric cannot see.

## The library

`@maplibre/maplibre-react-native` **11.4.0**, published 2026-09-19.

| | Requires | Fred has |
|---|---|---|
| React Native | >= 0.80.0 | 0.86.3 |
| Expo | >= 54.0.0 | 57.0.20 |

That release upgraded MapLibre Native to **13.6.1** on Android and 6.31.0 on
iOS. PMTiles sources landed in MapLibre Android **11.7.0**, so the bundled
engine is well past it.

It is open source, needs no account, and makes no network call of its own —
which is the point, for an app whose premise is that the network is gone.

**Rejected:**

- **Mapbox RN** — per-tile pricing and an account requirement. Wrong shape for
  an app that ships its maps in the APK.
- **react-native-maps / expo-maps** — wrappers over Google Maps and Apple Maps.
  Both are built around live tiles; offline behaviour is limited and controlled
  by the platform rather than by us.

## The data format

Two single-file container formats are supported natively, both read straight
from device storage with no server:

- **PMTiles** — `pmtiles://file:///path/to.pmtiles`. De-duplicates tiles
  internally, so it is materially smaller.
- **MBTiles** — `mbtiles://file://...`. Older, SQLite-backed, supported on both
  platforms for years. This is what ATAK uses.

PMTiles first, MBTiles as the fallback. There is no dead end either way.

One property worth recording so nobody trips on it later: **PMTiles sources do
not participate in MapLibre's offline-pack download and caching machinery.**
That machinery exists to fetch tiles from a server for later offline use, which
is not our situation — we ship the archive. Irrelevant here, confusing if met
cold.

## Sizes, measured

From the Protomaps daily planet build `20260920.pmtiles` (120 GB, zoom 0-15,
ODbL), using `pmtiles extract`, which pulls a region over HTTP range requests
without downloading the planet.

| Region | Max zoom | Size |
|---|---:|---:|
| California | 12 | **95 MB** |
| Lower 48 | 10 | **365 MB** |
| Lower 48 | 12 | **1832 MB** |

California took 3.7 s and transferred 104 MB for a 100 MB archive — an overfetch
of 0.05, so the range-request path is efficient enough to run per state in a
build script.

For scale: the phone has 169 GB free on `/data`, and Fred currently carries
about 1.7 GB of models and packs.

## It fits the architecture we already have

Fred already ships per-state content — `state-CA-flora-fauna`,
`state-OR-flora-fauna` — selected by the offline state lookup in
`packages/geo`. A per-state map pack needs no new concept, and the same
`stateForCoords` call that picks a flora pack picks a map pack.

California at 95 MB is one of the largest states. Most are smaller.

The alternative, one national archive at zoom 10 for 365 MB, is also viable and
simpler to build. It is worth a decision rather than a default: per-state costs
a build loop and gives better detail, national costs 365 MB once and never has
to handle a state boundary crossing mid-drive.

## B-KR3's overlay

FCC BDC publishes coverage on the H3 hexagon grid; the national map exposes
resolutions 5 through 9. `docs/METRICS.md` records res 7 at ~310 MB as the
identified source.

H3 res 7 averages ~5.16 km per hexagon with an edge around 1.22 km, which sits
naturally against a ±1 km grading target. The overlay is a second vector layer
on the same map, not a second technology.

## What shipping products do

| Product | Approach |
|---|---|
| OsmAnd, Organic Maps | OSM vector data, fully offline, open source |
| Gaia GPS, CalTopo | USGS topo raster layered with OSM |
| ATAK (military / SAR) | MBTiles, DTED, GeoTIFF dropped in `/sdcard/atak/maps/` |

The common pattern across all of them is **OSM-derived vector tiles in a
single-file container, rendered on the device**. That is the design being
proposed here, and it is worth noting that the field-proven tools converged on
it independently.

## Risks

1. **This needs a native rebuild and a config plugin.** Not an npm install.
   Fred already builds custom native modules for llama.rn, op-sqlite and
   onnxruntime, so the pipeline exists — but `apps/mobile/AGENTS.md` says to
   read the Expo v57 docs before writing app code, and that applies here.
2. ~~**The RN wrapper's PMTiles path is newer than the native engine's.**~~
   **Resolved 2026-09-21 on the device.** `@maplibre/maplibre-react-native`
   11.4.0 built alongside llama.rn, op-sqlite and onnxruntime without
   incident, and `pmtiles://file://` read the 95 MB California archive from
   the app's documents directory and drew terrain, water and roads at
   Yosemite **in airplane mode**. The MBTiles fallback is not needed.
   `apps/mobile/src/map-probe.tsx` is the throwaway that proved it.
3. **ODbL attribution.** OpenStreetMap must be credited on screen.

## The test that was run

Built the app with the map library, pointed it at the 95 MB California archive,
and opened it with the radios off. It drew. That settles risks 1 and 2 together:
the library links into Fred's native setup, and PMTiles reads from local storage
through the React Native wrapper.

**So the decisions in this document are now measured rather than proposed.**
MapLibre React Native, PMTiles, per-region archives built with `pmtiles
extract`. The remaining open choice is per-state packs against one national
archive, which is a packaging question, not a technical one.

What the probe deliberately did not do: no B-KR2 zone, no B-KR3 overlay, no
styling beyond three layers, and the archive was staged by hand with `adb push`
rather than shipped. A minimal hand-written style was used instead of
`@protomaps/basemaps` to keep a second dependency out of a throwaway; the real
map should use the proper style.

The next thing is the B-KR2 screen itself, and it starts from a settled base.
