/**
 * What Fred is doing while an answer is on its way (ux-ui-review: loading
 * says what is happening; an AI answer shows its progress by step).
 *
 * Two honest steps, the ones the app can see: before the first words Fred is
 * reading the guides (working out the question and searching them); after
 * the opening line the model is writing. A slow phone can sit on either for
 * a while, so after STILL_MS a calm second line says it hasn't stalled. No
 * time estimate: Fred has no reliable one, and a wrong number is worse than
 * none.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CalmLoader } from './calm-loader.tsx';
import { useThemed, type Palette } from './theme.tsx';

export type WaitStep = 'reading' | 'writing';

const LABEL: Record<WaitStep, string> = {
  reading: 'Reading the guides…',
  writing: 'Writing your answer…',
};
/** How long one step runs before Fred says he's still at it. */
export const STILL_MS = 12_000;

export function WaitLine({ step, size = 24 }: { step: WaitStep; size?: number }): React.JSX.Element {
  const { styles } = useThemed(makeStyles);
  const [still, setStill] = useState(false);
  // Each step gets its own allowance before the reassurance.
  useEffect(() => {
    setStill(false);
    const t = setTimeout(() => setStill(true), STILL_MS);
    return () => clearTimeout(t);
  }, [step]);
  return (
    <View style={styles.row} accessibilityRole="progressbar" accessibilityLiveRegion="polite"
      accessibilityLabel={still ? `${LABEL[step]} Still with you.` : LABEL[step]}>
      <CalmLoader size={size} />
      <View style={styles.words}>
        <Text style={styles.label}>{LABEL[step]}</Text>
        {still && <Text style={styles.still}>Still with you. Some answers take a little longer.</Text>}
      </View>
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  words: { flexShrink: 1 },
  label: { color: palette.moss, fontSize: 14, fontStyle: 'italic' },
  still: { color: palette.moss, fontSize: 13, lineHeight: 18, marginTop: 2 },
});
