/**
 * What can be downloaded, as places (#224): a whole state, or a region of a
 * state that is split into regions. Pure, so it is tested on the desktop
 * (test/places.test.ts); the files on the phone are map-files.ts.
 *
 * A region's download is three parts joined into one: the region itself, the
 * state-wide part every region of that state needs (the plant and animal
 * guide, coverage, a zoom-10 map of the whole state, the region outlines), and
 * the nationwide overview map. Files already on the phone are skipped when it
 * downloads, so the state-wide part and the overview come once, with the
 * first region, and the sizes shown say so.
 */
import type { BundleFile, MapIndex, StateBundle } from './map-downloads.ts';
import { placeKey, splitKey, type RegionOutlines } from './regions.ts';

/** A state split into regions, as the download list carries it. */
export interface RegionalState {
  readonly base: StateBundle;
  readonly regions: Readonly<Record<string, StateBundle & { readonly name?: string }>>;
  readonly outline: RegionOutlines;
}

/** One bundle from several, each file keeping where it is downloaded from; a path listed twice is kept once. */
export function mergeBundles(parts: readonly StateBundle[]): StateBundle {
  const seen = new Set<string>();
  const files: BundleFile[] = [];
  for (const p of parts) {
    for (const f of p.files) {
      if (seen.has(f.path)) continue;
      seen.add(f.path);
      files.push(p.baseUrl === undefined || f.baseUrl !== undefined ? f : { ...f, baseUrl: p.baseUrl });
    }
  }
  return {
    bytes: files.reduce((a, f) => a + f.bytes, 0),
    files,
    missing: [...new Set(parts.flatMap((p) => p.missing))],
  };
}

/** The places a state offers: its regions when it is split, else the state itself. */
export function placesOf(idx: MapIndex, state: string): string[] {
  const r = idx.regions?.[state];
  return r === undefined ? [state] : Object.keys(r.regions).map((id) => placeKey(state, id));
}

/** Everything one place's download holds, overview included; undefined if the list has no such place. */
export function placeBundle(idx: MapIndex, key: string): StateBundle | undefined {
  const { state, region } = splitKey(key);
  const overview = idx.overview === undefined ? [] : [idx.overview];
  if (region === null) {
    const whole = idx.states[state];
    return whole === undefined ? undefined : mergeBundles([whole, ...overview]);
  }
  const r = idx.regions?.[state];
  const part = r?.regions[region];
  return r === undefined || part === undefined ? undefined : mergeBundles([part, r.base, ...overview]);
}

/** Only the region's own files: what removing it takes away, leaving the state-wide part for its neighbours. */
export function regionOnly(idx: MapIndex, key: string): StateBundle | undefined {
  const { state, region } = splitKey(key);
  return region === null ? undefined : idx.regions?.[state]?.regions[region];
}

/** "Southern California", or a state's name, or the key itself as a last resort. */
export function placeName(idx: MapIndex | null, key: string, stateNames: Readonly<Record<string, string>>): string {
  const { state, region } = splitKey(key);
  if (region === null) return stateNames[state] ?? state;
  return idx?.regions?.[state]?.regions[region]?.name
    ?? idx?.regions?.[state]?.outline.regions.find((r) => r.id === region)?.name
    ?? `${stateNames[state] ?? state} (${region})`;
}

/**
 * Every place in list order: the hiker's own state first, by name after, and
 * within a split state the region they are in first, then the rest in the
 * order the list gives them (north to south is not assumed).
 */
export function orderPlaces(
  idx: MapIndex, states: readonly string[], hereRegion: string | null,
): string[] {
  return states.flatMap((s) => {
    const keys = placesOf(idx, s);
    return hereRegion !== null && keys.includes(hereRegion) ? [hereRegion, ...keys.filter((k) => k !== hereRegion)] : keys;
  });
}
