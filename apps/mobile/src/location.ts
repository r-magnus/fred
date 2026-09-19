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
}

export type LocationResult =
  | { readonly ok: true; readonly fix: LocationFix }
  | { readonly ok: false; readonly reason: 'denied' | 'disabled' | 'unavailable'; readonly message: string };

function toFix(loc: Location.LocationObject, cached: boolean): LocationFix {
  return {
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
  return loc === null ? null : toFix(loc, true);
}

/**
 * Prompt if needed, then read the GPS.
 *
 * `Accuracy.Highest` is what B-KR1's ±10 m target requires; the lower settings
 * fall back to network and cell positioning, which Fred will not have.
 */
export async function currentFix(): Promise<LocationResult> {
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

  try {
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
    return { ok: true, fix: toFix(loc, false) };
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
