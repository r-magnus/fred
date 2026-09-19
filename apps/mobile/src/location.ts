/**
 * Where the user is — B-KR1.
 *
 * Two things come out of a fix and they are graded separately. The coordinate
 * and its accuracy are B-KR1 itself, measured in metres against a ±10 m target.
 * The USPS state code is what the pipeline actually consumes, to choose a
 * flora-and-fauna pack (US-05).
 *
 * The state is resolved from bundled boundary data, never from
 * Location.reverseGeocodeAsync: that call needs a network round trip on
 * Android, so it would fail in precisely the situation Fred exists for. See
 * packages/geo.
 */
import * as Location from 'expo-location';
import { stateForCoords } from '@fred/geo';

export interface LocationFix {
  readonly latitude: number;
  readonly longitude: number;
  /** Radius of 68% confidence, metres. This is the B-KR1 measurement. */
  readonly accuracyMeters: number | null;
  /** USPS code, or null when the fix is nowhere near a US state. */
  readonly state: string | null;
  /** Epoch ms of the fix, not of the request — a cached fix can be old. */
  readonly timestamp: number;
  /** True when this came from the OS cache rather than a fresh GPS read. */
  readonly cached: boolean;
  /** Wall time spent waiting on the GPS, ms. 0 for a cached fix. */
  readonly tookMs: number;
}

export type LocationResult =
  | { readonly ok: true; readonly fix: LocationFix }
  | { readonly ok: false; readonly reason: 'denied' | 'disabled' | 'unavailable'; readonly message: string };

function toFix(loc: Location.LocationObject, cached: boolean, tookMs: number): LocationFix {
  return {
    tookMs,
    latitude: loc.coords.latitude,
    longitude: loc.coords.longitude,
    accuracyMeters: loc.coords.accuracy,
    state: stateForCoords(loc.coords.latitude, loc.coords.longitude),
    timestamp: loc.timestamp,
    cached,
  };
}

/**
 * A cached fix, if the OS has a recent one. Returns immediately.
 *
 * Worth asking for first because a cold GPS lock takes 5-30 s outdoors and
 * longer under canopy, and a minute-old fix is already good enough to choose a
 * state pack. The caller shows it, then replaces it when `currentFix` lands.
 */
export async function lastKnownFix(maxAgeMs = 120_000): Promise<LocationFix | null> {
  const granted = await Location.getForegroundPermissionsAsync();
  if (!granted.granted) return null;
  const loc = await Location.getLastKnownPositionAsync({ maxAge: maxAgeMs });
  return loc === null ? null : toFix(loc, true, 0);
}

/** The B-KR1 target. Stop early once the fix is this good. */
const TARGET_METERS = 10;
/** How long to keep refining before taking the best so far. */
const REFINE_MS = 15_000;

/**
 * Prompt if needed, then watch the GPS until it is good enough.
 *
 * getCurrentPositionAsync returns as soon as the platform meets its own
 * internal bar, which is not ±10 m. Measured indoors on the Nothing Phone (3),
 * six consecutive calls gave 20 m, 64, 74, 75, 75, 76 — the first was a good
 * cached fix handed straight back, and the rest were WiFi positioning settling
 * on its own floor around 75 m. A satellite fix tightens over tens of seconds
 * as more birds lock, so the way to reach the target is to watch and keep the
 * best rather than to ask once.
 *
 * Returns early the moment it sees `targetMeters`, so a clear sky outdoors
 * costs a second or two, not the full window.
 */
export async function currentFix(
  { targetMeters = TARGET_METERS, timeoutMs = REFINE_MS, onProgress }: {
    targetMeters?: number; timeoutMs?: number;
    /** Best accuracy so far, metres, as the watch tightens. */
    onProgress?: (accuracyMeters: number | null) => void;
  } = {},
): Promise<LocationResult> {
  if (!(await Location.hasServicesEnabledAsync())) {
    return { ok: false, reason: 'disabled', message: 'Location is turned off on this phone.' };
  }

  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) {
    return {
      ok: false,
      reason: 'denied',
      message: perm.canAskAgain
        ? 'Fred needs location access to pick the right local guide.'
        : 'Location access is blocked. Turn it on in Settings to use it.',
    };
  }

  const started = Date.now();
  // A cached fix is a free starting bid — the platform will not always beat it,
  // as the 20 m reading above shows, and discarding it can lose real accuracy.
  let best = await Location.getLastKnownPositionAsync({ maxAge: 60_000 });

  try {
    const fix = await new Promise<LocationFix>((resolve, reject) => {
      let sub: Location.LocationSubscription | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let settled = false;

      const finish = (): void => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        sub?.remove();
        if (best === null) {
          reject(new Error('No location fix within the time limit.'));
        } else {
          resolve(toFix(best, false, Date.now() - started));
        }
      };

      timer = setTimeout(finish, timeoutMs);

      void Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Highest, timeInterval: 1000, distanceInterval: 0 },
        (loc) => {
          // A reading with no accuracy figure cannot be compared, so it only
          // wins when there is nothing to compare it against.
          const a = loc.coords.accuracy;
          const bestA = best?.coords.accuracy ?? null;
          if (best === null || bestA === null || (a !== null && a < bestA)) {
            best = loc;
            onProgress?.(a);
          }
          if (a !== null && a <= targetMeters) finish();
        },
        (message) => { if (best !== null) finish(); else { settled = true; reject(new Error(message)); } },
      ).then((s) => {
        sub = s;
        // finish() may already have run, in which case nothing removes this.
        if (settled) s.remove();
      }, reject);
    });

    // B-KR1 is verified by driving somewhere and reading the number, so it has
    // to leave a trace that survives not looking at the screen. Accuracy, state
    // and lock time only — never the coordinates, which would write the user's
    // actual position into a log that outlives the session.
    console.log(
      `[B-KR1] state=${fix.state ?? 'none'} accuracy=${fix.accuracyMeters ?? 'unknown'}m ` +
      `lock=${fix.tookMs}ms`);
    return { ok: true, fix };
  } catch (e) {
    return {
      ok: false,
      reason: 'unavailable',
      message: e instanceof Error ? e.message : 'Could not get a location fix.',
    };
  }
}

/** "±8 m" / "accuracy unknown" — the grade-visible half of a fix. */
export function describeAccuracy(fix: LocationFix): string {
  if (fix.accuracyMeters === null) return 'accuracy unknown';
  return `±${fix.accuracyMeters < 10 ? fix.accuracyMeters.toFixed(1) : Math.round(fix.accuracyMeters)} m`;
}
