/**
 * Fred — ask a question, get an answer with its sources.
 *
 * Replaces the M3 pipeline harness, which ran four fixed questions on mount and
 * logged to adb. The engine now lives in src/engine.ts and stays resident; this
 * file is only the screen.
 *
 * Insets come from react-native-safe-area-context. React Native 0.86 turns on
 * edge-to-edge for Android 15+, so the app draws under the status bar — the
 * first build rendered "Fred" on top of the clock. That was held together with
 * StatusBar.currentHeight while the project had no JDK to rebuild native
 * modules with; the real measurement is back now, and it is also what iOS will
 * need, where StatusBar.currentHeight is undefined.
 *
 * Three outcomes have to be visible, not just the happy one. `ask()` can return
 * an answer, an abstention, or a request for a location, and each means something
 * different to a person in the field — "I don't know" and "which state are you
 * in?" are useful answers, and collapsing them into a blank screen would hide the
 * abstention behaviour that most of the accuracy work went into.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MEDICAL_DISCLAIMER, isRefusal, type Citation } from '@fred/rag-core';
import { loadEngine, describePhase, type Engine, type LoadPhase } from './src/engine.ts';
import { currentFix, lastKnownFix, describeAccuracy, startRecording, stopRecording,
  isRecording, type LocationFix } from './src/location.ts';

interface Turn {
  readonly id: number;
  readonly question: string;
  readonly state: string | null;
  /** Streams in as tokens arrive. */
  text: string;
  kind: 'answer' | 'abstain' | 'needs-location' | 'error';
  /** True when the reader stopped it; the partial answer is kept. */
  stopped: boolean;
  citations: readonly Citation[];
  medical: boolean;
  /** State packs that would have answered, when the location is unknown. */
  candidateStates: readonly string[];
  done: boolean;
}

/** The provider has to sit above anything calling useSafeAreaInsets. */
export default function App() {
  return (
    <SafeAreaProvider>
      <Screen />
    </SafeAreaProvider>
  );
}

