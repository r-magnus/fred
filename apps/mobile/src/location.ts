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
import { File, Paths } from 'expo-file-system';
import {
  stateForCoords, isBetterFix, meetsTarget, toTrackRow, TRACK_HEADER,
  summariseTrack, type TrackSample, type TrackSummary,
} from '@fred/geo';

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

/**
 * Drive-test recording — off unless deliberately switched on.
 *
 * B-KR1, B-KR2 and B-KR3 are all verified by driving to different physical
 * locations, so one trip should produce data for all three rather than three
 * trips producing notes. This writes every reading the watch sees, not just the
 * best one, because how fast accuracy tightens is the interesting part outdoors
 * and the indoor measurements never got to see it.
 *
 * It records coordinates, which the normal logging path deliberately does not.
 * That is the whole reason this is opt-in and lands in a named file the tester
 * can delete: checking a fix against ground truth needs to know where the phone
 * really was, and nothing else Fred does needs that.
 */
class TrackRecorder {
  private readonly file: File;
  private readonly samples: TrackSample[] = [];
  private readonly startedAt = Date.now();
  /** The always-on subscription. Null until the continuous watch attaches. */
  private watch: Location.LocationSubscription | null = null;

  constructor(readonly name: string) {
    this.file = new File(Paths.document, name);
    if (!this.file.exists) {
      this.file.create();
      this.file.write(`${TRACK_HEADER}\n`);
    }
  }

  /**
   * Record continuously until stopped, so a drive needs no interaction.
   *
   * The first recorder only captured during a fix attempt, which meant tapping
   * at every stop — fine standing in a field, wrong in a moving car. Highest
   * accuracy is deliberate: this runs during a measurement, not during normal
   * use, and the reading being graded is the one the GPS can actually achieve.
   */
  startWatch(): void {
    void Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Highest, timeInterval: 2000, distanceInterval: 0 },
      (loc) => { this.add(loc, 0, false, 'watch'); },
      () => { /* a dropped reading must not end the recording */ },
    ).then((sub) => {
      // stopWatch() may already have run, in which case nothing removes this.
      if (this.watch === null && !this.stopped) this.watch = sub;
      else sub.remove();
    }, () => { /* permission or provider failure; the tap path still records */ });
  }

  private stopped = false;

  stopWatch(): void {
    this.stopped = true;
    this.watch?.remove();
    this.watch = null;
  }

  add(
    loc: Location.LocationObject,
    elapsedMs: number,
    improved: boolean,
    source: 'watch' | 'fix' = 'fix',
  ): void {
    const s: TrackSample = {
      elapsedMs,
      sinceStartMs: Date.now() - this.startedAt,
      source,
      timestamp: loc.timestamp,
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
      accuracyMeters: loc.coords.accuracy,
      altitudeMeters: loc.coords.altitude,
      speedMps: loc.coords.speed,
      state: stateForCoords(loc.coords.latitude, loc.coords.longitude),
      improved,
      // Android-only, and absent on a platform that does not report it. A
      // track made with a mock provider must not later read as a real drive.
      mocked: loc.mocked === true,
    };
    this.samples.push(s);
    // Appended per sample rather than buffered to the end: a drive that ends
    // with a flat battery should still leave behind everything up to that point.
    this.file.write(`${toTrackRow(s)}\n`, { append: true });
  }

  summary(targetMeters: number): TrackSummary {
    return summariseTrack(this.samples, targetMeters);
  }
}

let recorder: TrackRecorder | null = null;

/**
 * Local time, not UTC. A track is matched against "when I was at the trailhead",
 * and toISOString would name an evening drive with tomorrow's date.
 */
function defaultTrackName(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `bkr1-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    + `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.csv`;
}

/**
 * Begin recording to `<documents>/<name>`, returning the path to pull over USB.
 *
 * USB is the point: `adb pull` works with the radios off, so the airplane-mode
 * run that tests whether GPS holds up without a signal can still be retrieved.
 */
export async function startRecording(name = defaultTrackName()): Promise<string> {
  // The continuous watch needs the same permission the tap path asks for, and
  // asking here means a drive cannot silently record nothing.
  const perm = await Location.requestForegroundPermissionsAsync();
  recorder = new TrackRecorder(name);
  if (perm.granted) recorder.startWatch();
  return `${Paths.document.uri}${name}`;
}

/** Stop recording and report what the track contained. Null if none was running. */
export function stopRecording(targetMeters = TARGET_METERS): TrackSummary | null {
  recorder?.stopWatch();
  const s = recorder?.summary(targetMeters) ?? null;
  recorder = null;
  return s;
}

/** Whether a track is being written right now. */
export function isRecording(): boolean {
  return recorder !== null;
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
          // The rule itself lives in @fred/geo, where node --test can reach it.
          const a = loc.coords.accuracy;
          const improved = isBetterFix(
            best === null ? null : { accuracyMeters: best.coords.accuracy },
            { accuracyMeters: a },
          );
          if (improved) {
            best = loc;
            onProgress?.(a);
          }
          if (recorder !== null) recorder.add(loc, Date.now() - started, improved);
          if (meetsTarget({ accuracyMeters: a }, targetMeters)) finish();
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
