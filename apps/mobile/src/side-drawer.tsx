/**
 * The side tab and the drawer it pulls out: the way to the map, a new chat,
 * and past chats.
 *
 * The tab is a bookmark sticking out of the left edge, under the logo, always
 * in the same place, so the map no longer hides behind a tap on the logo. The
 * drawer slides in over the chat from that edge and closes on a tap outside
 * it or on the phone's back button.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Animated, BackHandler, Easing, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { describeWhen, type SavedChat } from './chat-log.ts';
import { Crossfade, radius, sheetFor, useThemed, type Palette } from './theme.tsx';

const LOGO = require('../assets/ui/fred-logo.png');
const LEAF = require('../assets/ui/leaf.png');
const TREE = require('../assets/ui/tree.png');
const TRASH = require('../assets/ui/trash.png');
const CHECK = require('../assets/ui/check.png');
const JOURNAL = Platform.select({ ios: 'Georgia', default: 'serif' });

/** The bookmark on the edge of the chat. */
export function SideTab({ top, onPress }: { top: number; onPress: () => void }): React.JSX.Element {
  const { styles } = useThemed(makeStyles);
  return (
    <Pressable style={[styles.tabBox, { top }]} onPress={onPress} hitSlop={12}
      accessibilityRole="button" accessibilityLabel="Open the menu: map and past chats">
      {/* In both colour sets at once: it sits above the veil, so it has to turn with the sky. */}
      <Crossfade render={(p) => {
        const s = sheetFor(makeStyles, p);
        return (
          <View style={s.tab}>
            <View style={s.tabLine} />
            <View style={s.tabLine} />
            <View style={s.tabLine} />
          </View>
        );
      }} />
    </Pressable>
  );
}

