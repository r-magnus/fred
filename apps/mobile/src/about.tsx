/**
 * About Fred (#209): what he does, why he exists, and who he is named for.
 * Opened by tapping the logo, closed by tapping it again or the X.
 * Facts here come from the project README (§02 Overview and Motivation);
 * keep them in step with it.
 *
 * The page sits at sunset. It comes in the way day turns to night: the sky
 * eases to sunset colours while the dusk veil covers the page, the page
 * changes under the veil, and the veil lifts. Closing runs it backwards. It
 * lies over the chat rather than replacing it, so the chat is as it was.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, BackHandler, Easing, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReduceMotion } from './motion.ts';
import { Scene } from './scene.tsx';
import { Crossfade, SUNSET, VEIL_COLOUR, Veil, radius, useThemed, type Palette } from './theme.tsx';

const LOGO = require('../assets/ui/fred-logo.png');
const LOGO_RATIO = 900 / 415;
const JOURNAL = Platform.select({ ios: 'Georgia', default: 'serif' });
/** About as long as a tap on the sun takes to turn day to night. */
const CHANGE_MS = 900;

const SECTIONS: readonly { readonly heading: string; readonly text: readonly string[] }[] = [
  {
    heading: 'What he does',
    text: [
      'Fred answers questions about first aid, survival, and the plants and animals around you. ' +
        'Everything he knows is stored on this phone, so he works without signal, and nothing you ask leaves it.',
      'He shows the sources he read, says so when something isn’t in his guides, and is no substitute for your own judgement.',
    ],
  },
  {
    heading: 'Why he exists',
    text: [
      'Out in the wild, signal is patchy and questions like “how do I start a fire?” or “I cut myself, what do I do?” ' +
        'often have no one to answer them. Fred is a steady companion for those moments: a small AI that runs entirely on your phone.',
      'He is Ryan Magnuson’s senior project for CS-195 at Westmont College, Fall 2026.',
    ],
  },
  {
    heading: 'His name',
    text: [
      'Fred is named for Ryan’s grandfather, Fred James, who served 45 years with the USDA Forest Service. ' +
        'Ryan still remembers the maps he made, hung on the walls of his home in Wisconsin.',
    ],
  },
];

export function AboutScreen(
  { open, onClose, skyHeight, row, logoHeight }: {
    open: boolean;
    onClose: () => void;
    /** The chat's sky, status bar included: the same here, so only its colours change. */
    skyHeight: number;
    /** The line below the status bar that the top controls are centred on, as on the chat. */
    row: number;
    logoHeight: number;
  },
): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const { palette, styles } = useThemed(makeStyles);
  const still = useReduceMotion();
  // 0 is the chat, 1 is this page. Kept on screen until the closing change has finished.
  const p = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(open);

  useEffect(() => {
    if (open) setShown(true);
    const run = Animated.timing(p, {
      toValue: open ? 1 : 0, duration: still ? 0 : CHANGE_MS,
      easing: Easing.inOut(Easing.cubic), useNativeDriver: true,
    });
    run.start(({ finished }) => { if (finished && !open) setShown(false); });
    return () => run.stop();
  }, [open, still, p]);

  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [open, onClose]);

  const fx = useMemo(() => ({
    // The sky eases across the whole change; the page swaps half way, under the veil.
    sky: p,
    page: p.interpolate({ inputRange: [0, 0.48, 0.52, 1], outputRange: [0, 0, 1, 1] }),
    // Full for a stretch either side of half way, as in the day-night change (theme.tsx `veiled`).
    veil: p.interpolate({ inputRange: [0, 0.38, 0.62, 1], outputRange: [0, 1, 1, 0] }),
  }), [p]);

  if (!open && !shown) return null;
  const page = palette.night ? SUNSET.night.page : SUNSET.day.page;

  return (
    <View style={styles.root} pointerEvents={open ? 'auto' : 'none'} accessibilityViewIsModal>
      <Animated.View style={[styles.page, { top: skyHeight, backgroundColor: page, opacity: fx.page }]} needsOffscreenAlphaCompositing>
        <Animated.ScrollView contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + 28 }]}>
          <View style={styles.titleRow}>
            <Text style={styles.title} accessibilityRole="header">About Fred</Text>
            <Pressable onPress={onClose} hitSlop={10} style={styles.close} accessibilityRole="button" accessibilityLabel="Close About Fred">
              <View style={[styles.closeLine, { transform: [{ rotate: '45deg' }] }]} />
              <View style={[styles.closeLine, { transform: [{ rotate: '-45deg' }] }]} />
            </Pressable>
          </View>
          {SECTIONS.map((s) => (
            <View key={s.heading} style={styles.section}>
              <Text style={styles.heading} accessibilityRole="header">{s.heading}</Text>
              {s.text.map((t) => <Text key={t} style={styles.body}>{t}</Text>)}
            </View>
          ))}
        </Animated.ScrollView>
      </Animated.View>

      {/* The dusk veil over the page only: the sky stays in sight while it turns. */}
      <Animated.View pointerEvents="none"
        style={[styles.page, { top: skyHeight, backgroundColor: VEIL_COLOUR, opacity: fx.veil }]} />

      {/* Faded as one picture: Android otherwise fades each layer of the sky on
          its own, and the night colour under them shows through as grey. */}
      <Animated.View style={[styles.sky, { opacity: fx.sky }]} needsOffscreenAlphaCompositing renderToHardwareTextureAndroid>
        <Scene height={skyHeight} top={insets.top} sunset>
          {/* The logo where it is on the chat: tapped there to open this page, tapped again to close it. */}
          <View style={[styles.header, { top: insets.top + row - logoHeight / 2, height: logoHeight }]} pointerEvents="box-none">
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Fred. Close About Fred">
              <Crossfade render={(c) => (
                <Image source={LOGO} resizeMode="contain"
                  style={{ height: logoHeight, width: logoHeight * LOGO_RATIO, tintColor: c.logo }} />
              )} />
            </Pressable>
          </View>
        </Scene>
      </Animated.View>
      {/* The day-night change still works from this page's sky. */}
      <Veil />
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  // Over the chat, its side tab and its drawer.
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20 },
  sky: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2 },
  page: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  // Centred on `row`, the logo at the right as on the chat.
  header: {
    position: 'absolute', left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingHorizontal: 18,
  },
  inner: { paddingHorizontal: 20, paddingTop: 12, gap: 28 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  // A round close button level with the title; the X is two crossed strokes.
  close: {
    width: 36, height: 36, borderRadius: radius.pill, backgroundColor: palette.night ? '#3D3245' : '#F5DCCF',
    alignItems: 'center', justifyContent: 'center',
  },
  closeLine: { position: 'absolute', width: 14, height: 2, borderRadius: 1, backgroundColor: palette.ink },
  title: { flexShrink: 1, fontFamily: JOURNAL, color: palette.ink, fontSize: 30, lineHeight: 38 },
  section: { gap: 10 },
  heading: { color: palette.pine, fontSize: 11, fontWeight: '700', letterSpacing: 0.9, textTransform: 'uppercase' },
  body: { color: palette.ink, fontSize: 16, lineHeight: 24 },
});
