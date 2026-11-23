/**
 * Download a state's map bundle over the network (issue #26).
 *
 * Bundles are built by scripts/build-state-bundle.mjs and published as release
 * files on the public repo r-magnus/fred-maps. Its index.json lists every
 * state's files with sizes and hashes, and each file lands at the path the app
 * already reads: the basemap, contours and coverage in the document directory,
 * the plant and animal pack under packs/. So a downloaded state works exactly
 * like one staged by cable.
 *
 * Each file goes to "<path>.partial" first and is renamed only after its size
 * and MD5 match the index. A dropped connection or a killed app therefore never
 * leaves a truncated map where the map screen would open it. MD5 is enough
 * here: HTTPS already protects the transfer, and the hash only has to catch a
 * short or damaged file. The phone computes it natively, without reading
 * hundreds of megabytes into JavaScript.
 */
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { keepDownloadsOutOfBackup } from './backup.ts';
import { downloadError } from './download-errors.ts';

import { placeBundle, placesOf, regionOnly, type RegionalState } from './places.ts';
import { splitKey } from './regions.ts';

/**
 * The published list, unless a build names another: the test app is built
 * with EXPO_PUBLIC_FRED_INDEX_URL pointing at a list served from the desktop
 * (scripts/build-test-index.mjs), to try downloads nobody else can see yet.
 */
export const INDEX_URL = process.env.EXPO_PUBLIC_FRED_INDEX_URL
  ?? 'https://raw.githubusercontent.com/r-magnus/fred-maps/main/index.json';

/** One piece of a large file, published as its own release file (#198). */
export interface FilePart {
  readonly asset: string;
  readonly bytes: number;
  readonly md5: string;
}
export interface BundleFile {
  readonly path: string;
  /** The whole file. Still published beside the parts, for builds that predate them. */
  readonly asset: string;
  readonly bytes: number;
  readonly md5: string;
  /**
   * The file in pieces, in order (#198). A dropped connection then costs one
   * piece, not the file: finished pieces stay on the phone and are skipped,
   * and the pieces are joined and the whole file checked at the end.
   */
  readonly parts?: readonly FilePart[];
  /** Where this file is, when not its bundle's or the index's: set when bundles are joined (places.ts). */
  readonly baseUrl?: string;
}
export interface StateBundle {
  readonly bytes: number;
  readonly files: readonly BundleFile[];
  readonly missing: readonly string[];
  /** Where this bundle's files are, when not the index's own release (the core download, #198). */
  readonly baseUrl?: string;
}
export interface MapIndex {
  readonly schemaVersion: number;
  readonly release: string;
  readonly baseUrl: string;
  readonly states: Readonly<Record<string, StateBundle>>;
  /**
   * What Fred needs before he can answer anything: the models and the guides
   * that are the same everywhere (#196). Absent until they are published; a
   * phone without them can then only be set up by cable.
   */
  readonly core?: StateBundle;
  /**
   * States split into regions (#224), by USPS code. A newer field: a build
   * that predates it reads `states` alone, which still lists every state
   * whole, so the two never disagree.
   */
  readonly regions?: Readonly<Record<string, RegionalState>>;
  /** The nationwide map to zoom 7, drawn under everything else so the map is never blank (#224). */
  readonly overview?: StateBundle;
}

/** The index format this build understands. A newer one is refused, not guessed at. */
const SCHEMA = 1;

export async function fetchIndex(signal?: AbortSignal): Promise<MapIndex> {
  let res: Response;
  try {
    res = await fetch(INDEX_URL, signal === undefined ? {} : { signal });
  } catch (e) {
    if (signal?.aborted === true) throw e;
    throw new Error('Fred can’t reach the downloads right now. Check your connection and try again.');
  }
  if (!res.ok) throw new Error('Fred can’t reach the downloads right now. Try again in a few minutes.');
  const idx = await res.json() as MapIndex;
  if (idx.schemaVersion !== SCHEMA) throw new Error('This version of Fred is too old for the current maps. Update the app.');
  return idx;
}

const target = (path: string): File => new File(Paths.document, ...path.split('/'));

/** A file already in place: the right size is taken as installed (the hash was checked when it arrived). */
const present = (f: BundleFile): boolean => {
  const file = target(f.path);
  return file.exists && file.size === f.bytes;
};

export type InstallState = 'installed' | 'partial' | 'none';

export function installState(bundle: StateBundle): InstallState {
  const n = bundle.files.filter(present).length;
  return n === bundle.files.length ? 'installed' : n === 0 ? 'none' : 'partial';
}