function Screen() {
  const insets = useSafeAreaInsets();
  const [load, setLoad] = useState<LoadPhase>({ phase: 'idle' });
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [state, setState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fix, setFix] = useState<LocationFix | null>(null);
  // Drive-test recording. Long-press the location chip to arm it; see
  // src/location.ts for why it is opt-in and what it writes.
  const [recording, setRecording] = useState(isRecording());
  const [locating, setLocating] = useState(false);
  const [locProgress, setLocProgress] = useState<number | null>(null);
  const [locNote, setLocNote] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
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

  /**
   * A cached fix costs nothing and prompts for nothing — getLastKnownPositionAsync
   * returns null unless permission is already granted — so the second run of the
   * app knows the state before the reader types anything. A cold GPS lock takes
   * 5-30 s outdoors and longer under canopy, which is too long to block on.
   */
  useEffect(() => {
    let live = true;
    void lastKnownFix().then((f) => {
      if (!live || f === null || f.state === null) return;
      setFix(f);
      setState((s) => s ?? f.state);
    });
    return () => { live = false; };
  }, []);

  const locate = useCallback(async (): Promise<string | null> => {
    setLocating(true);
    setLocProgress(null);
    setLocNote(null);
    try {
      const res = await currentFix({ onProgress: setLocProgress });
      if (!res.ok) { setLocNote(res.message); return null; }
      setFix(res.fix);
      if (res.fix.state === null) {
        setLocNote("You're outside the states Fred carries guides for.");
        return null;
      }
      setState(res.fix.state);
      return res.fix.state;
    } finally {
      setLocating(false);
      setLocProgress(null);
    }
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
      citations: [], medical: false, candidateStates: [], done: false, stopped: false,
    }]);
    setDraft('');
    setBusy(true);

    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const res = await eng.ask(question, askState, ctrl.signal);
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
      // The model can decline even when retrieval scored above the gate. Showing
      // that with sources and a medical disclaimer would read as a sourced
      // answer, so it is rendered as the abstention it is.
      update(id, isRefusal(text)
        ? { kind: 'abstain', done: true }
        : { done: true, stopped: ctrl.signal.aborted });
    } catch (e) {
      update(id, { kind: 'error', text: e instanceof Error ? e.message : String(e), done: true });
    } finally {
      abort.current = null;
      setBusy(false);
    }
  }, [draft, state, busy, update]);

  if (load.phase !== 'ready') {
    const failed = load.phase === 'failed';
    return (
      <View style={[styles.root, styles.centre]}>
        <Text style={styles.wordmark}>Fred</Text>
        {!failed && <ActivityIndicator color="#6ca" style={{ marginVertical: 18 }} />}
        <Text style={failed ? styles.loadFailed : styles.loadNote}>{describePhase(load)}</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.wordmarkSmall}>Fred</Text>
        {/* B-KR1. The accuracy is on screen rather than in a log because the
            key result is verified by standing somewhere and reading it, and
            because a ±2 km fix and a ±8 m one should not look the same to a
            reader deciding whether to trust the local guide. */}
        <Pressable
          onPress={() => void locate()}
          onLongPress={() => {
            // Long-press rather than a visible control: this writes coordinates
            // to disk and exists for verifying B-KR1/2/3, not for daily use.
            if (recording) {
              const s = stopRecording();
              setRecording(false);
              // Rounded: the platform reports full float precision, and
              // "27.40999984741211 m" is not a number anyone reads in a car.
              const m = (v: number | null): string => (v === null ? '?' : v.toFixed(1));
              setLocNote(s === null ? 'Recording stopped.'
                : `Track: ${s.samples} samples, best ${m(s.bestAccuracyMeters)} m, `
                  + `median ${m(s.medianAccuracyMeters)} m`
                  + `${s.timeToTargetMs === null ? ', target never met' : `, target in ${(s.timeToTargetMs / 1000).toFixed(1)} s`}`
                  + `${s.watchSamples > 0 ? `, ${s.watchSamples} auto over ${(s.durationMs / 60000).toFixed(1)} min` : ''}`
                  + `${s.states.length > 0 ? `, ${s.states.join('/')}` : ''}`
                  + `${s.anyMocked ? ' — MOCKED' : ''}`);
            } else {
              setRecording(true);
              setLocNote('Recording…');
              void startRecording().then((path) => {
                setLocNote(`Recording to ${path.split('/').pop() ?? path} — no need to touch the phone`);
              });
            }
          }}
          hitSlop={8}
          disabled={locating}
        >
          <Text style={[styles.stateChip, recording && styles.stateChipRecording]}>
            {locating ? (locProgress === null ? 'locating…' : `±${Math.round(locProgress)} m…`)
              : state === null ? 'use location'
              : fix !== null && fix.state === state ? `${state} ${describeAccuracy(fix)}`
              : state}
          </Text>
        </Pressable>
      </View>

      {locNote !== null && (
        <Pressable onPress={() => setLocNote(null)}>
          <Text style={styles.locNote}>{locNote}</Text>
        </Pressable>
      )}

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
                <Pressable
                  style={styles.locateButton}
                  disabled={locating}
                  onPress={() => void locate().then((s) => { if (s !== null) void send(t.question, s); })}
                >
                  <Text style={styles.locateButtonText}>
                    {locating ? 'Locating…' : 'Use my location'}
                  </Text>
                </Pressable>
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
                {t.text === '' && !t.done && <ActivityIndicator color="#6ca" />}
                {t.text !== '' && <Text style={styles.body}>{t.text}</Text>}

                {/* Time-to-first-token is ~7 s on device, so a reader who stops
                    early gets no text at all. Rendering an empty body plus
                    "incomplete" reads as a bug; say what actually happened. */}
                {t.stopped && (
                  <Text style={styles.stoppedNote}>
                    {t.text === ''
                      ? 'Stopped before Fred began answering.'
                      : 'Stopped — this answer is incomplete.'}
                  </Text>
                )}

                {t.medical && t.done && <Text style={styles.disclaimer}>{MEDICAL_DISCLAIMER}</Text>}

                {t.done && t.citations.length > 0 && (
                  <View style={styles.sources}>
                    {/* US-03. The only way a reader can tell a good answer from a
                        confident wrong one, so it is not hidden behind a tap. */}
                    <Text style={styles.sourcesTitle}>Sources</Text>
                    {/* Two chunks can share a page and section, which renders as
                        the same line twice. Dedupe on what the reader sees. */}
                    {[...new Map(t.citations.map((c) => [
                      `${c.source}|${c.page}|${c.section}`, c,
                    ])).values()].map((c) => (
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

      {/* 'padding' on Android too. The usual Android answer is adjustResize in
          the manifest, but edge-to-edge (RN 0.86, Android 15+) means the window
          no longer resizes for the keyboard — the first build buried the
          composer under it. */}
      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0}>
        <View style={[styles.composer, { paddingBottom: insets.bottom + 12 }]}>
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
          {/* US-07. One button: Ask, then Stop while an answer is running. A
              separate control would be dead weight most of the time, and at ~15 s
              per answer the reader needs the exit where their thumb already is. */}
          <Pressable
            style={[
              styles.send,
              busy && styles.sendStop,
              !busy && draft.trim() === '' && styles.sendOff,
            ]}
            onPress={() => (busy ? abort.current?.abort() : void send())}
            disabled={!busy && draft.trim() === ''}
          >
            <Text style={styles.sendText}>{busy ? 'Stop' : 'Ask'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
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
    paddingHorizontal: 18, paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#232a2d',
  },
  stateChip: {
    color: '#6ca', fontSize: 12, fontWeight: '600',
    borderWidth: 1, borderColor: '#2a3a35', borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 4, overflow: 'hidden',
  },
  // Armed recording has to be obvious at a glance: it writes coordinates, and
  // nobody should drive home unaware it is still running.
  stateChipRecording: { color: '#e88', borderColor: '#5a2a2a' },

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

  locNote: {
    color: '#e0c98a', fontSize: 13, backgroundColor: '#241f16',
    paddingHorizontal: 16, paddingVertical: 10,
  },
  locateButton: {
    alignSelf: 'flex-start', marginTop: 12, borderRadius: 8,
    borderWidth: 1, borderColor: '#2f4a42', paddingHorizontal: 12, paddingVertical: 8,
  },
  locateButtonText: { color: '#6ca', fontSize: 13, fontWeight: '600' },
  stateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  stateButton: { backgroundColor: '#1d2529', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  stateButtonText: { color: '#d7e0dd', fontSize: 13, fontWeight: '600' },

  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 14, paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#232a2d',
  },
  input: {
    flex: 1, color: '#eaf2ef', fontSize: 15, maxHeight: 120,
    backgroundColor: '#161b1e', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
  },
  send: { backgroundColor: '#2f7d63', borderRadius: 10, paddingHorizontal: 18, paddingVertical: 12 },
  sendOff: { backgroundColor: '#243029' },
  sendStop: { backgroundColor: '#7d3a2f' },
  stoppedNote: { color: '#d9a', fontSize: 12, marginTop: 10, fontStyle: 'italic' },
  sendText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
