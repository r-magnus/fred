/**
 * About Fred (#209): what he does, why he exists, and who he is named for.
 * Opened by tapping the logo, closed by tapping it again or the X.
 * Facts here come from the project README (§02 Overview and Motivation);
 * keep them in step with it.
 *
 * The page sits at sunset. Opening it, the chat's own sky turns sunset
 * colours and the sun sinks low and warm behind the hills (scene.tsx, driven
 * by the same `p`), while the page below eases from cream to the sunset tint
 * and a light dusk veil passes over it as the words change. Closing runs it
 * all backwards. It lies over the chat rather than replacing it, so the chat
 * is as it was.
 */
import { useEffect, useMemo, useState } from 'react';
import { Animated, BackHandler, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReduceMotion } from './motion.ts';
import { SUNSET, VEIL_COLOUR, Veil, pageTurn, pageVeil, radius, useThemed, type Palette } from './theme.tsx';

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
  // Credits the sources need and the terms the models' licences ask to be passed on (#198,
  // docs/licensing.md). The full texts ship in the core download's licenses/ folder.
  {
    heading: 'Credits and terms',
    text: [
      'His guides come from US Government sources (US Army field manuals, the CDC, NIH, National Park Service, ' +
        'National Weather Service, Forest Service and others), WHO/ICRC Basic Emergency Care (2018, CC BY-NC-SA 3.0 IGO, ' +
        'used non-commercially) and Wikivoyage (CC BY-SA 4.0). Maps © OpenStreetMap contributors (ODbL); terrain from Mapterhorn.',
      'He writes his answers with Qwen3-1.7B by the Qwen team, under the Apache License 2.0.',
      'He searches his guides with Google’s EmbeddingGemma. Gemma is provided under and subject to the Gemma Terms of Use ' +
        'found at ai.google.dev/gemma/terms. By using Fred you agree not to use him, or Gemma, for anything the Gemma ' +
        'Prohibited Use Policy forbids (ai.google.dev/gemma/prohibited_use_policy).',
      'The full licences and terms come with Fred’s download, in its licenses folder.',
    ],
  },
];

export function AboutScreen(
  { open, onClose, p, skyHeight }: {
    open: boolean;
    onClose: () => void;
    /** 0 the chat, 1 this page. Shared with the chat's sky, which sets its sun by it. */
    p: Animated.Value;
    /** The chat's sky, status bar included: the page starts below it. */
    skyHeight: number;
  },
): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const { palette, styles } = useThemed(makeStyles);
  const still = useReduceMotion();
  // Kept on screen until the closing change has finished.
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
    // The backdrop eases over the first half, covering the chat by half way;
    // the sky goes on turning across the whole change.
    backdrop: pageTurn(p),
    // The words come in over the second half, so the chat's and these never show together.
    words: p.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, 0, 1] }),
    // A light dusk veil passes over half way, a nod to the day-night change.
    veil: pageVeil(p),
  }), [p]);

  if (!open && !shown) return null;
  const page = palette.night ? SUNSET.night.page : SUNSET.day.page;

  return (
    // Below the sky only: the logo up there opens and closes this page, and the sun still switches day and night.
    <View style={[styles.root, { top: skyHeight }]} pointerEvents={open ? 'auto' : 'none'} accessibilityViewIsModal>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: page, opacity: fx.backdrop }]} />
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: VEIL_COLOUR, opacity: fx.veil }]} pointerEvents="none" />
      <Animated.ScrollView style={{ opacity: fx.words }}
        contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + 28 }]}>
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
      {/* The day-night change still covers this page while its colours turn. */}
      <Veil />
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  // Over the chat below the sky, above the chat's own veil.
  root: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 3 },
  inner: { paddingHorizontal: 20, paddingTop: 12, gap: 28 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  // A round close button level with the title; the X is two crossed strokes.
  close: {
    width: 44, height: 44, borderRadius: radius.pill, backgroundColor: palette.night ? '#3D3245' : '#F4D0CE',
    alignItems: 'center', justifyContent: 'center',
  },
  closeLine: { position: 'absolute', width: 14, height: 2, borderRadius: 1, backgroundColor: palette.ink },
  title: { flexShrink: 1, fontFamily: JOURNAL, color: palette.ink, fontSize: 30, lineHeight: 38 },
  section: { gap: 10 },
  heading: { color: palette.pine, fontSize: 15, fontWeight: '700' },
  body: { color: palette.ink, fontSize: 16, lineHeight: 24 },
});
