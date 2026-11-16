/**
 * The menu button and the drawer it opens: a new chat, the map, About Fred,
 * and past chats.
 *
 * Order follows use (ux-ui-review skill, navigation): a fresh page is what
 * the menu is opened for most, so it comes first and looks like the main
 * action. About Fred was reachable only by tapping the logo, a gesture
 * nobody is told about; it has its own row now as well. Removing a chat is
 * immediate with an Undo, instead of a bin that turns into a tick.
 *
 * The drawer slides in over the chat from the left and closes on its close
 * button, a tap outside it, or the phone's back button.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated, BackHandler, Easing, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { describeWhen, type SavedChat } from './chat-log.ts';
import { Crossfade, radius, sheetFor, useThemed, type Palette } from './theme.tsx';

const LOGO = require('../assets/ui/fred-logo.png');
const LEAF = require('../assets/ui/leaf.png');
const TRASH = require('../assets/ui/trash.png');
const JOURNAL = Platform.select({ ios: 'Georgia', default: 'serif' });

/** The menu button: 48 dp, the size Android asks for (ux-ui-review, touch targets). */
const BUTTON = 48;
/** For placing the button: App.tsx centres it on the logo's line. */
export const MENU_BUTTON_SIZE = BUTTON;
/** How wide the drawer is on a screen this wide. */
const panelWidth = (screen: number): number => Math.min(340, screen * 0.84);
/** How long a removed chat can still be put back. */
const UNDO_MS = 6000;

/**
 * The way into the menu: a round button at the top left, level with the logo
 * opposite. It replaces the bookmark tab on the left edge (#211), which was
 * awkward to reach and to pull, and sat where Android's back swipe starts. A
 * menu button in the top corner is where people already look (NN/g, build on
 * existing mental models). It fades as the drawer covers it; the drawer has
 * its own close button.
 */
export function MenuButton(
  { top, open, slide, onOpen }: { top: number; open: boolean; slide: Animated.Value; onOpen: () => void },
): React.JSX.Element {
  const { styles } = useThemed(makeStyles);
  const fade = slide.interpolate({ inputRange: [0, 0.4], outputRange: [1, 0], extrapolate: 'clamp' });
  return (
    <Animated.View style={[styles.menuBox, { top, opacity: fade }]} pointerEvents={open ? 'none' : 'auto'}>
      <Pressable onPress={onOpen} hitSlop={6} accessibilityRole="button"
        accessibilityLabel="Menu: new chat, map, About Fred and past chats">
        {/* In both colour sets at once: it sits above the veil, so it has to turn with the sky. */}
        <Crossfade render={(p) => {
          const st = sheetFor(makeStyles, p);
          return (
            <View style={st.menu}>
              <View style={st.menuLine} />
              <View style={[st.menuLine, st.menuLineShort]} />
              <View style={st.menuLine} />
            </View>
          );
        }} />
      </Pressable>
    </Animated.View>
  );
}

export function SideDrawer<T>(
  { open, slide, chats, current, onClose, onMap, onAbout, onSetup, onNewChat, onOpenChat, onRemoveChat, onRestoreChat }: {
    open: boolean;
    /** Where the drawer is, 0 shut to 1 open. Shared with MenuButton, which fades as it opens. */
    slide: Animated.Value;
    chats: readonly SavedChat<T>[];
    /** The chat on screen, marked in the list. */
    current: number | null;
    onClose: () => void;
    onMap: () => void;
    onAbout: () => void;
    /** Opens first-run setup again: downloads and states, without clearing anything. */
    onSetup: () => void;
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

  if (!shown && !open) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.over]} pointerEvents={open ? 'auto' : 'none'}>
      <Animated.View style={[styles.scrim, { opacity: slide }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close the menu" />
      </Animated.View>
      <Animated.View style={[styles.panel, {
        width: panel, paddingTop: insets.top + 18, paddingBottom: insets.bottom + 10,
        transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [-panel - 20, 0] }) }],
      }]}>
        <View style={styles.top}>
          <Image source={LOGO} resizeMode="contain" style={styles.logo} accessibilityLabel="Fred" />
          <Pressable onPress={onClose} style={styles.close} hitSlop={6}
            accessibilityRole="button" accessibilityLabel="Close the menu">
            <View style={[styles.closeLine, { transform: [{ rotate: '45deg' }] }]} />
            <View style={[styles.closeLine, { transform: [{ rotate: '-45deg' }] }]} />
          </Pressable>
        </View>

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
        {/* Quiet, at the foot: rarely needed, but setup is otherwise seen once. */}
        <Pressable style={styles.setupAgain} onPress={onSetup} accessibilityRole="button"
          accessibilityLabel="Run setup again: guides, states and downloads">
          <Text style={styles.setupAgainText}>Run setup again</Text>
        </Pressable>
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
  // A round button on the sky, the logo's green with paper lines: 6.2:1 by day, 8.6:1 by night.
  menuBox: { position: 'absolute', left: 14, zIndex: 5 },
  menu: {
    width: BUTTON, height: BUTTON, borderRadius: BUTTON / 2, gap: 4,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.pine, boxShadow: `0 3 10 ${palette.shade}`,
  },
  menuLine: { width: 18, height: 2.5, borderRadius: 2, backgroundColor: palette.paper },
  menuLineShort: { width: 12, alignSelf: 'center' },

  over: { zIndex: 4 },
  scrim: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(43, 53, 44, 0.32)' },
  panel: {
    position: 'absolute', top: 0, bottom: 0, left: 0, paddingHorizontal: 18,
    backgroundColor: palette.cream, borderTopRightRadius: 28, borderBottomRightRadius: 28,
    boxShadow: `6 0 24 ${palette.shade}`,
  },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  logo: { height: 34, width: 34 * (900 / 415), tintColor: palette.logo },
  close: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.oat, alignItems: 'center', justifyContent: 'center' },
  closeLine: { position: 'absolute', width: 16, height: 2.5, borderRadius: 1, backgroundColor: palette.ink },
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
  setupAgain: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start', marginTop: 4 },
  setupAgainText: { color: palette.pine, fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' },
  undoBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, paddingLeft: 16, paddingRight: 6,
    backgroundColor: palette.ink, borderRadius: radius.control, minHeight: 52,
  },
  undoText: { flex: 1, color: palette.cream, fontSize: 15 },
  undo: { minHeight: 44, minWidth: 64, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  // The bar is ink, dark by day and light by night, so the button takes the other set's green: 9.8:1 and 5.5:1.
  undoButton: { color: palette.night ? '#316C33' : palette.sage, fontSize: 15, fontWeight: '700' },

});
