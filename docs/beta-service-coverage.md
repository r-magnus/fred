# Beta spike — where does the service-coverage data come from?

The proposal commits to B-KR3 on 11/16: *"Fred can provide suggestions on where to go
to find service… a map with the estimated location zone alongside a shaded 'possible
service' region, within ~1 km of accuracy."* It never says where that coverage data
comes from, and R-03 lists the whole map subsystem as a risk without naming one.

This note answers the data question and sizes the work. No code yet.

## The source: FCC Broadband Data Collection

The FCC's National Broadband Map publishes **mobile** coverage — not just fixed
broadband — from carrier filings under the Broadband Data Collection.

| | |
|---|---|
| Formats | ESRI Shapefile and GeoPackage |
| Representation | H3 spatial index at **resolution 9**, plus raw propagation-modelled polygons |
| Granularity | A res-9 hexagon averages ~0.11 km² |
| Scope | Per provider, per area, or nationwide |
| Licence | US Government work — public domain, like FEIS and the ATP manuals |
| Cadence | Refreshed with each BDC filing round |

Licensing is the easy part: this lands in the same public-domain bucket as the
existing corpora, so it raises none of the questions the WHO BEC NonCommercial
problem does.

## The resolution is the whole feasibility argument

Res 9 at 0.11 km² is roughly **ten times finer than B-KR3 needs**. Nationwide res-9
coverage is on the order of tens of millions of cells, which is not something a phone
should hold. But the target is ±1 km, and H3 aggregates cleanly by truncating a cell
index to a parent resolution:

| H3 res | Avg cell area | Edge | Cells for California (~424,000 km²) | Cells nationwide (~9.15M km²) |
|---:|---:|---:|---:|---:|
| 9 | 0.11 km² | ~174 m | ~3.9 M | ~83 M |
| 8 | 0.74 km² | ~461 m | ~575 K | ~12 M |
| **7** | **5.16 km²** | **~1.2 km** | **~82 K** | **~1.8 M** |
| 6 | 36.1 km² | ~3.2 km | ~12 K | ~253 K |

**Resolution 7 matches the requirement almost exactly** — a ~1.2 km edge against a
±1 km target — and costs 49× fewer cells than the source data. At one byte per cell
holding a carrier bitmask, California is well under 100 KB and the whole country is
under 2 MB.

That fits the existing per-state download model from R-02 without materially changing
the storage story: a coverage layer is noise next to a ~9 MB flora/fauna pack. Res 8
is also affordable per state if ±500 m turns out to be wanted.

## "Where do I go for signal" is a graph walk, not routing

H3's value here is not storage, it is that neighbour traversal is a primitive.
Given the user's estimated cell:

1. Truncate the estimated position to its res-7 cell.
2. If that cell has coverage, say so.
3. Otherwise walk outward with `gridDisk(origin, k)` for increasing `k` until a
   covered cell appears.
4. Report bearing and distance to the nearest covered cell, and shade the covered
   cells in the ring for the map.

Each ring step is ~1.2 km, so `k` is directly a distance estimate. This needs no
routing engine, no road network and no network access — which is the entire point of
the product. It is a breadth-first search over a few thousand integers.

**Library: `h3-js` 4.5.0 — pure JavaScript, zero dependencies, ~7.7 MB unpacked.**
That matters more than it looks. The ONNX runtime cost this project several days over
an autolinking bug that no published release had fixed (`docs/results-m3.md`); a
dependency with no native linking step cannot repeat that failure.

## The honest risk, which is not the data

The data exists, it is free, it is public domain, and it fits on the phone. The risk
is that **±1 km on the map is not ±1 km in reality.**

FCC mobile coverage is *carrier-reported propagation modelling*, not measurement. The
FCC runs a formal challenge process precisely because filings are optimistic, and
modelled propagation is least reliable in exactly the terrain Fred is for: canyons,
valleys and deep timber, where a ridge between handset and tower does not appear in a
coarse model. A hiker standing in a slot canyon inside a "covered" hexagon has no
signal, and Fred would have told them they did.

This is a grading risk on B-KR3's ±1 km rubric and a trust risk on the product. Two
mitigations worth considering early:

- **Say what the claim is.** "Carriers report coverage here" is defensible and
  honest; "you will have signal here" is not, and the distinction costs nothing to
  render.
- **Prefer high ground.** Elevation gain is the single most reliable heuristic for
  regaining signal, and it is independent of the FCC data being right. If a DEM is
  already being carried for the map, "walk uphill toward the nearest reported
  coverage" is a better instruction than either signal alone.

## What this does not answer

**B-KR2 — the offline location estimate — is a separate problem.** Coverage data
tells you where signal is; it does not tell you where *you* are with no signal. That
is last-known GPS fix plus elapsed time, and its error grows with how long the user
has been walking. B-KR1 (in-service, ±10 m) is ordinary `expo-location`; B-KR2 is the
one that needs thought, and it is due 11/10, before B-KR3.

## Suggested next steps

1. Download one state's mobile coverage, aggregate to res 7, and measure the real
   byte count against the estimate above. Half a day, and it retires the storage
   question outright.
2. Decide the honest wording of the coverage claim before building the map view.
3. Treat B-KR2 as the harder of the two and start it first, despite B-KR3 being the
   more visible feature.

## Sources

- [FCC Broadband Data Collection](https://www.fcc.gov/BroadbandData)
- [FCC National Broadband Map — Data Download](https://broadbandmap.fcc.gov/data-download)
- [BDC data download specifications](https://www.fcc.gov/sites/default/files/bdc-data-downloads-output.pdf)
- [How to download mobile broadband coverage data](https://help.bdc.fcc.gov/hc/en-us/articles/43909220634651-How-to-Download-Mobile-Broadband-Coverage-Data-from-the-FCC-s-National-Broadband-Map-Step-by-Step-Instructions)
- [5G Fund FNPRM — res-9 hexagon methodology](https://www.fcc.gov/5g-fund-fnprm)
