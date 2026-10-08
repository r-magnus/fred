/**
 * The waiting animation: the logo's pine grows one tier at a time, stands and
 * sways while a bird passes over it, fades, and grows again.
 *
 * It replaces the system spinner. An answer takes about 15 s on the phone and
 * a spinner reads as "stuck" long before that; something slow and alive reads
 * as "working, no hurry".
 *
 * Everything here moves by transform and opacity only, so the loop runs on the
 * native side and stays smooth while the JavaScript thread is busy with the
 * engine. Core Animated, no new native library: the pieces are plain images
 * (scripts/build-ui-glyphs.mjs) tinted here. Nothing is stretched: a piece
 * rises a little and fades in at its own shape.
 */
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useReduceMotion } from './motion.ts';
import { useThemed, type Palette } from './theme.tsx';

/** The tree from the ground up, with when each piece arrives (fractions of a loop). */
const PIECES = [
  { source: require('../assets/ui/tree-trunk.png'), tint: 'bark', from: 0.02, to: 0.1 },
  { source: require('../assets/ui/tree-low.png'), tint: 'fir', from: 0.08, to: 0.22 },
  { source: require('../assets/ui/tree-mid.png'), tint: 'grove', from: 0.2, to: 0.34 },
  { source: require('../assets/ui/tree-top.png'), tint: 'leaf', from: 0.32, to: 0.46 },
] as const;
const GULL = require('../assets/ui/gull.png');

const LOOP_MS = 4200;
/** The grown tree leaves between these, all at once. */
const FADE = [0.84, 0.96] as const;

export function CalmLoader(
  { size = 28, style }: { size?: number; style?: StyleProp<ViewStyle> },
): React.JSX.Element {
  const { palette, styles } = useThemed(makeStyles);
  const loop = useRef(new Animated.Value(0)).current;
  // "Remove animations" in the phone's settings: the grown tree, standing still.
  const still = useReduceMotion();
  useEffect(() => {
    if (still) return;
    const run = Animated.loop(Animated.timing(loop, {
      toValue: 1, duration: LOOP_MS, easing: Easing.linear, useNativeDriver: true,
    }));
    run.start();
    return () => run.stop();
  }, [still, loop]);

  const box = { width: size, height: size };
  const at = (inputRange: number[], outputRange: number[]) =>
    loop.interpolate({ inputRange, outputRange, extrapolate: 'clamp' });

  return (
    // The wait is announced by whoever shows the loader; the tree is decoration.
    <View style={[box, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.ground, { width: size * 0.56, height: Math.max(2, size * 0.06), left: size * 0.22 }]} />
      <Animated.View style={[box, styles.tree, still ? null : {
        opacity: at([0, ...FADE, 1], [1, 1, 0, 0]),
        // A slow sway from the foot of the trunk once the tree has grown.
        transform: [{ rotate: loop.interpolate({
          inputRange: [0, 0.46, 0.56, 0.68, 0.8, 1], outputRange: ['0deg', '0deg', '2.5deg', '-2.5deg', '0deg', '0deg'],
        }) }],
      }]}>
        {PIECES.map((p, i) => (
          <Animated.Image key={i} source={p.source} resizeMode="contain"
            style={[styles.piece, box, { tintColor: palette[p.tint] }, still ? null : {
              opacity: at([p.from, p.to], [0, 1]),
              transform: [{ translateY: at([p.from, p.to], [size * 0.1, 0]) }],
            }]} />
        ))}
      </Animated.View>
      {!still && (
        <Animated.Image source={GULL} resizeMode="contain"
          style={[styles.gull, { width: size * 0.3, height: size * 0.17, tintColor: palette.sky,
            opacity: at([0.48, 0.54, 0.72, 0.8], [0, 1, 1, 0]),
            transform: [
              { translateX: at([0.48, 0.8], [-size * 0.1, size * 0.72]) },
              { translateY: at([0.48, 0.64, 0.8], [size * 0.12, 0, size * 0.08]) },
            ] }]} />
      )}
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  // The ground the tree stands on stays put, so the loader never looks empty.
  ground: { position: 'absolute', bottom: 0, borderRadius: 99, backgroundColor: palette.sage },
  tree: { transformOrigin: '50% 100%' },
  piece: { position: 'absolute', top: 0, left: 0 },
  gull: { position: 'absolute', top: 0, left: 0 },
});
