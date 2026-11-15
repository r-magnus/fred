/**
 * How long a step takes on foot, and what the search should avoid (#223).
 *
 * Walking speed on slope is Tobler's hiking function (Tobler 1993):
 *   v = 6 · e^(−3.5 · |grade + 0.05|) km/h
 * fastest (6 km/h) on a gentle 5% descent, about 5 km/h on the flat, 3 km/h on
 * a 20% climb. Tobler's own off-path figure is 0.6 of that, and the land-cover
 * factors below follow the same idea as the published off-path work
 * (Irmischer & Clarke 2018; Campbell et al. 2019, 2024): one multiplier per
 * broad cover class. They are starting values, to be tuned against real tracks,
 * and deliberately on the slow side: a route that says 3 h and takes 2 h is a
 * nuisance; the reverse strands someone after dark.
 *
 * Two kinds of number live here and must not be mixed:
 * - **time**, reported to the user, is the honest estimate;
 * - **weight**, used only to rank routes, adds a preference for mapped paths.
 *   Off-trail time counts 1.6×, so the search leaves a trail only when that
 *   clearly pays, never to shave a minute.
 */

import { COVER, type Cover } from './terrain.ts';
import type { WayClass } from './trails.ts';

/** Tobler's function, metres per second, for a rise/run grade. */
export function toblerSpeed(grade: number): number {
  return (6 * Math.exp(-3.5 * Math.abs(grade + 0.05))) / 3.6;
}

/** The fastest any step can be, for the search's distance estimate. */
export const MAX_SPEED = toblerSpeed(-0.05);

/** Off a mapped path, before cover (Tobler 1993). */
export const OFF_PATH_FACTOR = 0.6;

/** Speed multiplier off trail, by cover. 0 means not walkable. */
export const COVER_FACTOR: Readonly<Record<Cover, number>> = {
  [COVER.open]: 1,
  [COVER.forest]: 0.75,
  [COVER.scrub]: 0.55,
  [COVER.rock]: 0.6,
  [COVER.wetland]: 0.3,
  [COVER.sand]: 0.7,
  [COVER.glacier]: 0,
  [COVER.water]: 0,
};

/** On a mapped way, by its basemap detail. Steps are slow; the rest walk at Tobler. */
export function waySpeedFactor(detail: string): number {
  return detail === 'steps' ? 0.6 : 1;
}

/** Seconds to walk a mapped way. */
export function trailTime(meters: number, rise: number, detail: string): number {
  const grade = meters > 0 ? Math.max(-MAX_TRAIL_GRADE, Math.min(MAX_TRAIL_GRADE, rise / meters)) : 0;
  return meters / (toblerSpeed(grade) * waySpeedFactor(detail));
}

/** Total up and down along a height profile, ignoring wiggles under `noise` metres. */
export function climb(profile: readonly number[], noise = CLIMB_NOISE_M): { up: number; down: number } {
  let up = 0, down = 0;
  if (profile.length === 0) return { up, down };
  let anchor = profile[0]!;
  for (const h of profile) {
    if (h - anchor >= noise) { up += h - anchor; anchor = h; }
    else if (anchor - h >= noise) { down += anchor - h; anchor = h; }
  }
  return { up, down };
}

/**
 * Steeper than this off trail and the step is refused: about 27°, past which
 * walking becomes scrambling and a slip becomes a fall. Heights come from 40 m
 * contours, so short steep pitches between them are invisible; the limit is
 * set low on purpose.
 */
export const MAX_OFF_TRAIL_GRADE = 0.5;
/** Off trail and steeper than this, the stretch carries a "steep" warning. */
export const STEEP_GRADE = 0.3;

/** Extra seconds to cross a stream off trail: finding a place, getting wet. */
export const STREAM_CROSSING_S = 120;

/**
 * On a mapped trail, grades steeper than this are taken as this when timing.
 * Heights come from a 30 m grid interpolated between 40 m contours, and where
 * a trail threads a cliff band (switchbacks under Vernal Fall) the grid puts
 * the cliff's slope on the trail. A built trail that steep is rare; a wrong
 * height there is common, and it would push the search off the trail and
 * across the cliff to "save time".
 */
export const MAX_TRAIL_GRADE = 0.35;

/** Height changes smaller than this are noise when adding up climb (GPS-watch style). */
export const CLIMB_NOISE_M = 15;

/**
 * Search weight, in seconds, for stepping off a trail onto open ground. Leaving
 * a trail is a decision with a cost the clock doesn't show — finding the way
 * back, footing, getting lost — so a short cut across a bend never pays, while
 * a long off-trail stretch that is the only way still does.
 */
export const LEAVE_TRAIL_WEIGHT_S = 600;

/** Search-only preferences (see "weight" above). */
export const OFF_TRAIL_WEIGHT = 1.6;
export const GUESSED_JOIN_WEIGHT = 1.2;
export const WAY_WEIGHT: Readonly<Record<WayClass, number>> = {
  trail: 1,
  road: 1.05,
  // Walking along a busy road is legal but unpleasant and risky; prefer a path
  // when there is one.
  'major-road': 1.3,
};
