# Offline routes to a dropped pin (#223)

2026-11-15. Research and a working engine in the same pass, because the
measurements answered the research questions faster than desk reading could.

**Recommendation: go.** The engine (`packages/geo/src/route/`, branch
`route-223`) already plans real routes on the map files Fred ships, with no
new download. What's left is the map screen (pin, route line, card) and
checks on a real phone.

## 1. Can we route on the map files we already have?

Yes. The z14 state basemaps hold every trail and road in their `roads` layer
(`kind: path` with `kind_detail` path / track / footway / bridleway / steps,
plus all road classes), with names. Measured in four places (Sawtooths ID,
Grand Canyon AZ, Yosemite CA, New River Gorge WV):

- 80–90% of line ends sit within 2 m of another line, so junctions join up.
- 2–3% stop 2–10 m short. The engine joins those and marks them "guessed".
- Lines cut at tile edges rejoin, since tiles overlap at their borders. Where the
  two halves miss by a few metres (tiles simplified differently), the
  engine rejoins the same trail within 20 m.
- Land cover (forest, scrub, bare rock, scree, wetland, glacier, sand),
  water areas, rivers, streams and cliffs are in the same file. Heights come
  from the existing contours file (40 m contours, z12).

**Size impact: none.** Nothing new is downloaded.

**Missing:** trail difficulty (`sac_scale`), surface, trail visibility, and
`access=private/no`. Planetiler dropped them when the basemap was built.

- *A side file* of those tags per state would work, but it has to match the
  basemap's lines exactly, so both must always come from the same
  OpenStreetMap snapshot. That's fragile.
- *The permanent fix* is to build our own basemap with those tags kept in
  the `roads` layer: one file, nothing to drift. `scripts/build-state-map.mjs`
  already produces these archives. The change is to the build profile, not
  the download.

## 2. Which routing options run on a phone?

| Option | Data | Fit |
|---|---|---|
| **Own A\* in JS over the map tiles** (chosen) | the files we ship | No new download, no native code, tests run under `node --test` |
| BRouter | its own segment files per region | Separate Java app, extra download, routes only on mapped ways |
| GraphHopper / Valhalla on device | own graph files, large | Heavy native builds; also routes only on mapped ways |

The packaged engines are all built for mapped ways. BRouter's hiking
profiles, for example, filter and penalise by `sac_scale`, which our files
lack. None of them does the off-trail part. ([BRouter profiles][brouter],
[openrouteservice on sac_scale][ors])

**Measured cost of ours**, Node with the JIT off (Hermes has no JIT), on the
desktop CPU:

| Route | Straight | Route | Grid cells | Time |
|---|---|---|---|---|
| Happy Isles → Half Dome | 2.7 km | 11.4 km | 27 k | 0.95 s |
| Sawtooths trailhead → off-trail spot | 5.7 km | 10.2 km | 70 k | 1.8 s |
| Grand Canyon rim → Phantom Ranch | 7.0 km | 18.6 km | 108 k | 2.8 s |

The hardest route fits in a 40 MB heap. A budget phone is maybe 2–4× slower,
so expect a few seconds with a "planning" indicator. The search gives the
screen a turn every 4096 steps, so the map doesn't freeze, and it can be
cancelled. Speed on the old-phone emulator and on Ryan's phone is still to
measure. Note: the emulator has no AVX, which hurts llama.cpp, not this.

Not tested yet: routes past ~20 km straight. The engine refuses beyond 25 km
("too far for a walking route").

## 3. Off-trail costing, and when to refuse

The engine searches one combined graph: the trail network plus a ~30 m
ground grid. That makes trails and open ground one decision, not "trail,
then a straight line". It leaves a trail only where that clearly pays, and
climbs back onto the next trail when it can.

- **Speed vs slope:** Tobler's hiking function, v = 6·e^(−3.5·|s+0.05|)
  km/h ([Tobler 1993][tobler]). The off-path factor is 0.6, as Tobler
  proposed.
