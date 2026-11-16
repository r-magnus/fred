/**
 * One region's download, offered from the map (#224): tapping a region that
 * is not on the phone, or the button under the edge warning, opens this card
 * at the foot of the map in place of the sheet.
 *
 * Its size is shown before anything starts, and whether the phone has room
 * (ux-ui-review, states). A pause keeps what arrived, like everywhere else;
 * a failure says why in plain words and offers to try again.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Paths } from 'expo-file-system';
import { STATE_NAMES } from '@fred/rag-core';
import { downloadBundle, fetchIndex, remainingBytes, type MapIndex, type Progress } from './map-downloads.ts';
import { placeBundle, placeName } from './places.ts';
import { splitKey } from './regions.ts';
import { CalmLoader } from './calm-loader.tsx';
import { size } from './setup-plan.ts';
import { radius, useThemed, type Palette } from './theme.tsx';

const JOURNAL = Platform.select({ ios: 'Georgia', default: 'serif' });

export function RegionOffer(
  { place, onClose, onInstalled }: {
    /** "CA/bay" */
    place: string;
    onClose: () => void;
    /** After the download, so the map reads the new files. */
    onInstalled: () => void;
  },
): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { styles } = useThemed(makeStyles);
  const [idx, setIdx] = useState<MapIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [again, setAgain] = useState(0);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setError(null);
    fetchIndex(ctrl.signal).then(setIdx).catch((e: unknown) => {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    });
    return () => ctrl.abort();
  }, [again]);
  useEffect(() => () => abort.current?.abort(), []);

  const { state } = splitKey(place);
  const bundle = idx === null ? undefined : placeBundle(idx, place);
  const left = bundle === undefined ? 0 : remainingBytes(bundle);
  // The first region of a state brings the state's guide with it: say so, so the size isn't a surprise.
  const withGuide = idx?.regions?.[state] !== undefined && remainingBytes(idx.regions[state]!.base) > 0;
  const name = placeName(idx, place, STATE_NAMES);
  const roomy = Paths.availableDiskSpace >= left * 1.1;

  const start = useCallback(() => {
    if (idx === null || bundle === undefined) return;
    setError(null);
    setBusy(true);
    setProgress(null);
    const ctrl = new AbortController();
    abort.current = ctrl;
    downloadBundle(idx, bundle, setProgress, ctrl.signal)
      .then(() => { onInstalled(); onClose(); })
      .catch((e: unknown) => setError(ctrl.signal.aborted ? 'Paused. What arrived is kept.' : e instanceof Error ? e.message : String(e)))
      .finally(() => { setBusy(false); abort.current = null; });
  }, [idx, bundle, onInstalled, onClose]);

  return (
    <View style={[styles.card, { paddingBottom: insets.bottom + 14 }]} accessibilityViewIsModal>
      <Text style={styles.title} accessibilityRole="header">{name}</Text>
      <Text style={styles.body}>The detailed map for this part of {STATE_NAMES[state] ?? state}: trails, forest roads and contour lines.</Text>

      {idx === null && error === null && (
        <View style={styles.row}><CalmLoader size={28} /><Text style={styles.meta}>Checking the size…</Text></View>
      )}
      {idx !== null && bundle === undefined && (
        <Text style={styles.body}>This region can&apos;t be downloaded yet.</Text>
      )}
      {bundle !== undefined && !busy && (
        <>
          <Text style={styles.size}>
            {size(left)}{withGuide ? `, with the ${STATE_NAMES[state] ?? state} plant and animal guide` : ''}. Wi-Fi is best.
          </Text>
          {!roomy && <Text style={styles.caution}>This phone has {size(Paths.availableDiskSpace)} free, which isn&apos;t enough. Free up some space first.</Text>}
        </>
      )}
      {busy && (
        <View accessibilityRole="progressbar" accessibilityLiveRegion="polite"
          accessibilityValue={{ min: 0, max: 100, now: progress === null ? 0 : Math.round((progress.done / Math.max(1, progress.total)) * 100) }}>
          <View style={styles.bar}>
            <View style={[styles.fill, { width: `${progress === null ? 0 : Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }]} />
          </View>
          <Text style={styles.meta}>{progress === null ? 'Starting…' : `${size(progress.done)} of ${size(progress.total)}`}</Text>
        </View>
      )}
      {error !== null && <Text style={styles.caution} accessibilityLiveRegion="polite">{error}</Text>}

      <View style={styles.buttons}>
        {/* Closing the card would stop the download with it, so while one runs the only way out is Pause. */}
        {!busy && (
          <Pressable style={styles.quiet} onPress={onClose} accessibilityRole="button">
            <Text style={styles.quietText}>Not now</Text>
          </Pressable>
        )}
        {busy ? (
          <Pressable style={styles.quiet} onPress={() => abort.current?.abort()} accessibilityRole="button"
            accessibilityLabel={`Pause the ${name} download`}>
            <Text style={styles.quietText}>Pause</Text>
          </Pressable>
        ) : idx === null && error !== null ? (
          <Pressable style={styles.go} onPress={() => setAgain((n) => n + 1)} accessibilityRole="button">
            <Text style={styles.goText}>Try again</Text>
          </Pressable>
        ) : bundle !== undefined && (
          <Pressable style={[styles.go, !roomy && styles.dim]} disabled={!roomy} onPress={start} accessibilityRole="button"
            accessibilityState={{ disabled: !roomy }} accessibilityLabel={`Download ${name}, ${size(left)}`}>
            <Text style={styles.goText}>{error !== null ? 'Resume' : `Download ${size(left)}`}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  // Sits where the map's sheet sits, with the same shape, so it reads as the sheet changing.
  card: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: palette.paper, borderTopLeftRadius: 26, borderTopRightRadius: 26,
    paddingHorizontal: 20, paddingTop: 20,
    boxShadow: `0 -4 18 ${palette.shade}`,
  },
  title: { fontFamily: JOURNAL, color: palette.ink, fontSize: 22 },
  body: { color: palette.ink, fontSize: 15, lineHeight: 22, marginTop: 8 },
  size: { color: palette.ink, fontSize: 15, lineHeight: 22, marginTop: 10, fontWeight: '700' },
  meta: { color: palette.moss, fontSize: 13, marginTop: 4 },
  caution: {
    color: palette.amber, backgroundColor: palette.butter, fontSize: 13, lineHeight: 18,
    borderRadius: radius.control, paddingHorizontal: 12, paddingVertical: 8, marginTop: 10, overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  bar: { height: 6, backgroundColor: palette.oat, borderRadius: 3, marginTop: 14, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: palette.leaf },
  // The main action on the right, under the thumb; both 48 dp tall.
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
  go: {
    minHeight: 48, justifyContent: 'center', backgroundColor: palette.pine,
    borderRadius: radius.pill, paddingHorizontal: 20,
  },
  goText: { color: palette.paper, fontSize: 15, fontWeight: '700' },
  quiet: {
    minHeight: 48, justifyContent: 'center', borderRadius: radius.pill, paddingHorizontal: 18,
    borderWidth: 1.5, borderColor: palette.sand,
  },
  quietText: { color: palette.pine, fontSize: 15, fontWeight: '700' },
  dim: { opacity: 0.4 },
});