/** A finished piece of a file, kept beside it until the file is joined. */
const partFile = (f: BundleFile, i: number): File => {
  const final = target(f.path);
  return new File(final.parentDirectory, `${final.name}.part${String(i).padStart(3, '0')}`);
};
const partPresent = (f: BundleFile, i: number): boolean => {
  const file = partFile(f, i);
  return file.exists && file.size === f.parts![i]!.bytes;
};

/** Bytes still to download for one file: its missing pieces, or the whole file. */
const fileRemaining = (f: BundleFile): number =>
  present(f) ? 0 : f.parts === undefined ? f.bytes
    : f.parts.reduce((a, p, i) => a + (partPresent(f, i) ? 0 : p.bytes), 0);

/** Bytes still to download for a bundle. */
export const remainingBytes = (bundle: StateBundle): number =>
  bundle.files.reduce((a, f) => a + fileRemaining(f), 0);

/** Room to leave free on the phone beyond the download itself. */
const HEADROOM = 500 * 1024 * 1024;

export interface Progress {
  readonly done: number;
  readonly total: number;
  readonly file: string;
}

/**
 * Download every file of a state that isn't already in place. Resolves when
 * all of them are installed; throws with a message fit to show the hiker.
 */
export async function downloadState(
  idx: MapIndex,
  state: string,
  onProgress: (p: Progress) => void,
  signal: AbortSignal,
): Promise<void> {
  const bundle = idx.states[state];
  if (bundle === undefined) throw new Error(`No map is published for ${state}.`);
  return downloadBundle(idx, bundle, onProgress, signal);
}

/** The same for any bundle in the index: a state, or the core guides and models. */
export async function downloadBundle(
  idx: MapIndex,
  bundle: StateBundle,
  onProgress: (p: Progress) => void,
  signal: AbortSignal,
): Promise<void> {
  const base = bundle.baseUrl ?? idx.baseUrl;
  const todo = bundle.files.filter((f) => !present(f));
  const total = remainingBytes(bundle);
  // A file in pieces needs its pieces and the joined file at once, briefly.
  const joinRoom = todo.reduce((a, f) => Math.max(a, f.parts === undefined ? 0 : f.bytes), 0);
  if (Paths.availableDiskSpace < total + joinRoom + HEADROOM) {
    const gb = (b: number): string => (b / 1e9).toFixed(1);
    throw new Error(`Not enough space: this needs ${gb(total + joinRoom)} GB and the phone has ${gb(Paths.availableDiskSpace)} GB free.`);
  }
  let done = 0;
  const cancelled = (): Error => new Error('Download cancelled.');
  for (const f of todo) {
    if (signal.aborted) throw cancelled();
    const final = target(f.path);
    const parent = final.parentDirectory;
    if (!parent.exists) parent.create({ intermediates: true });
    if (f.parts === undefined) {
      await fetchChecked(`${f.baseUrl ?? base}${f.asset}`, new File(parent, `${final.name}.partial`), f.bytes, f.md5, f.path,
        (n) => onProgress({ done: done + n, total, file: f.path }), signal);
      if (final.exists) final.delete();
      new File(parent, `${final.name}.partial`).move(final);
      done += f.bytes;
    } else {
      for (const [i, part] of f.parts.entries()) {
        if (signal.aborted) throw cancelled();
        if (partPresent(f, i)) continue;
        const piece = partFile(f, i);
        const partial = new File(parent, `${piece.name}.partial`);
        await fetchChecked(`${f.baseUrl ?? base}${part.asset}`, partial, part.bytes, part.md5, f.path,
          (n) => onProgress({ done: done + n, total, file: f.path }), signal);
        if (piece.exists) piece.delete();
        partial.move(piece);
        keepDownloadsOutOfBackup();
        done += part.bytes;
      }
      await joinParts(f, signal);
    }
    // A finished file is new, so unmarked: keep it out of the iPhone's backup (src/backup.ts).
    keepDownloadsOutOfBackup();
    onProgress({ done, total, file: f.path });
  }
}

/** Download one release file to `partial` and check its size and MD5; the partial is removed on any failure. */
async function fetchChecked(url: string, partial: File, bytes: number, md5: string, label: string,
  onBytes: (n: number) => void, signal: AbortSignal): Promise<void> {
  if (partial.exists) partial.delete();
  const task = File.createDownloadTask(url, partial, { signal, onProgress: ({ bytesWritten }) => onBytes(bytesWritten) });
  try {
    await task.downloadAsync();
    const info = partial.info({ md5: true });
    if (info.size !== bytes || info.md5 !== md5) throw new Error(`${label} arrived damaged. Try again.`);
  } catch (e) {
    if (partial.exists) partial.delete();
    throw signal.aborted ? new Error('Download cancelled.') : downloadError(e);
  }
}