export function SideDrawer<T>(
  { open, chats, current, onClose, onMap, onNewChat, onOpenChat, onRemoveChat }: {
    open: boolean;
    chats: readonly SavedChat<T>[];
    /** The chat on screen, marked in the list. */
    current: number | null;
    onClose: () => void;
    onMap: () => void;
    onNewChat: () => void;
    onOpenChat: (chat: SavedChat<T>) => void;
    onRemoveChat: (id: number) => void;
  },
): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const { palette, styles } = useThemed(makeStyles);
  const { width } = useWindowDimensions();
  const panel = Math.min(340, width * 0.84);
  const slide = useRef(new Animated.Value(0)).current;
  // Kept mounted until the closing slide has finished.
  const [shown, setShown] = useState(open);
  // Removing asks first, like removing a map: the first tap arms it.
  const [confirm, setConfirm] = useState<number | null>(null);

  useEffect(() => {
    if (open) setShown(true);
    Animated.timing(slide, {
      toValue: open ? 1 : 0, duration: open ? 260 : 200,
      easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic), useNativeDriver: true,
    }).start(({ finished }) => { if (finished && !open) { setShown(false); setConfirm(null); } });
  }, [open, slide]);
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [open, onClose]);

  if (!shown) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.over]} pointerEvents={open ? 'auto' : 'none'}>
      <Animated.View style={[styles.scrim, { opacity: slide }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close the menu" />
      </Animated.View>
      <Animated.View style={[styles.panel, {
        width: panel, paddingTop: insets.top + 18, paddingBottom: insets.bottom + 10,
        transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [-panel - 20, 0] }) }],
      }]}>
        <Image source={LOGO} resizeMode="contain" style={styles.logo} accessibilityLabel="Fred" />

        <Pressable style={styles.place} onPress={onMap} accessibilityRole="button">
          <View style={[styles.placeMark, { backgroundColor: palette.skyWash }]}>
            <View style={styles.pin}><View style={styles.pinDot} /></View>
          </View>
          <View style={styles.placeWords}>
            <Text style={styles.placeTitle}>Map</Text>
            <Text style={styles.placeNote}>Where you are, signal, offline maps</Text>
          </View>
        </Pressable>
        <Pressable style={styles.place} onPress={onNewChat} accessibilityRole="button">
          <View style={[styles.placeMark, { backgroundColor: palette.sage }]}>
            <Image source={LEAF} resizeMode="contain" style={styles.placeGlyph} />
          </View>
          <View style={styles.placeWords}>
            <Text style={styles.placeTitle}>New chat</Text>
            <Text style={styles.placeNote}>Start on a fresh page</Text>
          </View>
        </Pressable>

        <Text style={styles.heading}>Past chats</Text>
        <ScrollView style={styles.list} contentContainerStyle={styles.listInner}>
          {chats.length === 0 && (
            <Text style={styles.none}>
              Nothing yet. Chats are kept here, on this phone only, so you can come back to what Fred said.
            </Text>
          )}
          {chats.map((c) => (
            <View key={c.id} style={[styles.chat, c.id === current && styles.chatCurrent]}>
              <Pressable style={styles.chatOpen} onPress={() => onOpenChat(c)} accessibilityRole="button">
                <Text style={styles.chatTitle} numberOfLines={2}>{c.title}</Text>
                <Text style={styles.chatNote}>
                  {describeWhen(c.updatedAt)} · {c.turns.length === 1 ? '1 question' : `${c.turns.length} questions`}
                  {c.id === current ? ' · open now' : ''}
                </Text>
              </Pressable>
              {/* A bin; tapped once it turns into a tick to confirm. */}
              <Pressable hitSlop={10} accessibilityRole="button"
                style={[styles.remove, confirm === c.id && styles.removeSure]}
                accessibilityLabel={confirm === c.id ? 'Yes, remove this chat' : 'Remove this chat'}
                onPress={() => {
                  if (confirm !== c.id) { setConfirm(c.id); return; }
                  setConfirm(null);
                  onRemoveChat(c.id);
                }}>
                <Image source={confirm === c.id ? CHECK : TRASH} resizeMode="contain" style={styles.removeMark} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
        <View style={styles.foot}>
          <Image source={TREE} resizeMode="contain" style={styles.footGlyph} />
          <Text style={styles.footText}>Fred works offline. Nothing here leaves your phone.</Text>
        </View>
      </Animated.View>
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  // A bookmark on the page's left edge: rounded where it sticks out, flat where it meets the edge.
  tabBox: { position: 'absolute', left: 0, width: 30, height: 52, zIndex: 3 },
  tab: {
    width: 30, height: 52, gap: 5,
    alignItems: 'center', justifyContent: 'center', paddingRight: 3,
    backgroundColor: palette.pine, borderTopRightRadius: 16, borderBottomRightRadius: 16,
    boxShadow: `0 3 10 ${palette.shade}`,
  },
  tabLine: { width: 13, height: 2.5, borderRadius: 2, backgroundColor: palette.paper },

  over: { zIndex: 4 },
  scrim: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(43, 53, 44, 0.32)' },
  panel: {
    position: 'absolute', top: 0, bottom: 0, left: 0, paddingHorizontal: 18,
    backgroundColor: palette.cream, borderTopRightRadius: 28, borderBottomRightRadius: 28,
    boxShadow: `6 0 24 ${palette.shade}`,
  },
  logo: { height: 34, width: 34 * (900 / 415), marginBottom: 20, tintColor: palette.logo },

  place: {
    flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 10, padding: 12,
    backgroundColor: palette.paper, borderRadius: radius.card, borderWidth: 1, borderColor: palette.sand,
  },
  placeMark: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  placeGlyph: { width: 22, height: 22, tintColor: palette.pine },
  // A map pin drawn from two shapes: a ring with a dot in it.
  pin: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 3, borderColor: '#2F7BD6',
    alignItems: 'center', justifyContent: 'center',
  },
  pinDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#2F7BD6' },
  placeWords: { flex: 1 },
  placeTitle: { fontFamily: JOURNAL, color: palette.ink, fontSize: 20 },
  placeNote: { color: palette.moss, fontSize: 12, marginTop: 2 },

  heading: {
    color: palette.moss, fontSize: 11, fontWeight: '700', letterSpacing: 0.9, textTransform: 'uppercase',
    marginTop: 14, marginBottom: 4,
  },
  list: { flex: 1 },
  listInner: { paddingBottom: 12 },
  none: { color: palette.moss, fontSize: 14, lineHeight: 21, marginTop: 8 },
  chat: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: palette.sand,
  },
  chatCurrent: { backgroundColor: palette.oat, borderRadius: radius.control, borderBottomColor: palette.oat, paddingHorizontal: 10 },
  chatOpen: { flex: 1 },
  chatTitle: { fontFamily: JOURNAL, color: palette.ink, fontSize: 16, lineHeight: 22 },
  chatNote: { color: palette.moss, fontSize: 12, marginTop: 3 },
  remove: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  removeSure: { backgroundColor: palette.blush },
  removeMark: { width: 20, height: 20, tintColor: palette.clay },

  foot: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: palette.sand },
  footGlyph: { width: 16, height: 16, tintColor: palette.fir },
  footText: { flex: 1, color: palette.moss, fontSize: 12, lineHeight: 17 },
});
