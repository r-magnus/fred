/**
 * The guide to Fred himself (#196, US-09): where everything is, how the day
 * and night switch works, what is on the phone, and what Fred will not do.
 *
 * It opens from the side menu and reads like the rest of the app: pages with
 * an index tab, under the same horizon, so the sun it describes is right
 * there to try. `Tour` is the short version, shown on the last page of setup.
 *
 * Everything it names exists, in the words the app itself uses. When a
 * control moves or is renamed, this page has to follow.
 */
import { useEffect, type ReactNode } from 'react';
import { BackHandler, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MEDICAL_DISCLAIMER, STATE_NAMES } from '@fred/rag-core';
import { Scene } from './scene.tsx';
import { listNames } from './setup-plan.ts';
import { guidesOnPhone, statesOnPhone } from './setup.ts';
import { Crossfade, Veil, radius, useThemed, type Palette } from './theme.tsx';

const LOGO = require('../assets/ui/fred-logo.png');
const TREE = require('../assets/ui/tree.png');
const ARROW = require('../assets/ui/arrow-up.png');
const JOURNAL = Platform.select({ ios: 'Georgia', default: 'serif' });

/** One place in the app: a small picture of the control, its name, and what it is for. */
function Place({ mark, title, children }: { mark: ReactNode; title: string; children: string }): React.JSX.Element {
  const { styles } = useThemed(makeStyles);
  return (
    <View style={styles.place}>
      <View style={styles.placeMark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{mark}</View>
      <View style={styles.placeWords}>
        <Text style={styles.placeTitle}>{title}</Text>
        <Text style={styles.placeNote}>{children}</Text>
      </View>
    </View>
  );
}

/**
 * Where the four things a new hiker needs are. Each is drawn as it looks on
 * the screen, small, so it can be recognised when it is met.
 */
export function Tour(): React.JSX.Element {
  const { palette, styles } = useThemed(makeStyles);
  return (
    <View>
      <Place title="The tab on the left edge" mark={(
        <View style={styles.miniTab}>
          <View style={styles.miniTabLine} /><View style={styles.miniTabLine} /><View style={styles.miniTabLine} />
        </View>
      )}>
        Tap it or pull it out for the map, a new chat, your past chats and the guide.
      </Place>
      <Place title="The box at the bottom" mark={(
        <View style={styles.miniSend}><Image source={ARROW} resizeMode="contain" style={styles.miniSendMark} /></View>
      )}>
        Ask in your own words. While you type, Fred shows what the answer will cost your battery.
      </Place>
      <Place title="Under each answer" mark={<Image source={TREE} resizeMode="contain" style={styles.miniTree} />}>
        The sources Fred read, so you can check him. If it isn&apos;t in his guides, he says so.
      </Place>
      {/* Whichever is up: the page is read by day and by night. */}
      <Place title={palette.night ? 'The moon, up top' : 'The sun, up top'} mark={<View style={styles.miniSun} />}>
        {palette.night
          ? 'Swipe it sideways, or tap it, for day colours. The sun takes you back.'
          : 'Swipe it sideways, or tap it, for night colours. The moon takes you back.'}
      </Place>
    </View>
  );
}

/** A page of the guide, with its index tab. */
function Page({ label, tone, children }: { label: string; tone?: string; children: ReactNode }): React.JSX.Element {
  const { palette, styles } = useThemed(makeStyles);
  return (
    <View style={styles.card}>
      <View style={[styles.tab, { backgroundColor: tone ?? palette.sage }]}>
        <Text style={styles.tabText}>{label}</Text>
      </View>
      {children}
    </View>
  );
}

export function GuideScreen(
  { onClose, onSetup, onMap }: {
    onClose: () => void;
    /** Run setup again: more guides, another state. */
    onSetup: () => void;
    onMap: () => void;
  },
): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { palette, styles } = useThemed(makeStyles);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [onClose]);
  // Read when the guide opens: it is a page, not a live view of the disk.
  const guides = guidesOnPhone();
  const states = statesOnPhone().map((s) => STATE_NAMES[s] ?? s);

  return (
    <View style={styles.root}>
      <Scene height={insets.top + 112} top={insets.top}>
        <View style={[styles.header, { paddingTop: insets.top + 10 }]} pointerEvents="box-none">
          <Crossfade render={(p) => (
            <Image source={LOGO} resizeMode="contain" style={[styles.logo, { tintColor: p.logo }]} accessibilityLabel="Fred" />
          )} />
          <Pressable onPress={onClose} hitSlop={10} style={styles.done} accessibilityRole="button" accessibilityLabel="Close the guide">
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>
      </Scene>
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + 28 }]}>
        <Text style={styles.title}>Finding your way around.</Text>
        <Text style={styles.lead}>
          Fred is a field guide that lives on your phone: first aid, survival, and the plants and
          animals around you, with or without signal.
        </Text>

        <Page label="Where things are">
          <Tour />
        </Page>

        <Page label="Asking" tone={palette.skyWash}>
          <Text style={styles.body}>
            Ask the way you&apos;d ask someone walking beside you. Fred answers from his guides and
            lists what he read underneath.
          </Text>
          <Text style={styles.body}>
            An answer takes a little while to write. The Ask button becomes a square while he works:
            tap it to stop him.
          </Text>
          <Text style={styles.body}>
            When the answer depends on where you are, he&apos;ll ask for your state or your location.
          </Text>
        </Page>

        <Page label="The map" tone={palette.skyWash}>
          <Text style={styles.body}>
            Open it from the menu, or tap Fred&apos;s name at the top of a chat. The round target
            button finds where you are.
          </Text>
          <Text style={styles.body}>
            Amber shading is where your carrier reports no coverage. Red is where no carrier does,
            and a 911 call may not connect there.
          </Text>
          <Text style={styles.body}>
            Offline maps, on the map&apos;s sheet, is where you download another state or remove one
            to free space.
          </Text>
          <Pressable onPress={onMap} hitSlop={8} accessibilityRole="button">
            <Text style={styles.link}>▸ Open the map</Text>
          </Pressable>
        </Page>

        <Page label="Day and night" tone={palette.butter}>
          <Text style={styles.body}>
            The sun in the sky above is the switch. Swipe it sideways and it sets behind the hills
            while the moon comes up; a tap does the same. It works on every screen that has the sky.
          </Text>
          <Text style={styles.body}>
            Until you choose, Fred goes by the clock: night colours from eight in the evening to six
            in the morning. Once you&apos;ve chosen, he remembers.
          </Text>
        </Page>

        <Page label="Without signal">
          <Text style={styles.body}>
            Everything Fred knows is stored on this phone, so he works the same with no signal at
            all. Only downloading guides and maps needs a connection: do that before you set out.
          </Text>
          <Text style={styles.body}>
            Nothing you ask, and nowhere you&apos;ve been, leaves the phone. Past chats are kept here
            only, and you can remove any of them from the menu.
          </Text>
        </Page>

        <Page label="What Fred isn't" tone={palette.blush}>
          <Text style={styles.body}>
            Fred is a guide book that can talk, not a doctor and not a rescue service. He can be
            wrong, which is why he shows his sources.
          </Text>
          <Text style={styles.caution}>{MEDICAL_DISCLAIMER}</Text>
        </Page>

        <Page label="On this phone">
          <Text style={styles.body}>
            {guides ? 'Fred’s guides are here, ready to use offline.' : 'Fred’s guides aren’t on this phone yet, so he can’t answer.'}
          </Text>
          <Text style={styles.body}>
            {states.length === 0 ? 'No state maps yet.' : `Maps and local guides: ${listNames(states)}.`}
          </Text>
          <Pressable style={styles.button} onPress={onSetup} accessibilityRole="button">
            <Text style={styles.buttonText}>Run setup again</Text>
          </Pressable>
        </Page>
      </ScrollView>
      <Veil />
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.cream },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18 },
  logo: { height: 28, width: 28 * (900 / 415) },
  // Above the sky in both sets of colours: a paper pill.
  done: { backgroundColor: '#FFFCF4', borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 7 },
  doneText: { color: '#316C33', fontSize: 14, fontWeight: '700' },
  scroll: { flex: 1 },
  inner: { paddingHorizontal: 18, paddingTop: 8, gap: 26 },
  title: { fontFamily: JOURNAL, color: palette.ink, fontSize: 30, lineHeight: 38 },
  lead: { color: palette.moss, fontSize: 15, lineHeight: 22, marginTop: -14 },

  card: {
    backgroundColor: palette.paper, borderRadius: radius.card, borderTopLeftRadius: 6,
    paddingHorizontal: 16, paddingTop: 24, paddingBottom: 16, gap: 10,
    borderWidth: 1, borderColor: palette.sand, boxShadow: `0 3 12 ${palette.shade}`,
  },
  tab: { position: 'absolute', top: -12, left: 12, borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 4 },
  tabText: { color: palette.ink, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.9, textTransform: 'uppercase' },
  body: { color: palette.ink, fontSize: 15, lineHeight: 23 },
  caution: { color: palette.plum, fontSize: 13, lineHeight: 19, borderTopWidth: 1, borderTopColor: palette.sand, paddingTop: 10 },
  link: { color: palette.pine, fontSize: 15, fontWeight: '700', marginTop: 2 },
  button: { alignSelf: 'flex-start', marginTop: 4, borderRadius: radius.control, backgroundColor: palette.oat, paddingHorizontal: 14, paddingVertical: 10 },
  buttonText: { color: palette.ink, fontSize: 14, fontWeight: '600' },

  place: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 9 },
  placeMark: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.oat },
  placeWords: { flex: 1 },
  placeTitle: { fontFamily: JOURNAL, color: palette.ink, fontSize: 18 },
  placeNote: { color: palette.moss, fontSize: 13, lineHeight: 19, marginTop: 2 },
  // The side tab, the Ask button, the tree and the sun, at a third of their size.
  miniTab: {
    width: 16, height: 26, gap: 3, alignItems: 'center', justifyContent: 'center', paddingRight: 1,
    backgroundColor: palette.pine, borderTopRightRadius: 9, borderBottomRightRadius: 9,
  },
  miniTabLine: { width: 7, height: 1.5, borderRadius: 1, backgroundColor: palette.paper },
  miniSend: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.pine },
  miniSendMark: { width: 14, height: 14, tintColor: palette.paper },
  miniTree: { width: 22, height: 22, tintColor: palette.pine },
  miniSun: { width: 20, height: 20, borderRadius: 10, backgroundColor: palette.night ? '#FFFCF4' : '#F2C94C' },
});
