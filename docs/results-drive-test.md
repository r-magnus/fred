# Drive test — what the trip recorded, and what it grades

Recorded 2026-10-09 and 2026-10-11 on the Nothing Phone (3), on the drive to
the Central Coast and back. Pulled off the phone on 2026-10-11. Ticket #20.

**Short version: the location goal (B-KR1) is measured and earns an A. The
other two goals (B-KR2, B-KR3) were not tested by this trip,** because the
phone holds no map screenshots, no location questions and no signal notes
from the road. #20 stays open for those two.

## What came off the phone

Seven recordings. Three are a few seconds long, taken indoors before leaving,
and are not used. The four driving tracks:

| Track | Road | Length | Readings | Dropouts over 30 s |
|---|---|---:|---:|---|
| 10-09, 17:58 | Highway 154 over the pass | 58 km, 52 min | 274 | 24, adding up to 43 of the 52 min |
| 10-09, 20:21 | US-101 north | 91 km, 52 min | 268 | 5, adding up to 43 of the 52 min |
| 10-11, 13:21 | Highway 1 | 24 km, 22 min | 664 | **none** (longest pause 4 s) |
| 10-11, 14:59 | US-101 south | 41 km, 20 min | 613 | **none** (longest pause 4 s) |

Together: 1,819 readings over 213 km, at up to 138 km/h, between sea level
and 590 m. Every reading was placed in California, and none was flagged as a
fake ("mocked") position.

The two tracks from 10-11 are the clean samples: a reading every two seconds
from start to stop. The two from 10-09 are full of holes, but the readings
they do hold are as good as the clean ones, so they are counted below.

### Why the 10-09 tracks have holes

The recorder only runs while Fred is on screen. On 10-09 the phone recorded
for a few seconds at a time, then went quiet for one to three minutes, over
and over. Both days ran the same build (installed 10-09 at 16:45), so this
is not a fix that landed in between. It is what the track looks like when
the phone is locked, or another app is in front, and Fred is only seen now
and then. Nothing was lost that had been written: each gap is a gap, not a
corrupted file.

A recorder that keeps going with the screen off would need Android's
"foreground service" (a permanent notification that lets an app keep using
GPS in the background). Not built, and not needed for the grading here.

## B-KR1: does Fred know where you are?

Two measures, and they agree.

**What the phone claimed.** Each reading carries the phone's own estimate of
how far off it might be.

| | All four tracks | Clean tracks only |
|---|---:|---:|
| Middle (median) claimed error | 4.8 m | 3.8 m and 9.9 m |
| Readings claiming 10 m or better | 91% | 98% and 90% |
| Worst reading | 82.5 m | 16.8 m |

**What the road says.** A claimed error is the phone marking its own
homework, so each reading was also measured against the real road: the
distance from the recorded point to the nearest road line in the same
offline California map that Fred ships.

| Track | Middle distance from the road | 9 in 10 within | Worst | Within 10 m | Within 25 m |
|---|---:|---:|---:|---:|---:|
| 10-09, 17:58 | 2.3 m | 5.9 m | 14.8 m | 98% | 100% |
| 10-09, 20:21 | 2.8 m | 9.2 m | 16.0 m | 95% | 100% |
| 10-11, 13:21 | 2.1 m | 5.8 m | 19.6 m | 97% | 100% |
| 10-11, 14:59 | 1.3 m | 5.3 m | 10.7 m | 99% | 100% |

A car in its lane sits a few metres from the middle of the road, so a
typical 2 m is as close as this check can show. Not one of the 1,819
readings was more than 20 m from a road.

Two limits of this check. It measures sideways error only: a point that is
on the road but too far ahead or behind would still pass. And it takes the
nearest road of any kind, so beside a frontage road it can flatter a
reading by a few metres.

**Grade: A** ("the user's location is known, and can be displayed accurately
on-map"), up from the B held on indoor readings. This matches the
prediction in `results-bkr1-outdoor.md`, which measured 9.5 m at one spot
and said the drive would confirm it.

One part rests on reasoning, not a photo: no screenshot of Fred's map was
taken on the road. The dot on the map is drawn from these same readings
(#178), so an accurate track means an accurate dot, but nobody
photographed it.

### Airplane mode: not during these recordings

Ryan switched airplane mode on and off during the trip without noting when.
The phone keeps its own log of every switch, in two separate places (the
radio and the WiFi system), and the two agree: over the trip, airplane mode
was on once, on 10-10 from 09:25 to 09:31. No recording was running then.
During all four driving tracks the phone was in normal mode.

So the tracks say nothing about GPS without signal. What stands on that
question is still the 2026-09-21 reading in `results-bkr1-outdoor.md`
(9.5 m in airplane mode, one spot). Fred was open during the six minutes on
10-10 and its saved files were written then, so the app runs in airplane
mode; that is all those six minutes show.

One more thing the same log shows: the phone really had no service on
10-11 from about 16:07 to 16:20. That is after the last recording stopped
(15:19), so there is no position to match it to. If the place is
remembered, it is a real point to check against the coverage map.

## B-KR2: do answers fit where you are?

**Not tested.** The phone's saved chats hold one conversation, from 10-08,
before the trip. No location question was asked on the road.

## B-KR3: are the signal zones right?

**Not tested.** Two things are missing.

- No real signal readings: no screenshots or notes of signal bars, and the
  recorder does not log signal.
- The route never left the shaded zone. Run through Fred's own coverage
  lookup, all 1,819 readings land in cells marked "covered" for T-Mobile
  (69 cells across the four tracks). So even with signal notes, this route
  could only test "signal where the map says signal". It cannot test the
  harder half, "no signal where the map says none".

If Ryan remembers losing signal anywhere on these roads, most likely on the
Highway 154 pass, that is a real finding against the map: the map says the
whole pass is covered.

## What is still owed on #20

1. **B-KR2:** ask a few location questions with WiFi off, anywhere outdoors.
   This does not need a road trip.
2. **B-KR3:** a visit to somewhere the map shades as "no service" or
   "carrier gap", noting real signal bars on the way in and out.
3. **Optional:** a map screenshot at a known spot, and fifteen minutes of
   recording in airplane mode.

## How the numbers were made

The raw tracks are **not in this repo**; they hold real coordinates. They
are in `~/fred-tracks/` beside a README. Road distances were measured
against the `roads` layer of `map-CA-z14.pmtiles` at zoom 14; coverage zones
with `zoneOf` from `packages/geo/src/coverage.ts` on
`coverage-CA-voice.bin` (FCC filing of 2025-12-31).
