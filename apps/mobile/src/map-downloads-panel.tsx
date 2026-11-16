/**
 * The offline-maps panel on the map screen (issue #26): see which states are
 * on the phone, download one, cancel, or remove one to free space.
 *
 * A state split into regions (#224) is listed as its name with its regions
 * under it, each downloaded or removed on its own. Your own state is listed
 * first, and your own region first within it. Sizes are shown before
 * anything starts, because a state is 20 MB to 1.3 GB and a hiker may be on
 * mobile data.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { STATE_NAMES } from '@fred/rag-core';
import {
  downloadBundle, fetchIndex, placeState, removePlace,
  type MapIndex, type Progress,
} from './map-downloads.ts';
import { detailOnPhone } from './map-files.ts';
import { orderPlaces, placeBundle, placeName } from './places.ts';
import { placeKey, regionAt, splitKey } from './regions.ts';
import { CalmLoader } from './calm-loader.tsx';
import { orderStates, size } from './setup-plan.ts';
import { radius, useThemed, type Palette } from './theme.tsx';

export function MapDownloads(
  { here, at = null, onClose, onChanged }: {
    here: string | null;
    /** Where the hiker is, to put their own region first. */
    at?: { readonly latitude: number; readonly longitude: number } | null;
    onClose: () => void; onChanged: () => void;
  },
): React.JSX.Element {
  const { styles } = useThemed(makeStyles);
  const [idx, setIdx] = useState<MapIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  // Re-read install states from disk after each change.
  const [, setTick] = useState(0);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchIndex(ctrl.signal).then(setIdx).catch((e: unknown) => {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    });
    return () => ctrl.abort();
  }, []);
  useEffect(() => () => abort.current?.abort(), []);

  const start = useCallback((state: string) => {
    if (idx === null) return;
    setConfirm(null);
    setError(null);
    setBusy(state);
    setProgress(null);
    const ctrl = new AbortController();
    abort.current = ctrl;
    const bundle = placeBundle(idx, state);
    if (bundle === undefined) { setBusy(null); return; }
    downloadBundle(idx, bundle, setProgress, ctrl.signal)
      .then(() => onChanged())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => { setBusy(null); setProgress(null); abort.current = null; setTick((t) => t + 1); });
  }, [idx, onChanged]);

  const states = idx === null ? [] : orderStates(Object.keys(idx.states), here, STATE_NAMES);
  const outline = here === null ? undefined : idx?.regions?.[here]?.outline;
  const have = detailOnPhone();
  const hereRegion = outline === undefined || at === null || here === null ? null
    : (() => { const r = regionAt(outline, at.longitude, at.latitude); return r === null ? null : placeKey(here, r.id); })();
  // A split state is a heading with its regions under it. A whole-state map
  // downloaded before the split is still listed, so it can be removed.
  const rows: ({ readonly kind: 'head'; readonly state: string } | { readonly kind: 'place'; readonly key: string; readonly older?: boolean })[] =
    idx === null ? [] : orderPlaces(idx, states, hereRegion).flatMap((key, i, all) => {
      const { state, region } = splitKey(key);
      if (region === null) return [{ kind: 'place' as const, key }];
      const first = i === 0 || splitKey(all[i - 1]!).state !== state;
      // Judged by its own map file: the state-wide part of the new download
      // shares the guide and coverage files with it, which made it look half there.
      const older = first && have.has(state);
      return [
        ...(first ? [{ kind: 'head' as const, state }] : []),
        ...(older ? [{ kind: 'place' as const, key: state, older: true }] : []),
        { kind: 'place' as const, key },
      ];
    });

  return (
    <View style={styles.panel}>
      <View style={styles.head}>
        <Text style={styles.title}>Offline maps</Text>
        <Pressable onPress={onClose} disabled={busy !== null} style={styles.done} accessibilityRole="button"
          accessibilityState={{ disabled: busy !== null }}>
          <Text style={[styles.close, busy !== null && styles.dim]}>Done</Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>
        Each state has its map, contour lines, cell coverage and plant and animal guide.
        Big states come in regions, so you can take just the part you walk in.
        Download on Wi-Fi if you can.
      </Text>
      {error !== null && <Text style={styles.error}>{error}</Text>}
      {idx === null && error === null && <CalmLoader size={40} style={styles.loading} />}
      <ScrollView style={styles.list}>
        {rows.map((row) => {
          if (row.kind === 'head') {
            return (
              <Text key={`head-${row.state}`} style={styles.head2} accessibilityRole="header">
                {STATE_NAMES[row.state] ?? row.state}
              </Text>
            );
          }
          const s = row.key;
          const where = placeState(idx!, s);
          if (where === undefined) return null;
          const { status, left, bytes } = where;
          const mine = busy === s;
          const inRegion = splitKey(s).region !== null;
          const name = row.older ? `${STATE_NAMES[s] ?? s}, whole state (older download)` : placeName(idx, s, STATE_NAMES);
          // Said once: on your region in a split state, else on your state.
          const youAreHere = row.older === true ? false : inRegion ? s === hereRegion : s === here;
          return (
            <View key={s} style={[styles.row, inRegion && styles.rowRegion]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{name}{youAreHere ? '  · you are here' : ''}</Text>
                <Text style={styles.meta}>
                  {mine && progress !== null
                    ? `${size(progress.done)} of ${size(progress.total)}`
                    : status === 'installed' ? `On this phone · ${size(bytes)}`
                    : status === 'partial' ? `Partly downloaded · ${size(left)} to go`
                    : size(left)}
                </Text>
                {mine && progress !== null && (
                  <View style={styles.bar}><View style={[styles.fill, { width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }]} /></View>
                )}
                {confirm === s && (
                  <Text style={styles.confirm}>
                    {status === 'installed'
                      ? 'Remove this map? Getting it back needs signal. Tap again to remove.'
                      : `Download ${size(left)}? Tap again to start.`}
                  </Text>
                )}
              </View>
              {mine ? (
                // Iteration 4: what arrived is kept (it shows as "Partly downloaded"), so this
                // pauses rather than cancels, in the setup wizard's words.
                <Pressable onPress={() => abort.current?.abort()} style={styles.outline} accessibilityRole="button"
                  accessibilityLabel={`Pause the ${name} download`}>
                  <Text style={styles.action}>Pause</Text>
                </Pressable>
              ) : status === 'installed' ? (
                <Pressable disabled={busy !== null} style={[styles.outline, confirm === s && styles.outlineWarn]}
                  accessibilityRole="button" accessibilityState={{ disabled: busy !== null }}
                  accessibilityLabel={confirm === s ? `Remove the ${name} map now` : `Remove the ${name} map`}
                  onPress={() => {
                    // Asks first, like Download: a mis-tap out of signal can't be undone.
                    if (confirm !== s) { setConfirm(s); return; }
                    setConfirm(null);
                    removePlace(idx!, s); onChanged(); setTick((t) => t + 1);
                  }}>
                  <Text style={[styles.remove, busy !== null && styles.dim]}>{confirm === s ? 'Remove now' : 'Remove'}</Text>
                </Pressable>
              ) : row.older ? null : (
                // Outlined until it asks to start: fifty filled buttons in a column shouted.
                <Pressable disabled={busy !== null} style={[confirm === s ? styles.filled : styles.outline, busy !== null && styles.dim]}
                  accessibilityRole="button" accessibilityState={{ disabled: busy !== null }}
                  accessibilityLabel={confirm === s ? `Start downloading ${name}` : `Download ${name}, ${size(left)}`}
                  onPress={() => (confirm === s ? start(s) : setConfirm(s))}>
                  <Text style={confirm === s ? styles.filledText : styles.action}>
                    {confirm === s ? 'Start' : status === 'partial' ? 'Resume' : 'Download'}
                  </Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  panel: {
    position: 'absolute', top: 100, bottom: 30, left: 12, right: 12,
    backgroundColor: palette.paper, borderRadius: radius.card, borderWidth: 1, borderColor: palette.sand, padding: 16,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: palette.ink, fontSize: 17, fontWeight: '700' },
  // Buttons look like buttons and are 48 dp tall (ux-ui-review: touch targets, affordance).
  done: { minHeight: 48, minWidth: 64, justifyContent: 'center', alignItems: 'flex-end' },
  close: { color: palette.pine, fontSize: 15, fontWeight: '700' },
  hint: { color: palette.moss, fontSize: 13, lineHeight: 19, marginTop: 6, marginBottom: 8 },
  error: { color: palette.clay, fontSize: 13, marginBottom: 8 },
  loading: { alignSelf: 'center', marginVertical: 16 },
  list: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: palette.sand },
  name: { color: palette.ink, fontSize: 15 },
  // A split state's name, over its regions.
  head2: { color: palette.ink, fontSize: 16, fontWeight: '700', paddingTop: 14, paddingBottom: 2, borderTopWidth: 1, borderTopColor: palette.sand },
  rowRegion: { paddingLeft: 12, borderTopColor: palette.oat },
  meta: { color: palette.moss, fontSize: 13, marginTop: 2 },
  confirm: { color: palette.amber, fontSize: 13, lineHeight: 18, marginTop: 4 },
  bar: { height: 6, backgroundColor: palette.oat, borderRadius: 3, marginTop: 6, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: palette.leaf },
  action: { color: palette.pine, fontSize: 14, fontWeight: '700' },
  filled: { minHeight: 48, minWidth: 96, paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: palette.pine, alignItems: 'center', justifyContent: 'center' },
  filledText: { color: palette.paper, fontSize: 14, fontWeight: '700' },
  outline: { minHeight: 48, minWidth: 96, paddingHorizontal: 16, borderRadius: radius.pill, borderWidth: 1.5, borderColor: palette.sand, alignItems: 'center', justifyContent: 'center' },
  outlineWarn: { borderColor: palette.clay, backgroundColor: palette.blush },
  remove: { color: palette.clay, fontSize: 14, fontWeight: '600' },
  dim: { opacity: 0.4 },
});
