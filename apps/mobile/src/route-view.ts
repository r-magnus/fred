/**
 * What the map and the route card show for a planned route (#223): the line
 * as GeoJSON, and every word the card says. Plain functions, so `node --test`
 * checks them; the components only lay them out.
 *
 * The wording follows research_notes/Offline routes §4: a route is a rough
 * guide, the parts Fred is unsure of are named and shown in the warning
 * colour, and what the map can't know (private land, closures, difficulty)
 * is said every time, not hidden behind a tap.
 */

import type { PlanFailure, Route, RouteNote, RouteStretch } from '@fred/geo/route';

// ------------------------------------------------------------------- the line

export interface RouteLineProps {
  /** Mapped path Fred is sure of, or a stretch drawn in the warning colour. */
  readonly sure: boolean;
}

export interface RouteGeoJSON {
  readonly type: 'FeatureCollection';
  readonly features: ReadonlyArray<{
    readonly type: 'Feature';
    readonly properties: RouteLineProps;
    readonly geometry: { readonly type: 'LineString'; readonly coordinates: ReadonlyArray<readonly [number, number]> };
  }>;
}

/**
 * One feature per stretch. Neighbouring stretches share their end point, so
 * the drawn line has no gaps where the colour changes.
 */
export function routeGeoJSON(route: Route): RouteGeoJSON {
  return {
    type: 'FeatureCollection',
    features: route.stretches
      .filter((s) => s.coords.length >= 2)
      .map((s) => ({ type: 'Feature', properties: { sure: s.sure }, geometry: { type: 'LineString', coordinates: s.coords } })),
  };
}

/** [west, south, east, north] around the whole route, for fitting the camera. */
export function routeBounds(route: Route): [number, number, number, number] | null {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const st of route.stretches) {
    for (const [lon, lat] of st.coords) {
      if (lon < w) w = lon; if (lon > e) e = lon;
      if (lat < s) s = lat; if (lat > n) n = lat;
    }
  }
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

// ------------------------------------------------------------------- numbers