- **Land cover:** one multiplier per broad cover class, the way the
  published off-path models do it ([Irmischer & Clarke 2018][ic];
  [Campbell et al. 2019][campbell19]). Values: open 1, forest 0.75, rock
  0.6, scrub 0.55, wetland 0.3, glacier/water not walkable. They're
  starting values, deliberately slow, to be tuned against real tracks.
  [STRIDE (Campbell et al. 2024)][stride] does this from lidar vegetation
  density. That's a better input than we have, but worth knowing about.
- **Barriers:** cliffs and rivers can't be crossed off trail. A trail that
  crosses one (a bridge) still can. Streams can be crossed at +2 min and a
  warning.
- **Preference for trails:** in the ranking only, never in the reported
  time, off-trail time counts 1.6× and leaving a trail costs 10 min. That
  stops "shortcuts" across switchbacks. Before this rule, the Half Dome route
  cut across the cliffs below Vernal Fall.
- **Refuse (no route):**
  - every way needs an off-trail grade over 50% (~27°)
  - the pin or start is in water with no dry ground within 100 m
  - the straight line is over 25 km

  The rim-to-river test with only cliffs between is refused, as it should be.

**Known weaknesses, in order of risk:**

1. The 40 m contours miss short cliffs and steep steps between lines. The
   grade limit is set low because of this, but a 10 m drop can still hide
   between contours. This is the main reason off-trail stretches are drawn
   as unsure.
2. Heights interpolated onto trails are noisy where trails thread cliff
   bands, so trail grade is capped at 35% when timing it.
3. Times are Tobler's, which assumes a fit walker without a heavy pack:
   Half Dome comes out at 4h17 against the usual 5–6 h. Show a range, not
   one number.
4. Private land and trail difficulty are unknown (see §1).

## 4. Safety wording

Every route is a rough guide. Proposed card text, to go through the usual
card review:

- Header: **"Rough route — check it against what you see."**
- On any unsure part: "No trail on the map here. Go slowly and turn back if
  the ground gets steep or the way is blocked."
- Always, in the details: "Maps can be out of date. This route doesn't know
  about private land, closures or trail difficulty."
- When refused: "Fred can't find a safe walking route to there." Then say
  why in one line: too steep, water, or too far.

**Not decided, and the safety call is Ryan's:** search-and-rescue advice for
someone who's lost is often to stay put. A route button on the map
shouldn't nudge a lost person into walking off-trail. One idea is that when
the chat has flagged the user as lost, the route card leads with "If people
know where you are, staying put is often safest." This touches Fred's
safety rules, so it needs Ryan before it ships.

**Fit with #77 ("how far and which way to find signal"):** the signal
direction already gives distance and bearing to the nearest likely
coverage. With routing, that point can become a pin: "Route to signal".
Same card, same warnings.

## 5. How it would look

Agreed with Ryan 2026-11-15:
- Long-press the map to drop a pin. A card offers "Route here".
- Sure stretches are drawn as the route line. Unsure stretches (off trail,
  guessed joins) are drawn in the warning colour.
- The card shows distance, a time range and the climb, plus the warnings
  that apply (steep, stream crossing, busy road, off-trail distance).
- On foot only.

The UI is built in the UX test app first (`~/code/fred-ux`).

## Build size

- Engine: done and tested on this branch (18 tests, 2 recorded real routes).
- Map screen: pin, route layer, card, cancel/replan when the pin moves.
  About 6–8 h.
- Phone checks: speed and memory on the old-phone emulator, then the look on
  Ryan's phone. About 2 h.
- Later, separate ticket: rebuild the basemaps with `sac_scale`/`access`
  kept, then use them in the cost model.

[tobler]: https://www.academia.edu/7256398/Appendix_E_Toblers_Hiking_Function_Tutorial
[ic]: https://par.nsf.gov/servlets/purl/10097294
[campbell19]: https://katalog.lib.cas.cz/KNAV/EdsRecord/edselp,S0143622818307859
[stride]: https://doaj.org/article/320e0ba8b388470eb0c132042888bfee
[brouter]: https://github.com/poutnikl/Brouter-profiles/wiki
[ors]: https://ask.openrouteservice.org/t/routing-for-hiking-paths/5521
