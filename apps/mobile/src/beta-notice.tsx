/**
 * The beta notice (#248): what Fred is and isn't, and a tick to say the
 * hiker understands and agrees, before the chat is reached.
 *
 * Shown on the last page of setup (setup-wizard.tsx), where Start waits for
 * the tick, and on its own (BetaNoticeScreen) for a phone that finished setup
 * before the notice existed. Skip setup passes through it too: no way into the
 * chat goes around it. What was agreed, and when, is kept in agreement.json
 * (setup.ts).
 *
 * In Fred's own voice, like the rest of setup.
 */
import { useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Scene } from './scene.tsx';
import { Crossfade, Veil, radius, useThemed, type Palette } from './theme.tsx';

const LOGO = require('../assets/ui/fred-logo.png');
const CHECK = require('../assets/ui/check.png');
const JOURNAL = Platform.select({ ios: 'Georgia', default: 'serif' });

export const NOTICE_TITLE = 'Before you head out';
export const NOTICE_LEAD = 'I’m in beta: still learning, and sometimes wrong.';
export const NOTICE_POINTS: readonly { readonly title: string; readonly text: string }[] = [
  {
    title: 'Trust yourself first.',
    text: 'Your eyes, instincts and judgement see what I can’t. If what I say doesn’t fit what’s in front of you, go with what you see.',
  },
  {
    title: 'I guide; you decide.',
    text: 'I can help you think a choice through, but the choice, and its risks, stay yours.',
  },
  {
    title: 'In an emergency, call for help.',
    text: 'If you can reach 911 or your local emergency number, do that first. I’m not a doctor, a rescuer or a stand-in for training.',
  },
];
export const NOTICE_AGREE =
  'I understand Fred is beta software that can be wrong, and that my decisions and their outcomes are my own responsibility. I agree to use Fred on those terms.';

/** The notice and its tick. */
export function BetaNotice({ agreed, onToggle }: { agreed: boolean; onToggle: () => void }): React.JSX.Element {
  const { styles } = useThemed(makeStyles);
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle} accessibilityRole="header">{NOTICE_TITLE}</Text>
      <Text style={styles.lead}>{NOTICE_LEAD}</Text>
      {NOTICE_POINTS.map((p) => (
        <Text key={p.title} style={styles.body}>
          <Text style={styles.strong}>{p.title}</Text> {p.text}
        </Text>
      ))}
      <Pressable style={styles.agree} onPress={onToggle} hitSlop={6}
        accessibilityRole="checkbox" accessibilityState={{ checked: agreed }} accessibilityLabel={NOTICE_AGREE}>
        <View style={[styles.box, agreed && styles.boxOn]}>
          {agreed && <Image source={CHECK} resizeMode="contain" style={styles.boxMark} />}
        </View>
        <Text style={styles.agreeText}>{NOTICE_AGREE}</Text>
      </Pressable>
    </View>
  );
}

/** The notice on its own, for a phone set up before it existed. */
export function BetaNoticeScreen({ onAgree }: { onAgree: () => void }): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { styles } = useThemed(makeStyles);
  const [agreed, setAgreed] = useState(false);
  return (
    <View style={styles.root}>
      <Scene height={insets.top + 168} top={insets.top}>
        <View style={[styles.header, { paddingTop: insets.top + 10 }]} pointerEvents="none">
          <Crossfade render={(p) => (
            <Image source={LOGO} resizeMode="contain" style={[styles.logo, { tintColor: p.logo }]} accessibilityLabel="Fred" />
          )} />
        </View>
      </Scene>
      <ScrollView style={styles.page} contentContainerStyle={styles.pageInner}>
        <Text style={styles.title}>One thing first.</Text>
        <BetaNotice agreed={agreed} onToggle={() => setAgreed((a) => !a)} />
      </ScrollView>
      <View style={[styles.foot, { paddingBottom: insets.bottom + 14 }]}>
        <Pressable style={[styles.next, !agreed && styles.dim]} disabled={!agreed} onPress={onAgree}
          accessibilityRole="button" accessibilityState={{ disabled: !agreed }}>
          <Text style={styles.nextText}>Continue</Text>
        </Pressable>
      </View>
      <Veil />
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.cream },
  header: { paddingHorizontal: 18 },
  logo: { height: 34, width: 34 * (900 / 415) },
  page: { flex: 1 },
  pageInner: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 12, gap: 14 },
  title: { fontFamily: JOURNAL, color: palette.ink, fontSize: 32, lineHeight: 40 },
  card: {
    backgroundColor: palette.paper, borderRadius: radius.card, padding: 16, gap: 10,
    borderWidth: 1, borderColor: palette.sand, boxShadow: `0 3 12 ${palette.shade}`,
  },
  cardTitle: { fontFamily: JOURNAL, color: palette.ink, fontSize: 20 },
  lead: { color: palette.ink, fontSize: 16, lineHeight: 24 },
  body: { color: palette.ink, fontSize: 15, lineHeight: 23 },
  strong: { fontWeight: '700' },
  agree: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 4, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: palette.sand,
  },
  agreeText: { flex: 1, color: palette.ink, fontSize: 14, lineHeight: 21 },
  box: {
    width: 26, height: 26, borderRadius: 6, borderWidth: 1.5, borderColor: palette.moss,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  boxOn: { backgroundColor: palette.pine, borderColor: palette.pine },
  boxMark: { width: 14, height: 14, tintColor: palette.paper },
  foot: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 20, paddingTop: 10 },
  next: { borderRadius: radius.pill, backgroundColor: palette.pine, paddingHorizontal: 26, paddingVertical: 14, boxShadow: `0 4 14 ${palette.shade}` },
  nextText: { color: palette.paper, fontSize: 16, fontWeight: '700' },
  dim: { opacity: 0.4 },
});
