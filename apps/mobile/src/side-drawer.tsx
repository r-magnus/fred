/**
 * The side tab and the drawer it pulls out: a new chat, the way to the map,
 * past chats grouped by day, and About Fred (#211).
 *
 * The tab is a bookmark sticking out of the left edge, under the logo, always
 * in the same place, so the map no longer hides behind a tap on the logo. The
 * drawer slides in over the chat from that edge and closes on a tap outside
 * it or on the phone's back button.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Animated, BackHandler, Easing, Image, PanResponder, PixelRatio, Platform, Pressable, ScrollView, StyleSheet, Text, View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Edge from '../modules/fred-edge';
import type { SavedChat } from './chat-log.ts';
import { chatTitle, groupChats, whenInGroup } from './chat-groups.ts';
import { Crossfade, radius, sheetFor, useThemed, type Palette } from './theme.tsx';

const LOGO = require('../assets/ui/fred-logo.png');
const LEAF = require('../assets/ui/leaf.png');
const TRASH = require('../assets/ui/trash.png');
const CHECK = require('../assets/ui/check.png');
const JOURNAL = Platform.select({ ios: 'Georgia', default: 'serif' });

/** The tab's size, and how far round it a touch still counts. */
const TAB_WIDTH = 30;
const TAB_HEIGHT = 52;
/** For placing the tab: App.tsx centres it in the sky. */
export const SIDE_TAB_HEIGHT = TAB_HEIGHT;
const TAB_SLOP = 12;
/** How wide the drawer is on a screen this wide. */
const panelWidth = (screen: number): number => Math.min(340, screen * 0.84);
/** A pull this far across the drawer's width, or a flick this fast, opens or shuts it; less lets it fall back. */
const PULL_MOVES = 0.3;
const FLICK_MOVES = 0.4;

/**
 * The bookmark on the edge of the chat. It rides on the drawer's edge: at the
 * screen's edge while the drawer is shut, on the drawer's right side while it
 * is open. A tap opens or shuts the drawer, and so does pulling the tab: the
 * drawer follows the finger (`slide` is the drawer's own position, 0 shut to
 * 1 open, shared with SideDrawer) and `onPeek` keeps the drawer on screen
 * while it is being pulled out.
 */
export function SideTab(
  { top, open, slide, onOpen, onClose, onPeek }: {
    top: number; open: boolean; slide: Animated.Value;
    onOpen: () => void; onClose: () => void; onPeek: (on: boolean) => void;
  },
): React.JSX.Element {
  const { styles } = useThemed(makeStyles);
  const { width } = useWindowDimensions();
  const panel = panelWidth(width);
  // The gesture is made once, so it reads what changes through this.
  const now = useRef({ panel, open, onOpen, onClose, onPeek });
  now.current = { panel, open, onOpen, onClose, onPeek };
  const pull = useRef(PanResponder.create({
    // Only a sideways pull the way the drawer can go; a tap stays the button's.
    onMoveShouldSetPanResponderCapture: (_, g) =>
      Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy) && (now.current.open ? g.dx < 0 : g.dx > 0),
    onPanResponderGrant: () => { if (!now.current.open) now.current.onPeek(true); },
    onPanResponderMove: (_, g) =>
      slide.setValue(Math.max(0, Math.min(1, (now.current.open ? 1 : 0) + g.dx / now.current.panel))),
    onPanResponderRelease: (_, g) => {
      const far = Math.abs(g.dx) > now.current.panel * PULL_MOVES || Math.abs(g.vx) > FLICK_MOVES;
      if (!far) { settle(); return; }
      // The drawer finishes the slide from wherever the finger left it.
      if (now.current.open) now.current.onClose();
      else { now.current.onOpen(); now.current.onPeek(false); }
    },
    onPanResponderTerminate: () => settle(),
  })).current;
  /** A pull too short to count: back to where it started. */
  const settle = (): void => {
    const wasOpen = now.current.open;
    Animated.timing(slide, { toValue: wasOpen ? 1 : 0, duration: 160, easing: Easing.out(Easing.cubic), useNativeDriver: true })
      .start(() => { if (!wasOpen) now.current.onPeek(false); });
  };
  // Android reads a swipe that starts at the screen's edge as "back", which
  // would close the app: keep that gesture off the tab and the margin round it.
  useEffect(() => {
    const px = (points: number): number => Math.round(PixelRatio.getPixelSizeForLayoutSize(points));
    Edge?.keepFromBackGesture(0, px(top - TAB_SLOP), px(TAB_WIDTH + TAB_SLOP), px(top + TAB_HEIGHT + TAB_SLOP));
    return () => Edge?.keepFromBackGesture(0, 0, 0, 0);
  }, [top]);
  return (
    // The pull is on a box around the button: a Pressable keeps its own touch handlers.
    <Animated.View {...pull.panHandlers} hitSlop={TAB_SLOP}
      style={[styles.tabBox, { top, transform: [{ translateX: slide.interpolate({
        // The drawer starts 20 points off screen, so the tab waits at the edge until the drawer reaches it.
        inputRange: [0, 20 / (panel + 20), 1], outputRange: [0, 0, panel],
      }) }] }]}>
      <Pressable onPress={open ? onClose : onOpen} hitSlop={TAB_SLOP}
        accessibilityRole="button" accessibilityLabel={open ? 'Close the menu' : 'Open the menu: map and past chats'}>
        {/* In both colour sets at once: it sits above the veil, so it has to turn with the sky. */}
        <Crossfade render={(p) => {
          const s = sheetFor(makeStyles, p);
          // #211: three lines while shut, a cross while open, so the tab says what a tap will do.
          return open ? (
            <View style={s.tab}>
              <View style={[s.tabLine, s.crossLine, { transform: [{ rotate: '45deg' }] }]} />
              <View style={[s.tabLine, s.crossLine, { transform: [{ rotate: '-45deg' }] }]} />
            </View>
          ) : (
            <View style={s.tab}>
              <View style={s.tabLine} />
              <View style={s.tabLine} />
              <View style={s.tabLine} />
            </View>
          );
        }} />
      </Pressable>
    </Animated.View>
  );
}

