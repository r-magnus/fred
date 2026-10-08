/**
 * The battery an answer uses, and the estimate shown before sending (US-13,
 * #80, docs/plan-battery-estimate.md).
 *
 * The phone measures itself. On Android the app samples the battery's current
 * and voltage while an answer runs; on an iPhone it reads the kernel's energy
 * counter for its own processor work before and after. Either way the result
 * is joules for that answer, kept as a running average per kind of reply, so
 * the estimate follows the user's own phone. Everything here is plain
 * arithmetic with no platform in it, so it is tested on the desktop.
 */

/** A written answer runs the model for seconds; everything else is quick. */
export type ReplyCost = 'written' | 'quick';

/** One reading of the battery while an answer runs (Android). */
export interface PowerSample {
  /** Milliseconds, any monotonic clock. */
  readonly t: number;
  /** BATTERY_PROPERTY_CURRENT_NOW exactly as the phone gave it. */
  readonly current: number;
  /** Battery voltage in millivolts. */
  readonly voltageMv: number;
}

/**
 * Battery current in microamperes, always positive. Android documents
 * microamperes, negative while discharging; some phones report milliamperes,
 * and some the other sign. A phone awake draws between about 50 mA and 6 A,
 * so a reading under 30,000 can only be milliamperes.
 */
export function currentMicroA(raw: number): number {
  const a = Math.abs(raw);
  return a < 30_000 ? a * 1000 : a;
}

/** Fewest readings, and the longest gap between two, for a usable measurement. */
const MIN_SAMPLES = 4;
const MAX_GAP_MS = 3000;
/** Plausible draw for a phone awake: outside this the fuel gauge is not telling the truth. */
export const MIN_WATTS = 0.1;
export const MAX_WATTS = 25;

/**
 * Energy over a run of samples, in joules: current times voltage, summed
 * between readings. Undefined when the readings cannot be trusted (too few,
 * a long gap, or a draw no phone has).
 */
export function joulesFromSamples(samples: readonly PowerSample[]): { joules: number; seconds: number; watts: number } | undefined {
  if (samples.length < MIN_SAMPLES) return undefined;
  let joules = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]!, b = samples[i]!;
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0 || dt * 1000 > MAX_GAP_MS) return undefined;
    const wa = (currentMicroA(a.current) / 1e6) * (a.voltageMv / 1000);
    const wb = (currentMicroA(b.current) / 1e6) * (b.voltageMv / 1000);
    joules += ((wa + wb) / 2) * dt;
  }
  const seconds = (samples.at(-1)!.t - samples[0]!.t) / 1000;
  const watts = joules / seconds;
  if (!(watts >= MIN_WATTS && watts <= MAX_WATTS)) return undefined;
  return { joules, seconds, watts };
}

/** What the phone has measured so far: a running average per kind of reply. */
export interface EnergyBook {
  readonly written: { readonly joules: number; readonly n: number };
  readonly quick: { readonly joules: number; readonly n: number };
}

/**
 * Shipped starting figures, used until this phone has measured its own:
 * the Nothing Phone (3), unplugged, screen on, 2026-10-07. 21 written answers
 * averaged 135 J (92-194) and 27 quick replies 10 J (5-17), idle draw taken
 * off (docs/results-battery-estimate.md).
 */
export const DEFAULT_BOOK: EnergyBook = { written: { joules: 135, n: 0 }, quick: { joules: 10, n: 0 } };

/** Recent answers count for more: battery wear and temperature drift. */
const BOOK_WEIGHT = 0.2;
/** A single answer outside this is a bad reading, not an answer. */
const MAX_ANSWER_JOULES = 1500;

/** The book with one more measured answer. A reading that cannot be real is ignored. */
export function record(book: EnergyBook, kind: ReplyCost, joules: number): EnergyBook {
  if (!(joules > 0 && joules <= MAX_ANSWER_JOULES)) return book;
  const was = book[kind];
  const next = was.n === 0 ? joules : was.joules + BOOK_WEIGHT * (joules - was.joules);
  return { ...book, [kind]: { joules: next, n: was.n + 1 } };
}

/** A book read back from a file; anything malformed gives the defaults. */
export function readBook(json: string | undefined): EnergyBook {
  if (json === undefined) return DEFAULT_BOOK;
  try {
    const b = JSON.parse(json) as EnergyBook;
    const ok = (x: unknown): x is { joules: number; n: number } => typeof x === 'object' && x !== null &&
      typeof (x as { joules: unknown }).joules === 'number' && typeof (x as { n: unknown }).n === 'number' &&
      (x as { joules: number }).joules > 0 && (x as { joules: number }).joules <= MAX_ANSWER_JOULES;
    return ok(b.written) && ok(b.quick) ? { written: b.written, quick: b.quick } : DEFAULT_BOOK;
  } catch {
    return DEFAULT_BOOK;
  }
}

export interface BatteryNow {
  /** Charge left, 0 to 1. An iPhone reports it in steps of 0.05. */
  readonly level: number;
  /** A full battery in joules, as it is today if the phone can say, else as new. */
  readonly capacityJoules: number;
  /** True when `level` is coarse (iPhone): "answers left" is then worded as rough. */
  readonly coarse: boolean;
}