export function distanceWords(m: number): string {
  if (m < 950) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  if (m < 9_950) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000)} km`;
}

/**
 * Tobler's speeds are a fit walker's with a light pack; on Half Dome they
 * give 4 h 17 against the 5–6 h hikers are told. So the card gives a range,
 * the estimate to half again, and never a single confident number.
 */
export const SLOW_FACTOR = 1.5;

function durationWords(s: number): string {
  const min = s / 60;
  if (min < 55) return `${Math.max(5, Math.round(min / 5) * 5)} min`;
  const halfHours = Math.round(min / 30) / 2;
  const whole = Math.floor(halfHours);
  return halfHours === whole ? `${whole} h` : `${whole === 0 ? '' : whole}½ h`;
}

export function timeWords(seconds: number): string {
  const lo = durationWords(seconds);
  const hi = durationWords(seconds * SLOW_FACTOR);
  if (lo === hi) return `about ${lo}`;
  // "25–40 min", "4½–6½ h", "45 min–1 h": the unit once when both share it.
  const [loN, loU] = lo.split(' '), [hiN, hiU] = hi.split(' ');
  return loU === hiU ? `about ${loN}–${hiN} ${hiU}` : `about ${lo}–${hi}`;
}

export function climbWords(route: Route): string | null {
  if (!route.hasElevation) return null;
  const up = Math.round(route.ascent / 10) * 10, down = Math.round(route.descent / 10) * 10;
  if (up < 20 && down < 20) return 'Mostly level';
  const parts: string[] = [];
  if (up >= 20) parts.push(`${up.toLocaleString('en-US')} m up`);
  if (down >= 20) parts.push(`${down.toLocaleString('en-US')} m down`);
  return parts.join(', ');
}

// ------------------------------------------------------------------- words

export const ROUTE_HEADLINE = 'Rough route: check it against what you see.';

/**
 * A route Fred suggests to the nearest reported signal, for someone who is
 * out of coverage (#226). Search-and-rescue advice for a lost person is often
 * to stay put, so that comes first, before any walking; Ryan approved the
 * wording 2026-11-16.
 */
export const SIGNAL_HEADLINE = 'Route to signal';
export const STAY_PUT = 'If people know where you are, staying put is often safest.';
export const SIGNAL_SOURCE = 'The signal there is what carriers report, not a promise of bars.';

export const ALWAYS_CAVEAT =
  "Maps can be out of date. This route doesn't know about private land, closures or how hard a trail is.";

const unsureMeters = (route: Route, kind: RouteStretch['kind']): number =>
  route.stretches.reduce((a, s) => a + (s.kind === kind ? s.meters : 0), 0);

const NOTE_WORDS: Partial<Record<RouteNote, string>> = {
  steep: 'Steep ground off the trail.',
  stream: 'Crosses a stream with no bridge on the map.',
  wetland: 'Wet, boggy ground.',
  'major-road': 'Walks along a busy road for a stretch.',
};

/** The warnings for this route, most important first. Every one is a full sentence. */
export function routeWarnings(route: Route): string[] {
  const out: string[] = [];
  const off = unsureMeters(route, 'off-trail');
  if (off >= 30) {
    out.push(`${distanceWords(off)} has no trail on the map (shown in orange). Go slowly, and turn back if it gets steep or blocked.`);
  }
  if (route.stretches.some((s) => s.kind === 'guessed-join')) {
    out.push('Where paths almost meet on the map, Fred guessed they join (also in orange).');
  }
  for (const note of ['steep', 'stream', 'wetland', 'major-road'] as const) {
    if (route.notes.includes(note)) out.push(NOTE_WORDS[note]!);
  }
  if (!route.hasElevation) out.push("No height map here, so hills aren't counted in the time.");
  return out;
}

/** The trails the route follows, longest first, for one line on the card. */
export function trailNames(route: Route, max = 3): string[] {
  const byName = new Map<string, number>();
  for (const s of route.stretches) if (s.sure && s.name !== null) byName.set(s.name, (byName.get(s.name) ?? 0) + s.meters);
  return [...byName.entries()].filter(([, m]) => m >= 200).sort((a, b) => b[1] - a[1]).slice(0, max).map(([n]) => n);
}

export function failureWords(reason: PlanFailure): string {
  switch (reason) {
    case 'too-far': return "That's too far for a walking route. Pick a spot under 25 km away.";
    case 'no-map': return 'There is no detailed map here on the phone, so Fred cannot plan a route.';
    case 'start-unwalkable': return "Fred can't find dry, walkable ground where you are.";
    case 'destination-unwalkable': return 'That spot is in water. Drop the pin on dry ground.';
    case 'no-route': return "Fred can't find a safe walking route there: every way is too steep, or crosses water or cliffs.";
    case 'cancelled': return '';
  }
}

// ------------------------------------------------------------------- walking it

export interface RouteProgress {
  /** Metres along the route to the point nearest the walker. */
  readonly along: number;
  readonly remainingMeters: number;
  readonly remainingSeconds: number;
  /** How far the walker is from the route line. */
  readonly offMeters: number;
  /** The stretch the walker is on. */
  readonly stretch: RouteStretch;
  readonly arrived: boolean;
}

/** Further from the line than this (or the fix's own accuracy, if worse) is off route. */
export const OFF_ROUTE_M = 40;
/** This close to the end counts as there. */
export const ARRIVED_M = 25;

interface Seg {
  readonly ax: number; readonly ay: number; readonly bx: number; readonly by: number;
  /** Metres along the route at a. */
  readonly at: number;
  readonly len: number;
  readonly stretch: number;
}

/** Local metres east/north of a reference latitude: ample over a walking route. */
const metresPerDegLat = 111_320;

function segments(route: Route): { segs: Seg[]; total: number; lat0: number } {
  const lat0 = route.stretches[0]?.coords[0]?.[1] ?? 0;
  const kx = metresPerDegLat * Math.cos((lat0 * Math.PI) / 180);
  const segs: Seg[] = [];
  let at = 0;
  route.stretches.forEach((s, si) => {
    for (let i = 1; i < s.coords.length; i++) {
      const [alon, alat] = s.coords[i - 1]!, [blon, blat] = s.coords[i]!;
      const ax = alon * kx, ay = alat * metresPerDegLat, bx = blon * kx, by = blat * metresPerDegLat;
      const len = Math.hypot(bx - ax, by - ay);
      segs.push({ ax, ay, bx, by, at, len, stretch: si });
      at += len;
    }
  });
  return { segs, total: at, lat0 };
}

/**
 * Where the walker is along the route. `lastAlong` is the previous answer:
 * where the route passes the same place twice (out and back on a spur), the
 * nearer pass ahead of it wins over one behind.
 */
export function routeProgress(route: Route, lon: number, lat: number, lastAlong = 0): RouteProgress | null {
  const { segs, total, lat0 } = segments(route);
  if (segs.length === 0) return null;
  const kx = metresPerDegLat * Math.cos((lat0 * Math.PI) / 180);
  const px = lon * kx, py = lat * metresPerDegLat;
  let best: { d: number; along: number; seg: Seg } | null = null;
  for (const g of segs) {
    const vx = g.bx - g.ax, vy = g.by - g.ay;
    const l2 = vx * vx + vy * vy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - g.ax) * vx + (py - g.ay) * vy) / l2));
    const d = Math.hypot(px - g.ax - t * vx, py - g.ay - t * vy);
    const along = g.at + t * g.len;
    // Behind where the walker already was costs extra: prefer the pass ahead.
    const score = d + (along < lastAlong - 30 ? 60 : 0);
    if (best === null || score < best.d + (best.along < lastAlong - 30 ? 60 : 0)) best = { d, along, seg: g };
  }
  const b = best!;
  // Time left: the rest of this stretch by its share, plus every stretch after.
  const geomOf = new Map<number, number>();
  for (const g of segs) geomOf.set(g.stretch, (geomOf.get(g.stretch) ?? 0) + g.len);
  const stretchStart = segs.find((g) => g.stretch === b.seg.stretch)!.at;
  const here = route.stretches[b.seg.stretch]!;
  const geom = geomOf.get(b.seg.stretch) || 1;
  const leftHere = Math.max(0, 1 - (b.along - stretchStart) / geom);
  let remainingSeconds = here.seconds * leftHere;
  for (let i = b.seg.stretch + 1; i < route.stretches.length; i++) remainingSeconds += route.stretches[i]!.seconds;
  const remainingMeters = Math.max(0, total - b.along);
  return {
    along: b.along, remainingMeters, remainingSeconds, offMeters: b.d, stretch: here,
    arrived: remainingMeters <= ARRIVED_M && b.d <= OFF_ROUTE_M,
  };
}

/** The one line under the numbers while walking: where you are on the route. */
export function progressLine(p: RouteProgress, accuracyMeters: number | null): { readonly text: string; readonly warn: boolean } {
  if (p.arrived) return { text: "You're at the pin.", warn: false };
  const limit = Math.max(OFF_ROUTE_M, accuracyMeters ?? 0);
  if (p.offMeters > limit) return { text: `You're about ${distanceWords(p.offMeters)} off the route. Head back to the line before going on.`, warn: true };
  if (!p.stretch.sure) return { text: 'No trail on the map here. Go slowly, and turn back if it gets steep or blocked.', warn: true };
  return { text: p.stretch.name !== null ? `On ${p.stretch.name}.` : p.stretch.cls === 'trail' ? 'On a trail.' : 'On a road.', warn: false };
}
