/**
 * Fred's reply, laid out (#209): numbered steps with a round badge, bullets,
 * the "Don't" lines gathered in one soft warning block, and bold where the
 * text asks for it. The words themselves come from reply-format.ts unchanged.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { layout, spoken, type Span } from './reply-format.ts';
import { useThemed, type Palette } from './theme.tsx';

function Runs({ spans, bold }: { spans: readonly Span[]; bold: object }): React.JSX.Element {
  return <>{spans.map((s, i) => (s.bold ? <Text key={i} style={bold}>{s.text}</Text> : s.text))}</>;
}

export function ReplyText({ text }: { text: string }): React.JSX.Element {
  const { styles } = useThemed(makeStyles);
  const blocks = layout(text);
  return (
    <View style={styles.wrap}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case 'para':
            return <Text key={i} style={styles.body}><Runs spans={b.spans} bold={styles.bold} /></Text>;
          case 'heading':
            return <Text key={i} style={styles.heading} accessibilityRole="header">{b.text}</Text>;
          case 'step':
            return (
              <View key={i} style={styles.row} accessible accessibilityLabel={`Step ${b.n}. ${spoken(b.spans)}`}>
                <View style={styles.badge}><Text style={styles.badgeText}>{b.n}</Text></View>
                <Text style={[styles.body, styles.rowText]}><Runs spans={b.spans} bold={styles.bold} /></Text>
              </View>
            );
          case 'bullet':
            return (
              <View key={i} style={styles.row}>
                <View style={styles.dotBox}><View style={styles.dot} /></View>
                <Text style={[styles.body, styles.rowText]}><Runs spans={b.spans} bold={styles.bold} /></Text>
              </View>
            );
          case 'warn':
            return (
              <View key={i} style={styles.warn}>
                {b.lines.map((l, j) => (
                  <Text key={j} style={styles.body}><Runs spans={l} bold={styles.warnBold} /></Text>
                ))}
              </View>
            );
        }
      })}
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  wrap: { gap: 10 },
  body: { color: palette.ink, fontSize: 16, lineHeight: 24 },
  bold: { fontWeight: '700' },
  heading: { color: palette.pine, fontSize: 14, fontWeight: '700', marginTop: 4 },
  row: { flexDirection: 'row', gap: 10 },
  rowText: { flex: 1 },
  // A 22 pt disc, its number centred on the line's first baseline (24 pt line).
  badge: {
    minWidth: 22, minHeight: 22, borderRadius: 11, marginTop: 1, paddingHorizontal: 4,
    backgroundColor: palette.sage, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: palette.pine, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  dotBox: { width: 22, height: 24, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.leaf },
  warn: { backgroundColor: palette.blush, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  warnBold: { fontWeight: '700', color: palette.warn },
});
