# Licensing register

Every chunk carries a `licenseId` resolving to an entry here, so the app can render
correct attribution per source. **Keep this current — it is the authoritative record
for the project report.**

| id | Source | License | Commercial use |
|---|---|---|---|
| `who-bec` | WHO/ICRC *Basic Emergency Care* (2018) | CC BY-NC-SA 3.0 IGO | ❌ No |
| `who-pfa` | WHO *Psychological First Aid: Guide for Field Workers* | CC BY-NC-SA 3.0 IGO | ❌ No |
| `atp-4-02-11` | US Army ATP 4-02.11 *Casualty Response, Tactical Combat Casualty Care, and First Aid* (Mar 2026) — used in `core-firstaid-army`, civilian-applicable chapters only | Public domain (US Gov work; approved for public release, distribution unlimited) | ✅ Yes |
| `atp-3-50-21` | US Army ATP 3-50.21 *Survival* (Sept 2018) — used in `core-survival` | Public domain (US Gov work; approved for public release, distribution unlimited) | ✅ Yes |
| `fm-21-76` | US Army FM 21-76 *Survival* (June 1992) — **Chapter 19, Signaling Techniques, only**, in `core-signaling`. ATP 3-50.21 (2018) has no signalling chapter. The intermediate FM 3-05.70 (2002) was *not* used: its cover carries "Distribution authorized to U.S. Government agencies and their contractors only", so it cannot ship despite commercial reprints. FM 21-76's cover reads "Approved for public release; distribution is unlimited." | Public domain (US Gov work; approved for public release, distribution unlimited) | ✅ Yes |
| `feis` | USFS *Fire Effects Information System* Species Reviews — used in `state-CA-flora-fauna`, `state-OR-flora-fauna`; review text only (images carry third-party photo credits and are not ingested) | Public domain (US Gov work) | ✅ Yes |
| `mapterhorn` | Mapterhorn terrain tiles (planet PMTiles, Terrarium elevation) — used to build `contours-<STATE>.pmtiles` (`scripts/build-state-contours.mjs`); only derived contour lines ship, not the elevation tiles. US terrain is USGS 3DEP (1 m and 1/3 arc-second DEMs); the padded state boxes reach into Canada and Mexico, where Copernicus GLO-30 and national sources apply. Source list: `https://download.mapterhorn.com/attribution.json` | Open data. Mapterhorn attribution required on screen (carried in the contour archive's metadata, so MapLibre shows it); USGS 3DEP public domain; Copernicus GLO-30 under the Copernicus free and open licence | ✅ Yes, with attribution |
| `usda-plants` | USDA PLANTS Database | Public domain (US Gov work) | ✅ Yes |
| `usfws` | US Fish & Wildlife Service species data | Public domain (US Gov work) | ✅ Yes |
| `osm` | OpenStreetMap via Geofabrik extracts | ODbL 1.0 | ✅ With attribution + share-alike |
| `census-cb` | US Census Bureau TIGER/Line cartographic boundaries, 1:20,000,000 state outlines — used in `packages/geo` to turn a GPS fix into a state code offline, via the redistributed `us-states.json` from PublicaMundi/MappingAPI | Public domain (US Gov work) | ✅ Yes |
| `nps` | National Park Service articles on nps.gov (28 national pages: hiking and camping safety, food storage, bears, wildlife distance, lightning, the *I Didn't Know That! Leave No Trace* series) — used in `core-tips-nps` (#96) | Public domain (US Gov work; [nps.gov disclaimer](https://www.nps.gov/aboutus/disclaimer.htm)). Credit "National Park Service". Photos and captions not ingested. | ✅ Yes |
| `cdc` | US Centers for Disease Control and Prevention pages (18: ticks and Lyme disease, rabies, hantavirus, plague, mosquitoes, heat-related illness, Giardia, freshwater algal blooms, norovirus prevention) — used in `core-health` (#51). Fetched through the CDC content syndication API (tools.cdc.gov), its supported route for republishing; www.cdc.gov refuses automated requests and that is respected | Public domain (US Gov work). CDC's syndication terms ask that content be attributed and not altered in meaning; each chunk credits CDC | ✅ Yes |
| `epa` | US EPA, *Emergency Disinfection of Drinking Water*; *Harmful Algal Blooms and Cyanotoxins FAQ* (PDF); *Action Steps for Sun Safety* (1.1.0) — used in `core-health` | Public domain (US Gov work) | ✅ Yes |
| `fda` | US FDA, *Outsmarting Poison Ivy and Other Poisonous Plants*; *Tips to Stay Safe in the Sun*; *Sunscreen: How to Help Protect Your Skin from the Sun* (1.1.0) — used in `core-health` | Public domain (US Gov work) | ✅ Yes |
| `nih` | National Institutes of Health pages (NIDDK: *Diarrhea*, *Symptoms & Causes*, *Treatment*; NIAMS: *Sports Injuries*, *Diagnosis, Treatment, and Steps to Take*) — used in `core-health` 1.1.0 (#116) | Public domain (US Gov work) | ✅ Yes |
| `nws` | National Weather Service safety pages (*Heat Cramps, Exhaustion, Stroke*; *During Extremely Cold Weather*) — used in `core-health` | Public domain (US Gov work) | ✅ Yes |
| `wikivoyage:<Article>` | Wikivoyage travel topics (12 articles: Wilderness backpacking, Hiking, Camping, Wild camping, Leave-no-trace camping, Camping food, Outdoor cooking, Cold weather, Hot weather, Arid region safety, Pests, Orienteering) — used in `core-tips-wikivoyage` (#96). One licence entry per article, pinned to the revision fetched | CC BY-SA 4.0. Every use credits the article, "Wikivoyage contributors", the licence and a link. Share-alike: the pack is released under CC BY-SA 4.0. Text only. | ✅ With attribution + share-alike |

## Two constraints to act on

**1. The WHO first-aid material is NonCommercial.**
Fine for an academic capstone — the PocketRAG authors relied on the same corpus. But
it forecloses a paid App Store release without WHO permission, and ShareAlike
propagates to derived content. State this explicitly in the report rather than
discovering it at publication time. If commercial release ever matters, the
substitution target is a permissively licensed or self-authored first-aid corpus.

**2. USDA PLANTS gives you checklists, not knowledge.**
"Colorado has ~2,800 vascular plant species" is a *list*. It does not RAG — there is
nothing to retrieve and nothing to ground an answer in. Descriptive prose is what
the pipeline needs: identification, habitat, toxicity, edibility.

Use them in combination:
- **USDA PLANTS / USFWS** → the per-state *filter* (which species belong in this pack)
- **FEIS** → the *text* (~1,100 peer-reviewed Species Reviews, public domain)

FEIS coverage is the highest-risk assumption in the data plan. **Validate coverage
for your pilot states in M1, before committing to those states.** If FEIS is thin for
a chosen state, switch states rather than degrading the corpus.

*Outcome (Alpha):* the USDA PLANTS / USFWS filter was not needed. Each FEIS review
carries a structured "States and Provinces" list, which gives California 531 species
and Oregon 470. Animal coverage is the thin part: 79 and 81 species, mostly birds and
game mammals. See `docs/results-alpha.md`.

*Outcome (state coverage):* counted across all fifty states, **every state has FEIS
coverage** — median 337 species, worst Hawaii at 153 — so the "switch states" fallback
above is never needed. All fifty come to roughly 310 MB, under the ~450 MB R-02
assumed. The risk did not land where this file predicted: it landed on a *domain*
rather than a state. FEIS animal reviews are sparse everywhere (median 61 per state,
Hawaii 14), because FEIS covers wildlife only where fire ecology touches habitat.
Closing that gap needs a second wildlife source, not more states.

## State boundaries (Beta)

`packages/geo/src/us-states.ts` is generated by `scripts/build-state-boundaries.mjs`
from the Census cartographic set — 52 regions, 3,539 vertices, 63 KB. It exists
because `Location.reverseGeocodeAsync` goes through the platform Geocoder on
Android and needs a network round trip, so it would fail in exactly the situation
Fred is built for. The data is public domain and carries no attribution
requirement, but it is recorded here because the report needs the provenance.

Its resolution is the limit on state accuracy, not the GPS: a few hundred metres
along a state line, and up to ~9 km on a simplified coastline. `stateForCoords`
compensates with a bounded 15 km snap, whose measured tradeoffs are documented
at `SNAP_KM` in `packages/geo/src/index.ts`.

## FCC mobile coverage (Beta)

| id | Source | License | Commercial use |
|---|---|---|---|
| `fcc-bdc` | FCC Broadband Data Collection — mobile broadband and voice availability | Public domain (US Gov work) | ✅ Yes |

Carrier-reported propagation modelling, published as H3 resolution-9 hexagons. Public
domain, so it raises none of the questions WHO BEC's NonCommercial terms do. The
caveat is accuracy rather than licensing — see `docs/beta-service-coverage.md`.

## ODbL and maps
OpenStreetMap-derived tiles require attribution and carry share-alike obligations on
the derived database. Display the attribution in the map view, not buried in an
About screen.

## Published map bundles (2026-09-28)

The 52 state bundles (basemap, contours, coverage, plant and animal pack) are
published for the app to download at https://github.com/r-magnus/fred-maps, a
**public** repository, separate from this private one. Each source's licence
was re-checked before publishing and is recorded in that repo's `NOTICE.md`:
ODbL for the OpenStreetMap basemap (credit "© OpenStreetMap contributors",
same licence for the extracts); USGS 3DEP (public domain), Natural Resources
Canada (Open Government Licence – Canada) and Copernicus GLO-30 (free and open
licence, fixed notice for derived products) for the contours; public FCC data
for coverage (no Location Fabric data, which CostQuest licenses); USDA public
information for the FEIS text (no photos); and EmbeddingGemma vectors, in
which Google claims no rights. **No WHO material is in the bundles**, so the
NonCommercial constraint does not reach them.

## How this register relates to LICENSE.md

`LICENSE.md` (added 2026-09-22) places the project's **original** work under a
proprietary licence, and §1 carves out "third-party components expressly
identified as being subject to separate licenses".

**This file is that identification.** The carve-out only means anything if the
list exists and is current, which is why the header above says to keep it so.

Two consequences worth stating plainly, because a proprietary licence at the
root can read as covering everything in the tree:

- **The obligations in the table above are unaffected by it.** WHO BEC and WHO
  PFA remain CC BY-NC-SA, and OpenStreetMap-derived map archives remain ODbL
  with attribution and share-alike. A proprietary licence over Fred's own code
  does not and cannot relicense someone else's corpus.
- **The NonCommercial constraint therefore still stands**, and still comes from
  the WHO material rather than from anything added since. `HANDOFF.md` has the
  detail and the mitigation, which is that `core-firstaid-army` is 410 chunks of
  public-domain first aid sitting beside the WHO pack's 667.

`apps/mobile/LICENSE` is **Expo's** MIT notice, shipped by the project template
(`Copyright (c) 2015-present 650 Industries, Inc.`). It covers the scaffolding
under `apps/mobile`, not Fred, and is retained because MIT asks that the notice
travel with the code.

## Tips packs (2026-09-29, #96)

Everyday outdoor know-how, in two packs so the licences never mix
(`docs/plan-tips.md`, `tools/ingest/src/tips-pack.ts`).

**NPS and the Leave No Trace Center.** The *I Didn't Know That! Leave No Trace*
articles were "developed in collaboration with" the Leave No Trace Center for
Outdoor Ethics, and each carries the line "Leave No Trace 7 Principles © 1999
by the Leave No Trace Center for Outdoor Ethics". The Center's terms forbid
rewording the principles without its review. So the principle statements are
dropped (the section that lists them, and any line carrying the copyright
notice), and what ships is NPS's own explanatory prose, which the site treats
as public domain unless marked otherwise. This is a judgement, recorded here so
it can be revisited: if the Center's contribution to the prose ever matters,
the eight series articles can be removed from the pack without touching the
other twenty.

**Wikivoyage and share-alike.** CC BY-SA 4.0 allows commercial use. Its two
conditions are attribution, carried per chunk (each chunk's `licenseId` names
its article, and the licence entry holds the revision link and credit line),
and share-alike, which reaches the Wikivoyage pack itself and nothing else, the
same way ODbL reaches only the map archives. Whether an answer Fred writes from
a passage is an adaptation is unsettled; crediting the article on every such
answer covers it either way.

**Wikivoyage is volunteer-written and unreviewed**, which is a trust question
rather than a licence one. Only prevention and how-to sections are kept:
treatment of injury and illness, dangerous animals, rescue, storm advice and
tick-borne disease are dropped at ingest, and those topics stay with the
manuals, NPS and the field cards. At answer time, tips never reach an
emergency answer, and NPS is read before Wikivoyage.
