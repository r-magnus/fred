/**
 * The offline-maps panel on the map screen (issue #26): see which states are
 * on the phone, download one, cancel, or remove one to free space.
 *
 * Your own state is listed first. Sizes are shown before anything starts,
 * because a state is 20 MB to 1.3 GB and a hiker may be on mobile data.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { STATE_NAMES } from '@fred/rag-core';
import {
  downloadState, fetchIndex, installState, remainingBytes, removeState,
  type MapIndex, type Progress,
} from './map-downloads.ts';
import { CalmLoader } from './calm-loader.tsx';
import { orderStates, size } from './setup-plan.ts';
import { radius, useThemed, type Palette } from './theme.tsx';

export function MapDownloads(
  { here, onClose, onChanged }: { here: string | null; onClose: () => void; onChanged: () => void },
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
    downloadState(idx, state, setProgress, ctrl.signal)
      .then(() => onChanged())
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => { setBusy(null); setProgress(null); abort.current = null; setTick((t) => t + 1); });
  }, [idx, onChanged]);

  const states = idx === null ? [] : orderStates(Object.keys(idx.states), here, STATE_NAMES);

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
        Download on Wi-Fi if you can.
      </Text>
      {error !== null && <Text style={styles.error}>{error}</Text>}
      {idx === null && error === null && <CalmLoader size={40} style={styles.loading} />}
      <ScrollView style={styles.list}>
        {states.map((s) => {
          const bundle = idx!.states[s]!;
          const status = installState(bundle);
          const left = remainingBytes(bundle);
          const mine = busy === s;
          return (
            <View key={s} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{STATE_NAMES[s] ?? s}{s === here ? '  · you are here' : ''}</Text>
                <Text style={styles.meta}>
                  {mine && progress !== null
                    ? `${size(progress.done)} of ${size(progress.total)}`
                    : status === 'installed' ? `On this phone · ${size(bundle.bytes)}`
                    : status === 'partial' ? `Partly downloaded · ${size(left)} to go`
                    : size(bundle.bytes)}
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
                  accessibilityLabel={`Pause the ${STATE_NAMES[s] ?? s} download`}>
                  <Text style={styles.action}>Pause</Text>
                </Pressable>
              ) : status === 'installed' ? (
                <Pressable disabled={busy !== null} style={[styles.outline, confirm === s && styles.outlineWarn]}
                  accessibilityRole="button" accessibilityState={{ disabled: busy !== null }}
                  accessibilityLabel={confirm === s ? `Remove the ${STATE_NAMES[s] ?? s} map now` : `Remove the ${STATE_NAMES[s] ?? s} map`}
                  onPress={() => {
                    // Asks first, like Download: a mis-tap out of signal can't be undone.
                    if (confirm !== s) { setConfirm(s); return; }
                    setConfirm(null);
                    removeState(bundle); onChanged(); setTick((t) => t + 1);
                  }}>
                  <Text style={[styles.remove, busy !== null && styles.dim]}>{confirm === s ? 'Remove now' : 'Remove'}</Text>
                </Pressable>
              ) : (
                <Pressable disabled={busy !== null} style={[styles.filled, busy !== null && styles.dim]}
                  accessibilityRole="button" accessibilityState={{ disabled: busy !== null }}
                  onPress={() => (confirm === s ? start(s) : setConfirm(s))}>
                  <Text style={styles.filledText}>
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
