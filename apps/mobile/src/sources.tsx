/**
 * Where an answer came from (US-03, #215), as one compact line under the
 * answer that opens to show the passages themselves.
 *
 * The full block after every reply was heavy and repetitive, and named a book
 * and a section heading without showing what the answer was drawn from. NN/g
 * (Explainable AI in chat interfaces): keep the basis of an answer visible,
 * make citations distinct from the answer, label them descriptively, and let
 * the reader reach the passage itself. So the book's name stays in plain
 * sight, and the rest is one tap away.
 *
 * The Wikivoyage credit (article, authors, licence, link) stays with its
 * passage whenever it is shown (docs/licensing.md).
 */
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Citation } from '@fred/rag-core';
import { radius, useThemed, type Palette } from './theme.tsx';

/** A field card's sources, as the reader would look them up: "ATP 3-50.21 pp. 28, 29 · ...". */
export function describeBasis(basis: NonNullable<Citation['basis']>): string {
  return basis.map((b) => b.pages.length === 0 ? b.source
    : `${b.source} ${b.pages.length === 1 ? 'p.' : 'pp.'} ${b.pages.join(', ')}`).join(' · ');
}

/** The book names in reading order, each once: what the closed line says. */
function bookNames(cs: readonly Citation[]): string[] {
  const names: string[] = [];
  for (const c of cs) {
    const name = c.source === 'Fred field card' && c.basis !== undefined && c.basis.length > 0
      ? `Field card from ${c.basis[0]!.source}` : c.source;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** Two passages can share a page and section, which reads as the same line twice. */
function dedupe(cs: readonly Citation[]): Citation[] {
  return [...new Map(cs.map((c) => [`${c.source}|${c.page}|${c.section}`, c])).values()];
}

export function Sources({ citations }: { citations: readonly Citation[] }): React.JSX.Element | null {
  const { styles } = useThemed(makeStyles);
  const [open, setOpen] = useState(false);
  const shown = dedupe(citations);
  if (shown.length === 0) return null;
  const names = bookNames(shown);
  const summary = names.length === 1 ? names[0]! : `${names[0]!} and ${names.length - 1} more`;
  return (
    <View style={styles.wrap}>
      <Pressable onPress={() => setOpen((o) => !o)} style={styles.toggle}
        accessibilityRole="button" accessibilityState={{ expanded: open }}
        accessibilityLabel={`Sources: ${names.join(', ')}`}
        accessibilityHint={open ? 'Hides the passages' : 'Shows the passages this answer came from'}>
        <Text style={styles.label}>Sources</Text>
        <Text style={styles.summary} numberOfLines={1}>{summary}</Text>
        <Text style={styles.chevron} importantForAccessibility="no">{open ? '▴' : '▾'}</Text>
      </Pressable>
      {open && shown.map((c) => (
        <View key={c.chunkId} style={styles.item}>
          <Text style={styles.where}>
            {c.source}{c.page === null ? '' : `, p. ${c.page}`}
            {c.section === '' ? '' : <Text style={styles.section}>{` · ${c.section}`}</Text>}
          </Text>
          {c.passage !== undefined && <Passage text={c.passage} />}
          {c.basis !== undefined && <Text style={styles.basis}>Written from {describeBasis(c.basis)}</Text>}
          {/* Required by CC BY-SA for Wikivoyage passages (docs/licensing.md). */}
          {c.credit !== undefined && (
            <>
              <Text style={styles.basis}>{c.credit.text}</Text>
              <Pressable onPress={() => void Linking.openURL(c.credit!.url)} style={styles.link}
                accessibilityRole="link" accessibilityLabel="Open the Wikivoyage article">
                <Text style={styles.linkText}>Open article</Text>
              </Pressable>
            </>
          )}
        </View>
      ))}
    </View>
  );
}

/** Long passages start folded to a few lines; the rest on a tap. */
const FOLD_AT = 320;
function Passage({ text }: { text: string }): React.JSX.Element {
  const { styles } = useThemed(makeStyles);
  const clean = text.replace(/\s*\n\s*/g, ' ').trim();
  const long = clean.length > FOLD_AT;
  const [all, setAll] = useState(!long);
  return (
    <View style={styles.quote}>
      <Text style={styles.quoteText}>{all ? clean : `${clean.slice(0, FOLD_AT).replace(/\s+\S*$/, '')}…`}</Text>
      {long && (
        <Pressable onPress={() => setAll((a) => !a)} style={styles.link} accessibilityRole="button">
          <Text style={styles.linkText}>{all ? 'Show less' : 'Show the whole passage'}</Text>
        </Pressable>
      )}
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  wrap: { marginTop: 14, borderTopWidth: 1, borderTopColor: palette.sand },
  // A whole row to tap, 48 high: the summary alone would be a small target.
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 },
  label: { color: palette.pine, fontSize: 14, fontWeight: '700' },
  summary: { flex: 1, color: palette.moss, fontSize: 14 },
  chevron: { color: palette.pine, fontSize: 14, width: 18, textAlign: 'center' },
  item: { paddingBottom: 12, gap: 6 },
  where: { color: palette.ink, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  section: { color: palette.moss, fontWeight: '400' },
  basis: { color: palette.moss, fontSize: 13, lineHeight: 19 },
  quote: {
    borderLeftWidth: 3, borderLeftColor: palette.leaf, backgroundColor: palette.paper,
    borderRadius: radius.control, borderTopLeftRadius: 4, borderBottomLeftRadius: 4,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  quoteText: { color: palette.ink, fontSize: 14, lineHeight: 21 },
  link: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  linkText: { color: palette.pine, fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },
});
