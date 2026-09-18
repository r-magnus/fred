/**
 * Fred — ask a question, get an answer with its sources.
 *
 * Replaces the M3 pipeline harness, which ran four fixed questions on mount and
 * logged to adb. The engine now lives in src/engine.ts and stays resident; this
 * file is only the screen.
 *
 * Three outcomes have to be visible, not just the happy one. `ask()` can return
 * an answer, an abstention, or a request for a location, and each means something
 * different to a person in the field — "I don't know" and "which state are you
 * in?" are useful answers, and collapsing them into a blank screen would hide the
 * abstention behaviour that most of the accuracy work went into.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, SafeAreaView,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { MEDICAL_DISCLAIMER, type Citation } from '@fred/rag-core';
import { loadEngine, describePhase, type Engine, type LoadPhase } from './src/engine.ts';

interface Turn {
  readonly id: number;
  readonly question: string;
  readonly state: string | null;
  /** Streams in as tokens arrive. */
  text: string;
  kind: 'answer' | 'abstain' | 'needs-location' | 'error';
  citations: readonly Citation[];
  medical: boolean;
  /** State packs that would have answered, when the location is unknown. */
  candidateStates: readonly string[];
  done: boolean;
}

export default function App() {
  const [load, setLoad] = useState<LoadPhase>({ phase: 'idle' });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [state, setState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const engine = useRef<Engine | null>(null);
  const scroller = useRef<ScrollView | null>(null);
  const nextId = useRef(1);

  useEffect(() => {
    let live = true;
    void loadEngine((p) => { if (live) setLoad(p); })
      .then((e) => { if (live) engine.current = e; })
      .catch(() => { /* phase already carries the message */ });
    return () => {
      live = false;
      void engine.current?.release();
    };
  }, []);

  const update = useCallback((id: number, patch: Partial<Turn>): void => {
    setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const send = useCallback(async (questionText?: string, withState?: string | null) => {
    const question = (questionText ?? draft).trim();
    const eng = engine.current;
    if (question === '' || eng === null || busy) return;

    const id = nextId.current++;
    const askState = withState === undefined ? state : withState;
    setTurns((ts) => [...ts, {
      id, question, state: askState, text: '', kind: 'answer',
      citations: [], medical: false, candidateStates: [], done: false,
    }]);
    setDraft('');
    setBusy(true);

    try {
      const res = await eng.ask(question, askState);
      if (res.kind === 'needs-location') {
        update(id, {
          kind: 'needs-location', done: true,
          // Pack ids look like "state-CA-flora-fauna"; surface just the state.
          candidateStates: res.candidatePacks
            .map((p) => /^state-([A-Z]{2})-/.exec(p)?.[1])
            .filter((s): s is string => s !== undefined),
        });
        return;
      }
      if (res.kind === 'abstain') {
        update(id, { kind: 'abstain', done: true });
        return;
      }
      update(id, { citations: res.citations, medical: res.medical });
      let text = '';
      for await (const tok of res.stream) {
        text += tok;
        update(id, { text });
      }
      update(id, { done: true });
    } catch (e) {
      update(id, { kind: 'error', text: e instanceof Error ? e.message : String(e), done: true });
    } finally {
      setBusy(false);
    }
  }, [draft, state, busy, update]);

  if (load.phase !== 'ready') {
    const failed = load.phase === 'failed';
    return (
      <SafeAreaView style={[styles.root, styles.centre]}>
        <Text style={styles.wordmark}>Fred</Text>
        {!failed && <ActivityIndicator color="#6ca" style={{ marginVertical: 18 }} />}
        <Text style={failed ? styles.loadFailed : styles.loadNote}>{describePhase(load)}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.wordmarkSmall}>Fred</Text>
        <Pressable onPress={() => setState(null)} hitSlop={8}>
          <Text style={styles.stateChip}>{state ?? 'no location'}</Text>
        </Pressable>
      </View>

      <ScrollView
        ref={scroller}
        style={styles.thread}
        contentContainerStyle={styles.threadInner}
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
      >
        {turns.length === 0 && (
          <Text style={styles.empty}>
            Ask about first aid, survival, or the plants and animals around you.
            {'\n\n'}Fred works offline and will say when he doesn&apos;t know.
          </Text>
        )}

        {turns.map((t) => (
          <View key={t.id} style={styles.turn}>
            <Text style={styles.question}>{t.question}</Text>

            {t.kind === 'needs-location' && (
              <View style={styles.card}>
                <Text style={styles.body}>
                  That depends on where you are. Which state?
                </Text>
                <View style={styles.stateRow}>
                  {(t.candidateStates.length > 0 ? t.candidateStates : engine.current?.availableStates() ?? [])
                    .slice(0, 12)
                    .map((s) => (
                      <Pressable
                        key={s}
                        style={styles.stateButton}
                        onPress={() => { setState(s); void send(t.question, s); }}
                      >
                        <Text style={styles.stateButtonText}>{s}</Text>
                      </Pressable>
                    ))}
                </View>
              </View>
            )}

            {t.kind === 'abstain' && (
              <View style={styles.card}>
                <Text style={styles.body}>I don&apos;t have reliable information on that.</Text>
                <Text style={styles.hint}>
                  Fred only answers from the manuals he carries, and says nothing rather
                  than guessing.
                </Text>
              </View>
            )}

            {t.kind === 'error' && (
              <View style={styles.card}><Text style={styles.error}>{t.text}</Text></View>
            )}

            {t.kind === 'answer' && (
              <View style={styles.card}>
                {t.text === '' && !t.done
                  ? <ActivityIndicator color="#6ca" />
                  : <Text style={styles.body}>{t.text}</Text>}

                {t.medical && t.done && <Text style={styles.disclaimer}>{MEDICAL_DISCLAIMER}</Text>}

                {t.done && t.citations.length > 0 && (
                  <View style={styles.sources}>
                    {/* US-03. The only way a reader can tell a good answer from a
                        confident wrong one, so it is not hidden behind a tap. */}
                    <Text style={styles.sourcesTitle}>Sources</Text>
                    {t.citations.map((c) => (
                      <Text key={c.chunkId} style={styles.source}>
                        {c.source}{c.page === null ? '' : `, p. ${c.page}`} — {c.section}
                      </Text>
                    ))}
                  </View>
                )}
              </View>
            )}
          </View>
        ))}
      </ScrollView>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Ask Fred…"
            placeholderTextColor="#667"
            editable={!busy}
            multiline
            onSubmitEditing={() => void send()}
          />
          <Pressable
            style={[styles.send, (busy || draft.trim() === '') && styles.sendOff]}
            onPress={() => void send()}
            disabled={busy || draft.trim() === ''}
          >
            <Text style={styles.sendText}>{busy ? '…' : 'Ask'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0e1113' },
  centre: { alignItems: 'center', justifyContent: 'center' },
  wordmark: { color: '#eaf2ef', fontSize: 40, fontWeight: '700', letterSpacing: 1 },
  wordmarkSmall: { color: '#eaf2ef', fontSize: 20, fontWeight: '700' },
  loadNote: { color: '#8b9a95', fontSize: 14 },
  loadFailed: { color: '#e88', fontSize: 13, textAlign: 'center', paddingHorizontal: 32, lineHeight: 19 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: 14, paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#232a2d',
  },
  stateChip: {
    color: '#6ca', fontSize: 12, fontWeight: '600',
    borderWidth: 1, borderColor: '#2a3a35', borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 4, overflow: 'hidden',
  },

  thread: { flex: 1 },
  threadInner: { padding: 18, paddingBottom: 8 },
  empty: { color: '#6b7a76', fontSize: 15, lineHeight: 22, marginTop: 40, textAlign: 'center' },

  turn: { marginBottom: 22 },
  question: { color: '#eaf2ef', fontSize: 16, fontWeight: '600', marginBottom: 10 },
  card: { backgroundColor: '#161b1e', borderRadius: 12, padding: 14 },
  body: { color: '#d7e0dd', fontSize: 15, lineHeight: 22 },
  hint: { color: '#6b7a76', fontSize: 12, lineHeight: 17, marginTop: 8 },
  error: { color: '#e88', fontSize: 13, lineHeight: 18 },
  disclaimer: {
    color: '#c9a', fontSize: 12, lineHeight: 17, marginTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#2a2430', paddingTop: 10,
  },

  sources: { marginTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#232a2d', paddingTop: 10 },
  sourcesTitle: { color: '#6ca', fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 6 },
  source: { color: '#8b9a95', fontSize: 12, lineHeight: 18 },

  stateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  stateButton: { backgroundColor: '#1d2529', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  stateButtonText: { color: '#d7e0dd', fontSize: 13, fontWeight: '600' },

  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#232a2d',
  },
  input: {
    flex: 1, color: '#eaf2ef', fontSize: 15, maxHeight: 120,
    backgroundColor: '#161b1e', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
  },
  send: { backgroundColor: '#2f7d63', borderRadius: 10, paddingHorizontal: 18, paddingVertical: 12 },
  sendOff: { backgroundColor: '#243029' },
  sendText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
