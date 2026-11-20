/**
 * Thumbs up or down under a reply (#247), kept quiet: two small marks at the
 * foot of the reply, not a question put to the hiker. A thumbs down opens one
 * short box, "What can Fred do better?", which may be left empty.
 *
 * The rating itself is kept the moment a thumb is tapped (src/feedback.ts);
 * the box only adds to it. The box says what is sent, because Fred otherwise
 * promises that what you ask stays on the phone.
 */
import { useEffect, useRef, useState } from 'react';
import { Image, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Thumb } from './feedback-outbox.ts';
import { radius, useThemed, type Palette } from './theme.tsx';

const THUMB = require('../assets/ui/thumb-up.png');
const THUMB_ON = require('../assets/ui/thumb-up-filled.png');

/** What the chat keeps of a reply's rating, saved with the chat. */
export interface ReplyRating {
  /** The id the rating is sent under, the same for every change to it. */
  readonly id: string;
  readonly thumb: Thumb;
  readonly comment?: string;
  /** The box under a thumbs down is closed: sent, or passed over. */
  readonly closed?: boolean;
}

export function RateReply(
  { value, onRate, onComment, onReveal }: {
    value: ReplyRating | undefined;
    onRate: (thumb: Thumb) => void;
    /** The words from the box; null when it was closed without any. */
    onComment: (text: string | null) => void;
    /**
     * Brings the box into sight. It opens below the reply, often under the
     * edge of the chat, and the keyboard covered its Send button (seen on
     * the phone, 2026-11-19).
     */
    onReveal?: (box: View) => void;
  },
): React.JSX.Element {
  const { palette, styles } = useThemed(makeStyles);
  const [draft, setDraft] = useState('');
  // Thanks is said once, just after rating, not under every rated reply in past chats.
  const [said, setSaid] = useState(false);
  const open = value?.thumb === 'down' && value.closed !== true;
  const box = useRef<View>(null);
  const revealRef = useRef(onReveal);
  revealRef.current = onReveal;
  const reveal = (): void => { if (box.current !== null) revealRef.current?.(box.current); };
  // Once laid out, when it opens.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(reveal, 80);
    return () => clearTimeout(t);
  }, [open]);
  // Again once the keyboard is up and the chat has made room for it.
  useEffect(() => {
    if (!open) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const sub = Keyboard.addListener('keyboardDidShow', () => { t = setTimeout(reveal, 150); });
    return () => { sub.remove(); if (t !== undefined) clearTimeout(t); };
  }, [open]);

  const mark = (thumb: Thumb): React.JSX.Element => {
    const on = value?.thumb === thumb;
    return (
      <Pressable onPress={() => { if (!on) { setSaid(true); onRate(thumb); } }} hitSlop={8} style={styles.thumb}
        accessibilityRole="button" accessibilityState={{ selected: on }}
        accessibilityLabel={thumb === 'up' ? 'Good reply' : 'Not a good reply'}
        accessibilityHint={on ? undefined : 'Sends your rating to the Fred team'}>
        <Image source={on ? THUMB_ON : THUMB} resizeMode="contain"
          style={[styles.thumbMark, thumb === 'down' && styles.down, { tintColor: on ? palette.pine : palette.moss }, !on && styles.quiet]} />
      </Pressable>
    );
  };

  return (
    <View>
      <View style={styles.row}>
        {said && value !== undefined && !open && (
          <Text style={styles.thanks} accessibilityLiveRegion="polite">
            {value.thumb === 'up' ? 'Thanks!' : 'Thanks, that helps.'}
          </Text>
        )}
        {mark('up')}
        {mark('down')}
      </View>
      {open && (
        <View style={styles.box} ref={box}>
          <Text style={styles.ask}>What can Fred do better?</Text>
          <TextInput value={draft} onChangeText={setDraft} multiline maxLength={2000}
            placeholder="Wrong, unclear, missing something…" placeholderTextColor={palette.moss}
            style={styles.input} accessibilityLabel="What can Fred do better?" />
          <Text style={styles.note}>Your question and Fred&apos;s reply are sent with your rating. Your location is not.</Text>
          <View style={styles.buttons}>
            <Pressable onPress={() => onComment(null)} hitSlop={8} accessibilityRole="button" style={styles.skip}>
              <Text style={styles.skipText}>Not now</Text>
            </Pressable>
            <Pressable onPress={() => onComment(draft.trim() === '' ? null : draft.trim())} accessibilityRole="button"
              style={styles.send}>
              <Text style={styles.sendText}>Send</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 2, marginTop: -4 },
  thumb: { width: 40, height: 36, alignItems: 'center', justifyContent: 'center' },
  thumbMark: { width: 17, height: 17 },
  down: { transform: [{ rotate: '180deg' }] },
  quiet: { opacity: 0.55 },
  thanks: { color: palette.moss, fontSize: 13, marginRight: 4 },
  box: {
    marginTop: 4, padding: 14, gap: 8, borderRadius: radius.card,
    backgroundColor: palette.paper, borderWidth: 1, borderColor: palette.sand,
  },
  ask: { color: palette.ink, fontSize: 15, fontWeight: '600' },
  input: {
    minHeight: 72, maxHeight: 160, textAlignVertical: 'top', color: palette.ink, fontSize: 15,
    borderRadius: radius.control, borderWidth: 1, borderColor: palette.sand, backgroundColor: palette.cream,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  note: { color: palette.moss, fontSize: 12, lineHeight: 17 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 16 },
  skip: { paddingVertical: 10 },
  skipText: { color: palette.moss, fontSize: 15, fontWeight: '600' },
  send: { borderRadius: radius.control, backgroundColor: palette.pine, paddingHorizontal: 18, paddingVertical: 10 },
  sendText: { color: palette.paper, fontSize: 15, fontWeight: '700' },
});
