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
import { Directory, File, Paths } from 'expo-file-system';

export const INDEX_URL = 'https://raw.githubusercontent.com/r-magnus/fred-maps/main/index.json';

export interface BundleFile {
  readonly path: string;
  readonly asset: string;
  readonly bytes: number;
  readonly md5: string;
}
export interface StateBundle {
  readonly bytes: number;
  readonly files: readonly BundleFile[];
  readonly missing: readonly string[];
}
export interface MapIndex {
  readonly schemaVersion: number;
  readonly release: string;
  readonly baseUrl: string;
  readonly states: Readonly<Record<string, StateBundle>>;
}

/** The index format this build understands. A newer one is refused, not guessed at. */
const SCHEMA = 1;

export async function fetchIndex(signal?: AbortSignal): Promise<MapIndex> {
  const res = await fetch(INDEX_URL, signal === undefined ? {} : { signal });
  if (!res.ok) throw new Error(`Couldn't reach the map list (HTTP ${res.status}).`);
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

/** Bytes still to download for a state. */
export const remainingBytes = (bundle: StateBundle): number =>
  bundle.files.filter((f) => !present(f)).reduce((a, f) => a + f.bytes, 0);

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
  const todo = bundle.files.filter((f) => !present(f));
  const total = todo.reduce((a, f) => a + f.bytes, 0);
  if (Paths.availableDiskSpace < total + HEADROOM) {
    const gb = (b: number): string => (b / 1e9).toFixed(1);
    throw new Error(`Not enough space: this needs ${gb(total)} GB and the phone has ${gb(Paths.availableDiskSpace)} GB free.`);
  }
  let done = 0;
  for (const f of todo) {
    if (signal.aborted) throw new Error('Download cancelled.');
    const final = target(f.path);
    const parent = final.parentDirectory;
    if (!parent.exists) parent.create({ intermediates: true });
    const partial = new File(parent, `${final.name}.partial`);
    if (partial.exists) partial.delete();
    const task = File.createDownloadTask(`${idx.baseUrl}${f.asset}`, partial, {
      signal,
      onProgress: ({ bytesWritten }) => onProgress({ done: done + bytesWritten, total, file: f.path }),
    });
    try {
      await task.downloadAsync();
      const info = partial.info({ md5: true });
      if (info.size !== f.bytes || info.md5 !== f.md5) {
        throw new Error(`${f.path} arrived damaged. Try again.`);
      }
      if (final.exists) final.delete();
      partial.move(final);
    } catch (e) {
      if (partial.exists) partial.delete();
      throw signal.aborted ? new Error('Download cancelled.') : e;
    }
    done += f.bytes;
    onProgress({ done, total, file: f.path });
  }
}

/** Remove a state's downloaded files, to free space. The plant and animal pack goes with it. */
export function removeState(bundle: StateBundle): void {
  for (const f of bundle.files) {
    const file = target(f.path);
    if (file.exists) file.delete();
  }
  for (const dir of new Set(bundle.files.filter((f) => f.path.includes('/')).map((f) => f.path.slice(0, f.path.lastIndexOf('/'))))) {
    const d = new Directory(Paths.document, ...dir.split('/'));
    if (d.exists && d.list().length === 0) d.delete();
  }
}
