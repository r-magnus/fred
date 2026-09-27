/**
 * The user's carrier, for the coverage map's "your carrier reports nothing"
 * zone (issue #58).
 *
 * A carrier the user picked wins; otherwise Android's SIM is read (network
 * code first, then its name; no permission needed). iOS reports no carrier
 * since iOS 16, so there the picker is the only way. Unknown is a valid state:
 * the map then shows only where no carrier reports anything.
 *
 * The choice lives in Documents/carrier.json, beside the packs, so it
 * survives app updates and needs no storage library.
 */
import * as Cellular from 'expo-cellular';
import { File, Paths } from 'expo-file-system';
import { carrierFromSim } from '@fred/geo';

export interface CarrierChoice {
  /** FCC provider id, or null for unknown. */
  readonly id: string | null;
  /** Where it came from, so the map can say "from your SIM" or offer a change. */
  readonly source: 'picked' | 'sim' | 'unknown';
}

const settings = (): File => new File(Paths.document, 'carrier.json');

export async function loadCarrier(): Promise<CarrierChoice> {
  const f = settings();
  if (f.exists) {
    try {
      const { id } = JSON.parse(f.textSync()) as { id: string | null };
      return { id, source: 'picked' };
    } catch {
      // A damaged file falls through to the SIM rather than hiding the map.
    }
  }
  try {
    const [mcc, mnc, name] = await Promise.all([
      Cellular.getMobileCountryCodeAsync(),
      Cellular.getMobileNetworkCodeAsync(),
      Cellular.getCarrierNameAsync(),
    ]);
    const id = carrierFromSim({ mcc, mnc, name });
    if (id !== null) return { id, source: 'sim' };
  } catch {
    // No SIM, or a platform without the module: unknown, below.
  }
  return { id: null, source: 'unknown' };
}

/** Remember a pick; null records "I don't know", which is also a choice. */
export function saveCarrier(id: string | null): void {
  const f = settings();
  if (!f.exists) f.create();
  f.write(JSON.stringify({ id }));
}

/** Forget the pick and go back to reading the SIM. */
export function forgetCarrier(): void {
  const f = settings();
  if (f.exists) f.delete();
}
