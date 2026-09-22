/**
 * The parts of a location fix that can be reasoned about without a phone.
 *
 * `apps/mobile/src/location.ts` owns the expo-location subscription, which
 * cannot run under `node --test`. Everything it decides — which of two readings
 * to keep, what a drive-test sample looks like on disk, how a recorded track
 * summarises — is arithmetic, so it lives here where the test glob reaches it.
 *
 * Deliberately free of React Native and of expo types, like the rest of this
 * package. The app maps `LocationObjectCoords` onto `Reading` at the boundary.
 */

/** The half of a fix that decides whether it is an improvement. */
export interface Reading {
  /** Radius of 68% confidence in metres, or null when the platform omits it. */
  readonly accuracyMeters: number | null;
}

/**
 * Whether `candidate` should replace `best`.
 *
 * Three cases, and the awkward one is the middle. A reading with no accuracy
 * figure cannot be compared against one that has it, so it must not displace a
 * measured fix — otherwise a single null-accuracy update late in the window
 * throws away the best reading of the run. It *can* displace another
 * unmeasurable one, which keeps the most recent of them rather than the first.
 */
export function isBetterFix(best: Reading | null, candidate: Reading): boolean {
  if (best === null) return true;
  if (best.accuracyMeters === null) return true;
  if (candidate.accuracyMeters === null) return false;
  return candidate.accuracyMeters < best.accuracyMeters;
}

/** Whether a fix meets the B-KR1 target and the watch can stop early. */
export function meetsTarget(r: Reading, targetMeters: number): boolean {
  return r.accuracyMeters !== null && r.accuracyMeters <= targetMeters;
}

/**
 * One row of a drive-test track.
 *
 * Coordinates are present here and absent from the normal logging path on
 * purpose: checking accuracy against ground truth needs to know where the phone
 * actually was, and nothing else Fred does needs that. Recording is opt-in for
 * exactly this reason.
 */
export interface TrackSample {
  /** Milliseconds since the fix attempt started, not since the epoch. */
  readonly elapsedMs: number;
  /** Epoch ms reported by the platform for the reading itself. */
  readonly timestamp: number;
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMeters: number | null;
  readonly altitudeMeters: number | null;
  readonly speedMps: number | null;
  /** USPS code resolved offline, so a boundary crossing is visible in the log. */
  readonly state: string | null;
  /** True when this reading became the new best of its attempt. */
  readonly improved: boolean;
  /**
   * Android reports whether a reading came from a mock provider. Recorded so a
   * track made with a fake GPS cannot be mistaken for a real drive later —
   * which matters, because B-KR1 is graded on numbers from this file.
   */
  readonly mocked: boolean;
}

export const TRACK_HEADER =
  'elapsedMs,timestamp,latitude,longitude,accuracyMeters,altitudeMeters,speedMps,state,improved,mocked';

const num = (v: number | null): string => (v === null ? '' : String(v));

/** One CSV row. No quoting needed: every field is a number, a USPS code or a bool. */
export function toTrackRow(s: TrackSample): string {
  return [
    s.elapsedMs, s.timestamp, s.latitude, s.longitude,
    num(s.accuracyMeters), num(s.altitudeMeters), num(s.speedMps),
    s.state ?? '', s.improved, s.mocked,
  ].join(',');
}

export interface TrackSummary {
  readonly samples: number;
  /** Best accuracy seen, metres. Null when no sample carried one. */
  readonly bestAccuracyMeters: number | null;
  /** Median of the accuracies that were reported, which is how B-KR1 is stated. */
  readonly medianAccuracyMeters: number | null;
  /** Elapsed ms of the first sample to meet the target, or null if none did. */
  readonly timeToTargetMs: number | null;
  /** Distinct USPS codes seen, in order of first appearance. */
  readonly states: readonly string[];
  /** True when any sample came from a mock provider. */
  readonly anyMocked: boolean;
}

/**
 * Reduce a recorded track to the numbers B-KR1 and B-KR2 are graded on.
 *
 * Median rather than mean because the existing 33.5 m figure is a median, and
 * because a cold start produces a few wild early readings that a mean would
 * carry for the rest of the run.
 */
export function summariseTrack(
  samples: readonly TrackSample[],
  targetMeters: number,
): TrackSummary {
  const acc = samples
    .map((s) => s.accuracyMeters)
    .filter((a): a is number => a !== null)
    .sort((x, y) => x - y);
  const mid = acc.length === 0 ? null
    : acc.length % 2 === 1 ? acc[(acc.length - 1) / 2]!
    : (acc[acc.length / 2 - 1]! + acc[acc.length / 2]!) / 2;
  const hit = samples.find((s) => meetsTarget(s, targetMeters));
  const states: string[] = [];
  for (const s of samples) {
    if (s.state !== null && !states.includes(s.state)) states.push(s.state);
  }
  return {
    samples: samples.length,
    bestAccuracyMeters: acc.length === 0 ? null : acc[0]!,
    medianAccuracyMeters: mid,
    timeToTargetMs: hit === undefined ? null : hit.elapsedMs,
    states,
    anyMocked: samples.some((s) => s.mocked),
  };
}
