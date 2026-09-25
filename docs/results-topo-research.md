# Topographic map: what it costs, and whether it needs new technology

Desk research plus measurements, done 2026-09-25, before any code.
**Short version: no new technology on the phone. MapLibre already draws
hillshade from elevation tiles, and contours are ordinary vector lines. The cost
is storage: a useful topo layer adds roughly 360 MB to California's 598 MB
basemap, about 1.6x. The one new thing is a build-time tool to generate contour
tiles.**

## Why the map is flat green today

`apps/mobile/src/map-probe.tsx` draws four layers: background, `earth`, `water`
and `roads`. `earth` is one fill colour (`#1d2a22`) over every piece of land,
so a meadow, a granite dome and a valley floor look the same.

Two different things would make it read as terrain:

1. **Land cover.** Forest, meadow, bare rock, glacier, wetland. **This is
   already in the archive we ship.** Protomaps' `landuse` layer is present from
   z2 to z15. A sampled Yosemite tile at z12 contains 18 landuse polygons:
   meadow, bare_rock, grassland, wetland and forest. The style just doesn't draw
   them. Cost: **0 MB**, style change only.
2. **Relief.** Hillshading and contour lines. This needs elevation data, which
   the Protomaps basemap does not contain. It is the part that costs storage.

## The elevation source

