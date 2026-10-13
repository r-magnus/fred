/**
 * The decisions behind first-run setup (#196), kept apart from the screen and
 * from the phone's storage so they can be tested on the desktop.
 *
 * Setup has two downloads. The guides (the models and the packs that are the
 * same everywhere) are what Fred needs to answer at all. A state adds its map,
 * contour lines, cell coverage and plant and animal guide. Either may already
 * be on the phone, the list of downloads may be out of reach, and the guides
 * may not be published yet: each of those is a different thing to say.
 */

/** The wizard's pages, in order. */
export const STEPS = ['welcome', 'guides', 'place', 'sky', 'ready'] as const;
export type Step = typeof STEPS[number];

/** The page after this one, or before it; null at either end. */
export function stepFrom(step: Step, by: 1 | -1): Step | null {
  return STEPS[STEPS.indexOf(step) + by] ?? null;
}

/** A download's size as a hiker would say it: "64 MB", "1.3 GB". */
export const size = (bytes: number): string =>
  (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`);

/** The state the hiker is in first, then the rest by name. */
export function orderStates(
  codes: readonly string[], here: string | null, names: Readonly<Record<string, string>>,
): string[] {
  const name = (c: string): string => names[c] ?? c;
  return [...codes].sort((a, b) => (a === here ? -1 : b === here ? 1 : name(a).localeCompare(name(b))));
}

/** What the wizard knows of the list of downloads. */
export type IndexState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unreachable'; readonly message: string }
  | { readonly kind: 'loaded'; readonly coreBytesLeft: number | null };

/**
 * Where the guides page stands:
 * - `ready`: the guides are on the phone, nothing to do;
 * - `checking`: the list of downloads has not arrived yet;
 * - `offer`: they can be downloaded, and this is how much is left;
 * - `offline`: the list could not be reached;
 * - `unpublished`: the list has no guides in it, so only a cable can install them.
 *
 * Guides already on the phone are `ready` whatever the network says: a phone
 * set up at home must not be told it is offline on the trail.
 */
export type GuidesStatus =
  | { readonly kind: 'ready' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'offer'; readonly bytes: number }
  | { readonly kind: 'offline'; readonly message: string }
  | { readonly kind: 'unpublished' };

export function guidesStatus(onPhone: boolean, index: IndexState): GuidesStatus {
  if (onPhone) return { kind: 'ready' };
  if (index.kind === 'loading') return { kind: 'checking' };
  if (index.kind === 'unreachable') return { kind: 'offline', message: index.message };
  if (index.coreBytesLeft === null) return { kind: 'unpublished' };
  // Every file in place but the phone still says no: offer them again in full
  // rather than a download of nothing.
  return { kind: 'offer', bytes: index.coreBytesLeft };
}

/** The picked states still to fetch, in the order they will download, and their size together. */
export function queueFor(
  picked: ReadonlySet<string>, order: readonly string[], bytesLeft: (state: string) => number,
): { readonly states: string[]; readonly bytes: number } {
  const states = order.filter((s) => picked.has(s) && bytesLeft(s) > 0);
  return { states, bytes: states.reduce((a, s) => a + bytesLeft(s), 0) };
}

/** "California", "California and Oregon", "California, Oregon and Utah". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
