/**
 * The offline-maps panel on the map screen (issue #26): see which states are
 * on the phone, download one, cancel, or remove one to free space.
 *
 * Your own state is listed first. Sizes are shown before anything starts,
 * because a state is 20 MB to 1.3 GB and a hiker may be on mobile data.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { STATE_NAMES } from '@fred/rag-core';
import {
  downloadState, fetchIndex, installState, remainingBytes, removeState,
  type MapIndex, type Progress,
} from './map-downloads.ts';

const size = (b: number): string => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`);

export function MapDownloads(
  { here, onClose, onChanged }: { here: string | null; onClose: () => void; onChanged: () => void },
): React.JSX.Element {
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

  const states = idx === null ? [] : Object.keys(idx.states).sort((a, b) =>
    (a === here ? -1 : b === here ? 1 : (STATE_NAMES[a] ?? a).localeCompare(STATE_NAMES[b] ?? b)));

  return (
    <View style={styles.panel}>
      <View style={styles.head}>
        <Text style={styles.title}>Offline maps</Text>
        <Pressable onPress={onClose} hitSlop={12} disabled={busy !== null}>
          <Text style={[styles.close, busy !== null && styles.dim]}>Done</Text>
        </Pressable>
      </View>
      <Text style={styles.hint}>
        Each state has its map, contour lines, cell coverage and plant and animal guide.
        Download on Wi-Fi if you can.
      </Text>
      {error !== null && <Text style={styles.error}>{error}</Text>}
      {idx === null && error === null && <ActivityIndicator color="#6ca" style={{ marginVertical: 16 }} />}
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
                <Pressable onPress={() => abort.current?.abort()} hitSlop={8}>
                  <Text style={styles.action}>Cancel</Text>
                </Pressable>
              ) : status === 'installed' ? (
                <Pressable disabled={busy !== null} hitSlop={8}
                  onPress={() => {
                    // Asks first, like Download: a mis-tap out of signal can't be undone.
                    if (confirm !== s) { setConfirm(s); return; }
                    setConfirm(null);
                    removeState(bundle); onChanged(); setTick((t) => t + 1);
                  }}>
                  <Text style={[styles.remove, busy !== null && styles.dim]}>{confirm === s ? 'Remove now' : 'Remove'}</Text>
                </Pressable>
              ) : (
                <Pressable disabled={busy !== null} hitSlop={8}
                  onPress={() => (confirm === s ? start(s) : setConfirm(s))}>
                  <Text style={[styles.action, busy !== null && styles.dim]}>{confirm === s ? 'Start' : 'Download'}</Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute', top: 100, bottom: 30, left: 12, right: 12,
    backgroundColor: '#161b1e', borderRadius: 14, borderWidth: 1, borderColor: '#2a3a35', padding: 14,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: '#e6edf3', fontSize: 17, fontWeight: '700' },
  close: { color: '#6ca', fontSize: 14, fontWeight: '600' },
  hint: { color: '#8b9a96', fontSize: 12, lineHeight: 17, marginTop: 6, marginBottom: 8 },
  error: { color: '#e88', fontSize: 13, marginBottom: 8 },
  list: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#22302b' },
  name: { color: '#e6edf3', fontSize: 14 },
  meta: { color: '#8b9a96', fontSize: 12, marginTop: 2 },
  confirm: { color: '#e0c98a', fontSize: 12, marginTop: 4 },
  bar: { height: 4, backgroundColor: '#22302b', borderRadius: 2, marginTop: 6, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: '#4fd1a5' },
  action: { color: '#6ca', fontSize: 14, fontWeight: '600' },
  remove: { color: '#d99', fontSize: 13 },
  dim: { opacity: 0.4 },
});
