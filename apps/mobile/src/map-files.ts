/**
 * The map files on the phone (#224), read from the document directory:
 *
 *   map-US-overview.pmtiles        the nationwide map to zoom 7
 *   map-<S>-overview.pmtiles       a split state, whole, to zoom 10
 *   map-<S>-<region>.pmtiles       one region of it, zoom 11-14
 *   contours-<S>-<region>.pmtiles  its contour lines
 *   regions-<S>.json               the state's region outlines
 *   map-<S>-z14.pmtiles            a whole state the old way (and its
 *   contours-<S>.pmtiles           contours), still read as it always was
 *
 * The map draws every one of them at once, broadest first, so a region sits on
 * its state, and the state on the country: crossing from one downloaded region
 * into the next shows no seam, and past the last one the map still has roads.
 */
import { File, Paths } from 'expo-file-system';
import { edgeAhead, placeKey, regionAt, splitKey, type EdgeAhead, type RegionOutline, type RegionOutlines } from './regions.ts';

/** One map file to draw, with the contours that go with it. */
export interface MapArchive {
  /** Unique per file, used to name its layers. */
  readonly id: string;
  readonly uri: string;
  readonly contoursUri: string | null;
}

const OVERVIEW_US = 'map-US-overview.pmtiles';
const STATE_OVERVIEW = /^map-([A-Z]{2})-overview\.pmtiles$/;
const WHOLE = /^map-([A-Z]{2})-z\d+\.pmtiles$/;
const REGION = /^map-([A-Z]{2})-([a-z][a-z0-9-]*)\.pmtiles$/;
const OUTLINE = /^regions-([A-Z]{2})\.json$/;

function names(): string[] {
  try { return Paths.document.list().map((f) => f.name); } catch { return []; }
}
const uri = (name: string): string => `${Paths.document.uri}${name}`;

/** Every map file on the phone, in the order it is drawn: broadest first. */
export function mapArchives(): MapArchive[] {
  const all = names();
  const have = new Set(all);
  const contours = (name: string): string | null => (have.has(name) ? uri(name) : null);
  const out: MapArchive[] = [];
  if (have.has(OVERVIEW_US)) out.push({ id: 'us', uri: uri(OVERVIEW_US), contoursUri: null });
  for (const n of all.filter((x) => STATE_OVERVIEW.test(x)).sort()) {
    out.push({ id: `${STATE_OVERVIEW.exec(n)![1]}-overview`, uri: uri(n), contoursUri: null });
  }
  for (const n of all.filter((x) => WHOLE.test(x)).sort()) {
    const s = WHOLE.exec(n)![1]!;
    out.push({ id: s, uri: uri(n), contoursUri: contours(`contours-${s}.pmtiles`) });
  }
  for (const n of all.filter((x) => REGION.test(x) && !STATE_OVERVIEW.test(x) && !WHOLE.test(x) && x !== OVERVIEW_US).sort()) {
    const [, s, r] = REGION.exec(n)!;
    out.push({ id: `${s}-${r}`, uri: uri(n), contoursUri: contours(`contours-${s}-${r}.pmtiles`) });
  }
  return out;
}

/** Downloaded places with detail: whole states ("NV") and regions ("CA/south"). */
export function detailOnPhone(): Set<string> {
  const out = new Set<string>();
  for (const n of names()) {
    if (n === OVERVIEW_US || STATE_OVERVIEW.test(n)) continue;
    const whole = WHOLE.exec(n);
    if (whole !== null) { out.add(whole[1]!); continue; }
    const region = REGION.exec(n);
    if (region !== null) out.add(placeKey(region[1]!, region[2]!));
  }
  return out;
}

/** Outlines read once per file and size: they are a few dozen KB and the map asks often. */
const outlineCache = new Map<string, { readonly size: number; readonly outlines: RegionOutlines }>();

/** The region outlines of a state, if its state-wide part is on the phone. */
export function outlinesOnPhone(state: string): RegionOutlines | null {
  const file = new File(Paths.document, `regions-${state}.json`);
  if (!file.exists) return null;
  const cached = outlineCache.get(state);
  if (cached !== undefined && cached.size === file.size) return cached.outlines;
  try {
    const outlines = JSON.parse(file.textSync()) as RegionOutlines;
    outlineCache.set(state, { size: file.size, outlines });
    return outlines;
  } catch {
    return null;
  }
}

/** Every state whose region outlines are on the phone. */
export function outlinedStates(): string[] {
  return names().map((n) => OUTLINE.exec(n)?.[1]).filter((s): s is string => s !== undefined).sort();
}

/**
 * What the map has where the hiker stands, for what the map and the chat say
 * about it:
 * - `none`: no position, or outside the US;
 * - `detail`: a downloaded state or region, nowhere near its edge;
 * - `edge`: in a downloaded region, within EDGE_WARN_KM of one that is not;
 * - `region-missing`: in a region of a split state that is not downloaded
 *   (the state-wide part is, so the outlines and the zoom-10 map are here);
 * - `state-missing`: nothing detailed for this state on the phone.
 */
export type WhereOnMap =
  | { readonly kind: 'none' }
  | { readonly kind: 'detail' }
  | { readonly kind: 'edge'; readonly state: string; readonly edge: EdgeAhead }
  | { readonly kind: 'region-missing'; readonly state: string; readonly region: RegionOutline }
  | { readonly kind: 'state-missing'; readonly state: string };

export function whereOnMap(fix: { readonly latitude: number; readonly longitude: number; readonly state: string | null } | null): WhereOnMap {
  if (fix === null || fix.state === null) return { kind: 'none' };
  const state = fix.state;
  const have = detailOnPhone();
  if (have.has(state)) return { kind: 'detail' };
  const outlines = outlinesOnPhone(state);
  if (outlines === null) return { kind: 'state-missing', state };
  const region = regionAt(outlines, fix.longitude, fix.latitude);
  // Offshore or just over the state line: nothing better to say than the broad map.
  if (region === null) return { kind: 'detail' };
  if (!have.has(placeKey(state, region.id))) return { kind: 'region-missing', state, region };
  const regionsHere = new Set([...have].map(splitKey).filter((k) => k.state === state && k.region !== null).map((k) => k.region!));
  const edge = edgeAhead(outlines, fix.longitude, fix.latitude, regionsHere);
  return edge === null ? { kind: 'detail' } : { kind: 'edge', state, edge };
}