/** Nominal cell voltage, to turn a charge counter (ampere-hours) into energy. */
export const NOMINAL_VOLTS = 3.85;

/**
 * A full battery in joules from Android's charge counter (microampere-hours
 * left) and the level: the counter follows battery wear. Undefined when
 * either reading is missing or the result is not a phone's battery.
 */
export function capacityFromChargeCounter(chargeMicroAh: number | null, level: number): number | undefined {
  if (chargeMicroAh === null || !(chargeMicroAh > 0) || !(level >= 0.05 && level <= 1)) return undefined;
  const joules = (chargeMicroAh / 1e6 / level) * NOMINAL_VOLTS * 3600;
  return joules >= 15_000 && joules <= 120_000 ? joules : undefined;
}

/**
 * iPhone batteries as shipped, watt-hours, by model identifier (hw.machine).
 * iOS reports no capacity, so this ignores wear. Figures as published in
 * regulatory filings and teardowns; not checked on a device.
 */
export const IPHONE_WATT_HOURS: Readonly<Record<string, number>> = {
  'iPhone13,2': 10.78, 'iPhone13,3': 10.78, 'iPhone13,4': 14.13,
  'iPhone14,4': 9.34, 'iPhone14,5': 12.41, 'iPhone14,2': 11.97, 'iPhone14,3': 16.75, 'iPhone14,6': 7.82,
  'iPhone14,7': 12.68, 'iPhone14,8': 16.68, 'iPhone15,2': 12.38, 'iPhone15,3': 16.68,
  'iPhone15,4': 12.98, 'iPhone15,5': 16.95, 'iPhone16,1': 12.70, 'iPhone16,2': 17.11,
  'iPhone17,3': 13.82, 'iPhone17,4': 18.11, 'iPhone17,1': 13.94, 'iPhone17,2': 18.17,
};
/** An iPhone not in the table: a mid-sized one. */
export const IPHONE_DEFAULT_WATT_HOURS = 13;

export function iphoneCapacityJoules(model: string | null): number {
  return (model === null ? IPHONE_DEFAULT_WATT_HOURS : IPHONE_WATT_HOURS[model] ?? IPHONE_DEFAULT_WATT_HOURS) * 3600;
}

export interface Estimate {
  /** Share of a full battery this answer is expected to use, in percent. */
  readonly percent: number;
  /** Answers like it the charge left allows; undefined when the level is unknown. */
  readonly answersLeft: number | undefined;
  /** True once this phone has measured an answer of this kind itself. */
  readonly measured: boolean;
  /** The line shown under the text box. */
  readonly text: string;
}

/** 437 -> "about 400", 83 -> "about 80", 7 -> "about 7": no false precision. */
function roughly(n: number): string {
  if (n >= 1000) return 'over 1,000';
  const step = n >= 100 ? 100 : n >= 20 ? 10 : 1;
  return `about ${Math.max(1, Math.floor(n / step) * step)}`;
}

/** "0.1%", "0.03%", "under 0.01%". */
function percentText(p: number): string {
  if (p < 0.01) return 'under 0.01%';
  return `${p < 0.1 ? p.toFixed(2) : p < 10 ? p.toFixed(1) : p.toFixed(0)}%`;
}

/**
 * The estimate for a reply of this kind on this phone, now. One answer is a
 * tenth of a percent or less, so the line also says how many more like it
 * the charge left allows (docs/plan-battery-estimate.md, "What to show").
 */
export function estimate(kind: ReplyCost, book: EnergyBook, battery: BatteryNow | undefined): Estimate | undefined {
  if (battery === undefined || !(battery.capacityJoules > 0)) return undefined;
  const joules = book[kind].joules;
  const percent = (joules / battery.capacityJoules) * 100;
  const left = battery.level > 0 ? Math.floor((battery.level * battery.capacityJoules) / joules) : undefined;
  const what = kind === 'written' ? 'A written answer' : 'A quick reply';
  const more = left === undefined ? '' : ` · ${battery.coarse ? 'very roughly' : 'roughly'} ${roughly(left).replace('about ', '')} more like it on this charge`;
  return { percent, answersLeft: left, measured: book[kind].n > 0, text: `${what}: about ${percentText(percent)} of battery${more}` };
}

/**
 * What an answer cost, from the meter's reading: Android's samples with the
 * idle draw just before taken off, or the iPhone's own counter. Undefined
 * when nothing usable was read (charging, a bad gauge, no counter).
 */
export function answerJoules(reading: {
  readonly samples?: readonly PowerSample[];
  readonly idleWatts?: number;
  readonly counterJoules?: number;
  readonly charging: boolean;
}): number | undefined {
  if (reading.counterJoules !== undefined) return reading.counterJoules > 0 ? reading.counterJoules : undefined;
  if (reading.charging || reading.samples === undefined) return undefined;
  const run = joulesFromSamples(reading.samples);
  if (run === undefined) return undefined;
  const net = run.joules - (reading.idleWatts ?? 0) * run.seconds;
  // An answer that seems to cost less than idling was measured against a bad baseline.
  return net > 0 ? net : undefined;
}
