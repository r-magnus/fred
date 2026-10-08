/**
 * The phone's own battery readings (US-13, #80). Native: Android samples the
 * fuel gauge; the iPhone reads its own processor energy counter. Absent
 * (an old build, the web) the estimate is simply not shown.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

export interface EnergyReading {
  readonly platform: 'android' | 'ios';
  readonly level: number | null;
  readonly charging: boolean;
  /** Android: BATTERY_PROPERTY_CURRENT_NOW as given. */
  readonly current: number | null;
  readonly voltageMv: number | null;
  readonly chargeMicroAh: number | null;
  /** iPhone: the app's processor energy so far, joules. */
  readonly counterJoules: number | null;
  readonly model: string | null;
  readonly lowPower: boolean;
  readonly thermal: number | null;
}

export interface EnergyRun {
  readonly t: readonly number[];
  readonly current: readonly number[];
  readonly voltageMv: readonly number[];
  readonly counterJoules: number | null;
}

interface FredEnergyNative {
  read(): EnergyReading;
  start(intervalMs: number): void;
  stop(): EnergyRun;
}

export default requireOptionalNativeModule<FredEnergyNative>('FredEnergy');