export function SideDrawer<T>(
  { open, peek, slide, chats, current, onClose, onMap, onNewChat, onOpenChat, onRemoveChat, onAbout }: {
    open: boolean;
    /** True while the tab is being pulled: the drawer is shown part-way, not yet open. */
    peek: boolean;
    /** Where the drawer is, 0 shut to 1 open. Shared with SideTab, which moves it during a pull. */
    slide: Animated.Value;
    chats: readonly SavedChat<T>[];
    /** The chat on screen, marked in the list. */
    current: number | null;
    onClose: () => void;
    onMap: () => void;
    onNewChat: () => void;
    onOpenChat: (chat: SavedChat<T>) => void;
    onRemoveChat: (id: number) => void;
    /** Opens About Fred. */
    onAbout: () => void;
  },
): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const { palette, styles } = useThemed(makeStyles);
  const { width } = useWindowDimensions();
  const panel = panelWidth(width);
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

  if (!shown && !peek && !open) return null;
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

        {/* #211: the thing done most often is the one solid button. */}
        <Pressable style={({ pressed }) => [styles.newChat, pressed && styles.pressed]} onPress={onNewChat}
          accessibilityRole="button" accessibilityLabel="New chat">
          <Image source={LEAF} resizeMode="contain" style={styles.newChatGlyph} />
          <Text style={styles.newChatText}>New chat</Text>
        </Pressable>

        <Pressable style={({ pressed }) => [styles.place, pressed && styles.pressed]} onPress={onMap}
          accessibilityRole="button" accessibilityLabel="Map: where you are, signal, offline maps">
          <View style={[styles.placeMark, { backgroundColor: palette.skyWash }]}>
            <View style={styles.pin}><View style={styles.pinDot} /></View>
          </View>
          <View style={styles.placeWords}>
            <Text style={styles.placeTitle}>Map</Text>
            <Text style={styles.placeNote} numberOfLines={1}>Where you are, signal, offline maps</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>

        <ScrollView style={styles.list} contentContainerStyle={styles.listInner}>
          {chats.length === 0 && (
            <>
              <Text style={styles.heading}>Past chats</Text>
              <Text style={styles.none}>
                Nothing yet. Chats are kept here, on this phone only, so you can come back to what Fred said.
              </Text>
            </>
          )}
          {groupChats(chats).map(({ group, chats: inGroup }) => (
            <View key={group}>
              <Text style={styles.heading} accessibilityRole="header">{group}</Text>
              {inGroup.map((c) => {
                const when = whenInGroup(c.updatedAt);
                const asked = c.turns.length === 1 ? '1 question' : `${c.turns.length} questions`;
                const sure = confirm === c.id;
                return (
                  <View key={c.id} style={[styles.chat, c.id === current && styles.chatCurrent]}>
                    <Pressable style={styles.chatOpen} onPress={() => onOpenChat(c)} accessibilityRole="button">
                      <Text style={styles.chatTitle} numberOfLines={2}>{chatTitle(c.title)}</Text>
                      <Text style={styles.chatNote}>
                        {[when, asked, c.id === current ? 'open now' : ''].filter((w) => w !== '').join(' · ')}
                      </Text>
                    </Pressable>
                    {/* A quiet bin; tapped once it turns into a red tick to confirm. */}
                    <Pressable hitSlop={6} accessibilityRole="button"
                      style={[styles.remove, sure && styles.removeSure]}
                      accessibilityLabel={sure ? 'Yes, remove this chat' : 'Remove this chat'}
                      onPress={() => {
                        if (!sure) { setConfirm(c.id); return; }
                        setConfirm(null);
                        onRemoveChat(c.id);
                      }}>
                      <Image source={sure ? CHECK : TRASH} resizeMode="contain" style={[styles.removeMark, sure && styles.removeMarkSure]} />
                    </Pressable>
                  </View>
                );
              })}
            </View>
          ))}
        </ScrollView>

        {/* #211: About was only behind a tap on the logo, which few would guess. */}
        <Pressable style={({ pressed }) => [styles.foot, pressed && styles.pressed]} onPress={onAbout}
          accessibilityRole="button" accessibilityLabel="About Fred">
          <View style={styles.infoMark}><Text style={styles.infoText}>i</Text></View>
          <Text style={styles.footText}>About Fred</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  // A bookmark on the page's left edge: rounded where it sticks out, flat where it meets the edge.
  // Above the drawer (4), whose edge it rides on.
  tabBox: { position: 'absolute', left: 0, width: TAB_WIDTH, height: TAB_HEIGHT, zIndex: 5 },
  tab: {
    width: 30, height: 52, gap: 5,
    alignItems: 'center', justifyContent: 'center', paddingRight: 3,
    backgroundColor: palette.pine, borderTopRightRadius: 16, borderBottomRightRadius: 16,
    boxShadow: `0 3 10 ${palette.shade}`,
  },
  tabLine: { width: 13, height: 2.5, borderRadius: 2, backgroundColor: palette.paper },
  // The two strokes of the cross lie on top of each other, crossing at the middle.
  crossLine: { position: 'absolute', width: 15 },

  over: { zIndex: 4 },
  scrim: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(43, 53, 44, 0.32)' },
  panel: {
    position: 'absolute', top: 0, bottom: 0, left: 0, paddingHorizontal: 18,
    backgroundColor: palette.cream, borderTopRightRadius: 28, borderBottomRightRadius: 28,
    boxShadow: `6 0 24 ${palette.shade}`,
  },
  logo: { height: 30, width: 30 * (900 / 415), marginBottom: 22, marginLeft: 2, tintColor: palette.logo },
  pressed: { opacity: 0.7 },

  newChat: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 52,
    borderRadius: 26, backgroundColor: palette.pine, marginBottom: 8,
  },
  newChatGlyph: { width: 20, height: 20, tintColor: palette.paper },
  newChatText: { color: palette.paper, fontSize: 17, fontWeight: '600', letterSpacing: 0.2 },

  place: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 4, minHeight: 56 },
  placeMark: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  // A map pin drawn from two shapes: a ring with a dot in it.
  pin: {
    width: 17, height: 17, borderRadius: 9, borderWidth: 2.5, borderColor: '#2F7BD6',
    alignItems: 'center', justifyContent: 'center',
  },
  pinDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#2F7BD6' },
  placeWords: { flex: 1 },
  placeTitle: { fontFamily: JOURNAL, color: palette.ink, fontSize: 18 },
  placeNote: { color: palette.moss, fontSize: 12, marginTop: 1 },
  chevron: { color: palette.moss, fontSize: 26, lineHeight: 28, marginRight: 4 },

  heading: {
    color: palette.moss, fontSize: 11, fontWeight: '700', letterSpacing: 0.9, textTransform: 'uppercase',
    marginTop: 18, marginBottom: 2, marginLeft: 4,
  },
  list: { flex: 1, marginTop: 4, borderTopWidth: 1, borderTopColor: palette.sand },
  listInner: { paddingBottom: 12 },
  none: { color: palette.moss, fontSize: 14, lineHeight: 21, marginTop: 6, marginHorizontal: 4 },
  chat: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingLeft: 4, minHeight: 56,
  },
  // The chat on screen: a soft wash with a pine edge, like a finger keeping the page.
  chatCurrent: {
    backgroundColor: palette.oat, borderRadius: radius.control, paddingLeft: 10,
    borderLeftWidth: 3, borderLeftColor: palette.pine,
  },
  chatOpen: { flex: 1 },
  chatTitle: { fontFamily: JOURNAL, color: palette.ink, fontSize: 16, lineHeight: 21 },
  chatNote: { color: palette.moss, fontSize: 12, marginTop: 3 },
  // 44 points to tap; the bin itself is small and quiet until it asks to be sure.
  remove: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  removeSure: { backgroundColor: palette.blush },
  removeMark: { width: 18, height: 18, tintColor: palette.moss, opacity: 0.7 },
  removeMarkSure: { tintColor: palette.clay, opacity: 1 },

  foot: {
    flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingHorizontal: 4,
    borderTopWidth: 1, borderTopColor: palette.sand,
  },
  infoMark: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: palette.moss,
    alignItems: 'center', justifyContent: 'center',
  },
  infoText: { color: palette.moss, fontSize: 13, fontWeight: '700', fontFamily: JOURNAL, lineHeight: 15 },
  footText: { color: palette.ink, fontSize: 15 },
});