[Mapterhorn](https://mapterhorn.com) publishes a planet-wide elevation archive
as a **single PMTiles file**, the same format and the same `pmtiles extract`
workflow that `scripts/build-state-map.mjs` already uses:

| | |
|---|---|
| URL | `https://download.mapterhorn.com/planet.pmtiles` |
| Encoding | Terrarium RGB, lossless WebP, 512 px tiles |
| Zooms | 0 to 12 |
| Licence | open data, attribution to Mapterhorn required on screen |

At California's latitude a 512 px tile is ~61 m/pixel at z10, ~30 m at z11
(the native resolution of SRTM/Copernicus) and ~15 m at z12.

## Sizes, measured

All figures are for California, using the exact padded bbox that
`build-state-map.mjs` computes, so they add directly to the basemap.

**Elevation (for hillshade).** `pmtiles extract --dry-run` against Mapterhorn:

| Max zoom | Resolution | Size |
|---:|---:|---:|
| 8 | ~245 m | 18 MB |
| 9 | ~120 m | 53 MB |
| 10 | ~61 m | **157 MB** |
| 11 | ~30 m | **451 MB** |
| 12 | ~15 m | 1.7 GB |

**Contours (vector lines).** No hosted contour tileset exists to extract from,
so this is an **estimate from a sample**. 60 random z12 tiles in the bbox were
decoded, contoured with marching squares, simplified to half a pixel, encoded as
MVT with an elevation attribute and gzipped, the same as the basemap tiles.
Scaled to the 18,104 z12 tiles in the bbox:

| Interval | Mean per tile | California z12 layer |
|---:|---:|---:|
| 10 m | 21.5 KB | ~400 MB |
| 20 m | 10.7 KB | ~200 MB |
| 40 m (≈ USGS 7.5' 40 ft) | 5.4 KB | ~100 MB |

Coarser zooms (for example 100 m at z10 and 50 m at z11) add around 10 to 15%.
From z13 up the z12 tiles are overzoomed, which MapLibre does natively. Treat
these as ±25%: 60 tiles is a small sample of a state that runs from ocean to
Mount Whitney.

## What the options cost

| Option | Adds | California total | vs today |
|---|---:|---:|---:|
| Today: flat `earth` | 0 | 598 MB | 1.0x |
| **A. Draw landuse** | 0 | 598 MB | 1.0x |
| B. A + 40 m contours | ~110 MB | ~710 MB | 1.2x |
| **C. A + z10 hillshade + 20 m contours** | ~380 MB | **~980 MB** | **1.6x** |
| D. A + z11 hillshade + 20 m contours | ~680 MB | ~1.3 GB | 2.1x |
| E. A + z12 hillshade + 10 m contours | ~2.2 GB | ~2.8 GB | 4.6x |

**Recommendation: C**, built as separate archives (`dem-CA-z10.pmtiles`,
`contours-CA.pmtiles`) next to the basemap so each can be dropped or swapped
without rebuilding the others. Hillshade doesn't need to be sharp; it is soft
shading, and a 61 m DEM overzoomed to z14 still reads as ridges and drainages.
The contours carry the precise shape. E is what Gaia or CalTopo feel like, and
it is not worth 2.2 GB for a backdrop to a ±1 km zone.

The pattern from the earlier research still holds: every zoom level of raster
roughly triples the file, so detail is paid for in the elevation layer, not the
contour layer.

## Does it need new technology?

**On the phone: no.** `@maplibre/maplibre-react-native` 11.4.0, already
installed, ships a `RasterDEMSource` component with `terrarium` encoding and a
`hillshade` layer type. Contours are a `line` layer on a vector source, which is
exactly how `roads` is drawn today. It needs no new dependency, native module
or rebuild beyond the existing one.

**At build time: one new tool.** Elevation comes out of Mapterhorn with
`pmtiles extract`, which is already used. Contours have to be generated,
because nothing hosts them as tiles. Options, in order of preference:

- **A Node script in `scripts/`** that reads the extracted DEM tiles and writes
  contour MVTs back into a PMTiles archive (`d3-contour` or similar for tracing,
  `vt-pbf` for encoding). It stays in the repo's language and matches
  `build-state-map.mjs`. This is how the sample above was measured, in Python.
- **GDAL (`gdal_contour`) + tippecanoe.** Standard and robust, but two native
  tools to install on every build machine. Neither is installed here today.

`maplibre-contour`, which generates contours on the fly from DEM tiles, is the
obvious-looking shortcut and **does not apply**: it runs in MapLibre GL JS web
workers, not in MapLibre Native.

## Risks, not yet tested

1. **`pmtiles://` for a `raster-dem` source on the device.** The earlier probe
   proved PMTiles for a vector source only. MapLibre Native handles `pmtiles://`
   at the file-source level, so it should work for any source type, but this is
   the same shape of risk the vector probe retired and it deserves the same
   ten-minute test.
2. **Hillshade cost on older phones.** Hillshade is computed on the GPU per
   tile. It is standard in MapLibre, but it is new load on a device that is also
   running an LLM.
3. **Distribution gets worse, not better.** The open question from
   `6810a80` (maps are too big to ship all fifty) grows by 1.6x. Topo should
   be part of the same per-state download, not a separate decision.
4. **Attribution.** Mapterhorn joins OpenStreetMap on screen, and its sources
   need adding to `docs/licensing.md`.

## The trial: option B on the iOS simulator

Done the same day, and **the owner's verdict was to make it part of the main
build.**

- **Area:** Yosemite, bbox `-119.95,37.55,-119.25,37.95`. That is 63 z12
  elevation tiles from Mapterhorn, stitched into one grid before contouring
  so lines stay continuous across tile edges.
- **Intervals:** 200 m at z10, 100 m at z11, 40 m at z12 (overzoomed above).
  Every 1000/500/200 m line is flagged `idx=1` and drawn heavier, like USGS
  index contours.
- **Output:** `contours-CA.pmtiles`, **1,266,539 B (1.3 MB)** for 89 tiles.
- **App:** `map-probe.tsx` adds a `landuse` fill and a `contours` line layer
  only when `contours-<STATE>.pmtiles` exists in Documents. Without the file
  the map is exactly as before.

**A second area: Santa Barbara**, bbox `-120.05,34.25,-119.35,34.65`, 54
elevation tiles. It covers the coast, the town and the Santa Ynez Mountains,
and came out at **1.0 MB**. It is merged into the same `contours-CA.pmtiles`
as Yosemite, 2,291,078 B for both. Mapterhorn has no bathymetry here (the
minimum is −2 m), and the generator skips levels at or below sea level anyway.

It exposed a bug that predates the topo work. **The probe filled Protomaps'
entire `water` layer, which also carries streams and canals as lines, and
MapLibre drew each filled line as straight-edged wedges.** Yosemite hid it;
Santa Barbara's creeks through town made it obvious. `water` is now filtered
to polygons, and a `waterways` line layer draws the streams.

**Size check against the estimate.** z12 here averages ~17 KB a tile against
the 5.4 KB statewide sample mean. That fits Yosemite being among the steepest
terrain in the state, where the sample's maximum was 28 KB, so the ~110 MB
California figure for option B stands. **It still has to be measured on a real
statewide build.**

Not yet verified: Android, and a real iPhone. The generator was a throwaway
Python script (scikit-image, shapely, mapbox-vector-tile, written to MBTiles
and converted with `pmtiles convert`). The production version should be a
Node script in `scripts/`.

## Suggested order

1. Draw `landuse` in the style. It's free and it fixes most of "flat green" on
   its own.
2. Probe: extract `dem-CA-z10.pmtiles`, push it next to the basemap, add a
   `RasterDEMSource` and a `hillshade` layer, and confirm it draws in airplane
   mode.
3. Only then write the contour build script.
