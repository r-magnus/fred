/**
 * Where things are, shown once on the last page of setup (#196). Only the
 * controls that are not obvious at a glance: the menu tab, the Ask box and
 * the sun that switches day and night. The guide page this came from was
 * removed (#209): the app should explain itself.
 *
 * Everything it names exists, in the words the app itself uses. When a
 * control moves or is renamed, this has to follow.
 */
import { type ReactNode } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import { useThemed, type Palette } from './theme.tsx';

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

export function Tour(): React.JSX.Element {
  const { palette, styles } = useThemed(makeStyles);
  return (
    <View>
      <Place title="The menu button, top left" mark={(
        <View style={styles.miniTab}>
          <View style={styles.miniTabLine} /><View style={styles.miniTabLine} /><View style={styles.miniTabLine} />
        </View>
      )}>
        A new chat, the map, About Fred and your past chats.
      </Place>
      <Place title="The box at the bottom" mark={(
        <View style={styles.miniSend}><Image source={ARROW} resizeMode="contain" style={styles.miniSendMark} /></View>
      )}>
        Ask in your own words. While you type, Fred shows what the answer will cost your battery.
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

const makeStyles = (palette: Palette) => StyleSheet.create({
  place: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 9 },
  placeMark: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.oat },
  placeWords: { flex: 1 },
  placeTitle: { fontFamily: JOURNAL, color: palette.ink, fontSize: 18 },
  placeNote: { color: palette.moss, fontSize: 13, lineHeight: 19, marginTop: 2 },
  // The menu button, the Ask button and the sun, at about half their size.
  miniTab: {
    width: 26, height: 26, gap: 3, alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.pine, borderRadius: 13,
  },
  miniTabLine: { width: 10, height: 1.5, borderRadius: 1, backgroundColor: palette.paper },
  miniSend: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.pine },
  miniSendMark: { width: 14, height: 14, tintColor: palette.paper },
  miniSun: { width: 20, height: 20, borderRadius: 10, backgroundColor: palette.night ? '#FFFCF4' : '#F2C94C' },
});
