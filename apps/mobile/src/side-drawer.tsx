/**
 * The side tab and the drawer it pulls out: a new chat, the map, About Fred,
 * and past chats.
 *
 * Order follows use (ux-ui-review skill, navigation): a fresh page is what
 * the menu is opened for most, so it comes first and looks like the main
 * action. About Fred was reachable only by tapping the logo, a gesture
 * nobody is told about; it has its own row now as well. Removing a chat is
 * immediate with an Undo, instead of a bin that turns into a tick.
 *
 * The tab is a bookmark sticking out of the left edge, under the logo, always
 * in the same place, so the map no longer hides behind a tap on the logo. The
 * drawer slides in over the chat from that edge and closes on a tap outside
 * it or on the phone's back button.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated, BackHandler, Easing, Image, PanResponder, PixelRatio, Platform, Pressable, ScrollView, StyleSheet, Text, View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Edge from '../modules/fred-edge';
import { describeWhen, type SavedChat } from './chat-log.ts';
import { Crossfade, radius, sheetFor, useThemed, type Palette } from './theme.tsx';

const LOGO = require('../assets/ui/fred-logo.png');
const LEAF = require('../assets/ui/leaf.png');
const TRASH = require('../assets/ui/trash.png');
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
/** How long a removed chat can still be put back. */
const UNDO_MS = 6000;

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
          return (
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
  { open, peek, slide, chats, current, onClose, onMap, onAbout, onNewChat, onOpenChat, onRemoveChat, onRestoreChat }: {
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
    onAbout: () => void;
    onNewChat: () => void;
    onOpenChat: (chat: SavedChat<T>) => void;
    onRemoveChat: (id: number) => void;
    /** Undo: put back a chat just removed. */
    onRestoreChat: (chat: SavedChat<T>) => void;
  },
): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const { palette, styles } = useThemed(makeStyles);
  const { width } = useWindowDimensions();
  const panel = panelWidth(width);
  // Kept mounted until the closing slide has finished.
  const [shown, setShown] = useState(open);
  // The chat just removed, offered back for a few seconds.
  const [removed, setRemoved] = useState<SavedChat<T> | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const forget = useCallback((): void => {
    if (undoTimer.current !== null) clearTimeout(undoTimer.current);
    undoTimer.current = null;
    setRemoved(null);
  }, []);
  useEffect(() => forget, [forget]);
  const remove = (c: SavedChat<T>): void => {
    onRemoveChat(c.id);
    if (undoTimer.current !== null) clearTimeout(undoTimer.current);
    setRemoved(c);
    undoTimer.current = setTimeout(() => { undoTimer.current = null; setRemoved(null); }, UNDO_MS);
  };

  useEffect(() => {
    if (open) setShown(true);
    Animated.timing(slide, {
      toValue: open ? 1 : 0, duration: open ? 260 : 200,
      easing: open ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic), useNativeDriver: true,
    }).start(({ finished }) => { if (finished && !open) { setShown(false); forget(); } });
  }, [open, slide, forget]);
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

        {/* The main action, filled, first. */}
        <Pressable style={styles.newChat} onPress={onNewChat} accessibilityRole="button"
          accessibilityLabel="New chat. Start on a fresh page">
          <Image source={LEAF} resizeMode="contain" style={styles.newChatGlyph} />
          <Text style={styles.newChatText}>New chat</Text>
        </Pressable>
        <Pressable style={styles.place} onPress={onMap} accessibilityRole="button"
          accessibilityLabel="Map. Where you are, signal, offline maps">
          <View style={[styles.placeMark, { backgroundColor: palette.skyWash }]}>
            <View style={styles.pin}><View style={styles.pinDot} /></View>
          </View>
          <View style={styles.placeWords}>
            <Text style={styles.placeTitle}>Map</Text>
            <Text style={styles.placeNote}>Where you are, signal, offline maps</Text>
          </View>
        </Pressable>
        <Pressable style={styles.place} onPress={onAbout} accessibilityRole="button"
          accessibilityLabel="About Fred. What Fred is, its sources and limits">
          <View style={[styles.placeMark, { backgroundColor: palette.butter }]}>
            <Text style={styles.aboutMark}>i</Text>
          </View>
          <View style={styles.placeWords}>
            <Text style={styles.placeTitle}>About Fred</Text>
            <Text style={styles.placeNote}>What Fred is, its sources and limits</Text>
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
              {/* Removed at once; Undo below brings it back (ux-ui-review, stress). */}
              <Pressable hitSlop={6} accessibilityRole="button" style={styles.remove}
                accessibilityLabel={`Remove the chat ${c.title}`} onPress={() => remove(c)}>
                <Image source={TRASH} resizeMode="contain" style={styles.removeMark} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
        {removed !== null && (
          <View style={styles.undoBar} accessibilityLiveRegion="polite">
            <Text style={styles.undoText} numberOfLines={1}>Chat removed</Text>
            <Pressable style={styles.undo} accessibilityRole="button" accessibilityLabel="Undo, put the chat back"
              onPress={() => { onRestoreChat(removed); forget(); }}>
              <Text style={styles.undoButton}>Undo</Text>
            </Pressable>
          </View>
        )}
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

  over: { zIndex: 4 },
  scrim: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(43, 53, 44, 0.32)' },
  panel: {
    position: 'absolute', top: 0, bottom: 0, left: 0, paddingHorizontal: 18,
    backgroundColor: palette.cream, borderTopRightRadius: 28, borderBottomRightRadius: 28,
    boxShadow: `6 0 24 ${palette.shade}`,
  },
  logo: { height: 34, width: 34 * (900 / 415), marginBottom: 20, tintColor: palette.logo },
  newChat: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 52, marginBottom: 12,
    backgroundColor: palette.pine, borderRadius: radius.pill, paddingHorizontal: 18,
  },
  newChatGlyph: { width: 20, height: 20, tintColor: palette.paper },
  newChatText: { color: palette.paper, fontSize: 17, fontWeight: '700' },
  aboutMark: { fontFamily: JOURNAL, color: palette.amber, fontSize: 22, fontWeight: '700', fontStyle: 'italic' },

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
  placeNote: { color: palette.moss, fontSize: 13, marginTop: 2 },

  heading: {
    color: palette.moss, fontSize: 14, fontWeight: '700',
    marginTop: 14, marginBottom: 4,
  },
  list: { flex: 1 },
  listInner: { paddingBottom: 12 },
  none: { color: palette.moss, fontSize: 14, lineHeight: 21, marginTop: 8 },
  chat: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 4, minHeight: 60,
    borderBottomWidth: 1, borderBottomColor: palette.sand,
  },
  chatCurrent: { backgroundColor: palette.oat, borderRadius: radius.control, borderBottomColor: palette.oat, paddingHorizontal: 10 },
  chatOpen: { flex: 1 },
  chatTitle: { fontFamily: JOURNAL, color: palette.ink, fontSize: 16, lineHeight: 22 },
  chatNote: { color: palette.moss, fontSize: 13, marginTop: 3 },
  remove: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  removeMark: { width: 20, height: 20, tintColor: palette.clay },
  undoBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, paddingLeft: 16, paddingRight: 6,
    backgroundColor: palette.ink, borderRadius: radius.control, minHeight: 52,
  },
  undoText: { flex: 1, color: palette.cream, fontSize: 15 },
  undo: { minHeight: 44, minWidth: 64, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  // The bar is ink, dark by day and light by night, so the button takes the other set's green: 9.8:1 and 5.5:1.
  undoButton: { color: palette.night ? '#316C33' : palette.sage, fontSize: 15, fontWeight: '700' },

});
