/**
 * The battery estimate under the text box, and the meter behind it (US-13,
 * #80, docs/plan-battery-estimate.md).
 *
 * Each real answer is measured on this phone (modules/fred-energy) and kept
 * as a running average in Documents/energy.json, so the estimate follows the
 * device, its battery wear and its temperature. Nothing is measured while
 * charging on Android: the current then is the charger's. With no reading
 * the shipped figures are used; with no native module nothing is shown.
 */
import { File, Paths } from 'expo-file-system';
import {
  answerJoules, capacityFromChargeCounter, estimate, iphoneCapacityJoules, joulesFromSamples, readBook, record,
  NOMINAL_VOLTS, type BatteryNow, type EnergyBook, type Estimate, type PowerSample, type ReplyCost,
} from '@fred/rag-core';
import Energy, { type EnergyRun } from '../modules/fred-energy';

/** How often Android reads the fuel gauge while an answer runs. */
const SAMPLE_MS = 200;
/** How long the idle draw is read before an estimate, and how long it stays good. */
const IDLE_MS = 1500;
const IDLE_FRESH_MS = 5 * 60_000;
/** A phone whose charge counter is missing: a typical 5,000 mAh battery. */
const ANDROID_DEFAULT_JOULES = 5 * NOMINAL_VOLTS * 3600;

const file = (): File => new File(Paths.document, 'energy.json');
let book: EnergyBook | undefined;
let idle: { watts: number; at: number } | undefined;

function theBook(): EnergyBook {
  if (book === undefined) {
    const f = file();
    book = readBook(f.exists ? f.textSync() : undefined);
  }
  return book;
}

const samplesOf = (run: EnergyRun): PowerSample[] =>
  run.t.map((t, i) => ({ t, current: run.current[i]!, voltageMv: run.voltageMv[i]! }));

/** The battery now, or undefined when the phone cannot say. */
export function batteryNow(): BatteryNow | undefined {
  if (Energy === null) return undefined;
  const r = Energy.read();
  if (r.level === null) return undefined;
  if (r.platform === 'ios') return { level: r.level, capacityJoules: iphoneCapacityJoules(r.model), coarse: true };
  return { level: r.level, capacityJoules: capacityFromChargeCounter(r.chargeMicroAh, r.level) ?? ANDROID_DEFAULT_JOULES, coarse: false };
}

/**
 * Read the idle draw for a moment (Android, unplugged), to take off the next
 * answer's reading. The iPhone's counter is the app's own work, so it needs
 * none.
 */
export async function sampleIdle(): Promise<void> {
  if (Energy === null) return;
  const now = Energy.read();
  if (now.platform !== 'android' || now.charging) return;
  if (idle !== undefined && Date.now() - idle.at < IDLE_FRESH_MS) return;
  Energy.start(SAMPLE_MS);
  await new Promise((r) => setTimeout(r, IDLE_MS));
  const run = joulesFromSamples(samplesOf(Energy.stop()));
  if (run !== undefined) idle = { watts: run.watts, at: Date.now() };
}

/** The line to show for a reply of this kind, or undefined for none. */
export function estimateFor(kind: ReplyCost): Estimate | undefined {
  return estimate(kind, theBook(), batteryNow());
}

/** Start measuring an answer. */
export function beginAnswer(): void {
  Energy?.start(SAMPLE_MS);
}

/**
 * Stop measuring, add the answer to this phone's average, and log it beside
 * what the estimate said (the honesty check reads these lines).
 */
export function endAnswer(kind: ReplyCost, completed: boolean): void {
  if (Energy === null) return;
  const run = Energy.stop();
  const now = Energy.read();
  const samples = samplesOf(run);
  const raw = joulesFromSamples(samples);
  const fresh = idle !== undefined && Date.now() - idle.at < IDLE_FRESH_MS ? idle.watts : undefined;
  const joules = answerJoules({
    ...(run.counterJoules === null ? { samples } : { counterJoules: run.counterJoules }),
    ...(fresh === undefined ? {} : { idleWatts: fresh }),
    charging: now.charging,
  });
  const expected = theBook()[kind].joules;
  // Only a finished answer, measured against a known idle draw, teaches the average.
  const learn = completed && joules !== undefined && (now.platform === 'ios' || fresh !== undefined);
  if (learn) {
    book = record(theBook(), kind, joules);
    try { file().write(JSON.stringify(book)); } catch { /* the average is rebuilt from later answers */ }
  }
  console.log(`[fred] energy kind=${kind} joules=${joules === undefined ? 'none' : joules.toFixed(1)} expected=${expected.toFixed(1)}` +
    ` gross=${raw === undefined ? 'none' : raw.joules.toFixed(1)} seconds=${raw === undefined ? 'none' : raw.seconds.toFixed(1)}` +
    ` watts=${raw === undefined ? 'none' : raw.watts.toFixed(2)} idleW=${fresh === undefined ? 'none' : fresh.toFixed(2)}` +
    ` samples=${samples.length} charging=${now.charging} level=${now.level ?? 'none'} chargeUAh=${now.chargeMicroAh ?? 'none'}` +
    ` rawCurrent=${now.current ?? 'none'} mv=${now.voltageMv ?? 'none'} thermal=${now.thermal ?? 'none'} learned=${learn}`);
}
