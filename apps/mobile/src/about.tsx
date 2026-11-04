/**
 * About Fred (#209): what he does, why he exists, and who he is named for.
 * Opened by tapping the logo. Facts here come from the project README
 * (§02 Overview and Motivation); keep them in step with it.
 */
import { useEffect } from 'react';
import { BackHandler, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Scene } from './scene.tsx';
import { Crossfade, Veil, radius, useThemed, type Palette } from './theme.tsx';

const LOGO = require('../assets/ui/fred-logo.png');
const LOGO_RATIO = 900 / 415;
const JOURNAL = Platform.select({ ios: 'Georgia', default: 'serif' });

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
  { onClose, row, logoHeight }: {
    onClose: () => void;
    /** The line below the status bar that the top controls are centred on, as on the chat. */
    row: number;
    logoHeight: number;
  },
): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { styles } = useThemed(makeStyles);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [onClose]);

  return (
    <View style={styles.root}>
      <Scene height={insets.top + 112} top={insets.top}>
        {/* The logo where it is on the chat: tapped there to open this page, tapped again to close it. */}
        <View style={[styles.header, { top: insets.top + row - logoHeight / 2, height: logoHeight }]} pointerEvents="box-none">
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Fred. Close About Fred">
            <Crossfade render={(p) => (
              <Image source={LOGO} resizeMode="contain"
                style={{ height: logoHeight, width: logoHeight * LOGO_RATIO, tintColor: p.logo }} />
            )} />
          </Pressable>
        </View>
      </Scene>
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + 28 }]}>
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
      </ScrollView>
      <Veil />
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.cream },
  // Centred on `row`, the logo at the right as on the chat.
  header: {
    position: 'absolute', left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingHorizontal: 18,
  },
  scroll: { flex: 1 },
  inner: { paddingHorizontal: 20, paddingTop: 12, gap: 28 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  // A round close button level with the title; the X is two crossed strokes.
  close: {
    width: 36, height: 36, borderRadius: radius.pill, backgroundColor: palette.oat,
    alignItems: 'center', justifyContent: 'center',
  },
  closeLine: { position: 'absolute', width: 14, height: 2, borderRadius: 1, backgroundColor: palette.ink },
  title: { flexShrink: 1, fontFamily: JOURNAL, color: palette.ink, fontSize: 30, lineHeight: 38 },
  section: { gap: 10 },
  heading: { color: palette.pine, fontSize: 11, fontWeight: '700', letterSpacing: 0.9, textTransform: 'uppercase' },
  body: { color: palette.ink, fontSize: 16, lineHeight: 24 },
});