/**
 * Join a file's pieces in order into the file itself, then drop the pieces.
 *
 * Memory: on a 4 GB iPhone 12 the app was killed here, every time (a tester,
 * 2026-11-22). The join used to run as one synchronous loop, then hash the
 * joined 1.1 GB model in a single native call; neither let iOS free the chunks
 * it read until the end, and the simulator measured 112 MB -> 2.76 GB. Now each
 * chunk is followed by a turn of the run loop, which frees it, and instead of
 * hashing the whole file each piece is hashed again on its own (~100 MB) just
 * before it is copied. The pieces are the published pieces, byte for byte, and
 * the joined file must come out at the published size, so this checks as much
 * as the whole-file hash did.
 */
const JOIN_CHUNK = 8 * 1024 * 1024;
/** One turn of the run loop: lets iOS free what the last native call read. */
const breathe = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });
async function joinParts(f: BundleFile, signal: AbortSignal): Promise<void> {
  const parts = f.parts!;
  const dropPieces = (): void => {
    for (let i = 0; i < parts.length; i++) { const p = partFile(f, i); if (p.exists) p.delete(); }
  };
  for (const [i, part] of parts.entries()) {
    if (signal.aborted) throw new Error('Download cancelled.');
    const piece = partFile(f, i);
    const info = piece.info({ md5: true });
    if (info.size !== part.bytes || info.md5 !== part.md5) {
      piece.delete();
      throw new Error(`${f.path} arrived damaged. Try again.`);
    }
    await breathe();
  }
  const final = target(f.path);
  const joined = new File(final.parentDirectory, `${final.name}.partial`);
  if (joined.exists) joined.delete();
  joined.create();
  const out = joined.open(FileMode.Truncate);
  try {
    for (const [i, part] of parts.entries()) {
      const src = partFile(f, i).open(FileMode.ReadOnly);
      try {
        for (let left = part.bytes; left > 0; left -= JOIN_CHUNK) {
          out.writeBytes(src.readBytes(Math.min(JOIN_CHUNK, left)));
          await breathe();
        }
      } finally { src.close(); }
    }
  } finally { out.close(); }
  if (joined.size !== f.bytes) {
    // The pieces each checked out, so the join went wrong: start the file over.
    joined.delete();
    dropPieces();
    throw new Error(`${f.path} could not be put together. Try again.`);
  }
  if (final.exists) final.delete();
  joined.move(final);
  dropPieces();
}

/** Remove a state's downloaded files, to free space. The plant and animal pack goes with it. */
export function removeState(bundle: StateBundle): void {
  for (const f of bundle.files) {
    const file = target(f.path);
    if (file.exists) file.delete();
    (f.parts ?? []).forEach((_, i) => { const p = partFile(f, i); if (p.exists) p.delete(); });
  }
  for (const dir of new Set(bundle.files.filter((f) => f.path.includes('/')).map((f) => f.path.slice(0, f.path.lastIndexOf('/'))))) {
    const d = new Directory(Paths.document, ...dir.split('/'));
    if (d.exists && d.list().length === 0) d.delete();
  }
}

/**
 * Where a place stands (#224). Whether it is installed is judged by its own
 * files: a region is not "partly downloaded" just because its state's guide
 * arrived with a neighbour. What is left counts everything its download
 * would fetch, the state-wide part and the overview included.
 */
export function placeState(idx: MapIndex, key: string):
  { readonly status: InstallState; readonly left: number; readonly bytes: number } | undefined {
  const full = placeBundle(idx, key);
  const own = regionOnly(idx, key) ?? idx.states[splitKey(key).state];
  if (full === undefined || own === undefined) return undefined;
  return { status: installState(own), left: remainingBytes(full), bytes: own.bytes };
}

/**
 * Remove a place to free space. A region takes its own files, and the
 * state-wide part too once no region of that state is left. The nationwide
 * overview stays: it is small, and it is what keeps the map from going blank.
 */
export function removePlace(idx: MapIndex, key: string): void {
  const { state, region } = splitKey(key);
  if (region === null) {
    const whole = idx.states[state];
    if (whole !== undefined) removeState(whole);
    return;
  }
  const own = regionOnly(idx, key);
  if (own !== undefined) removeState(own);
  const split = idx.regions?.[state];
  if (split === undefined) return;
  const othersLeft = placesOf(idx, state).some((k) => k !== key && installState(regionOnly(idx, k)!) !== 'none');
  if (!othersLeft) removeState(split.base);
}
