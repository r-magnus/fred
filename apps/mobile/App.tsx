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
  ActivityIndicator, KeyboardAvoidingView, Linking, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MEDICAL_DISCLAIMER, REFER_REPLY, isRefusal, wantsMap, type CardOffer, type Citation, type ClarifyView } from '@fred/rag-core';
import { File, Paths } from 'expo-file-system';
import { loadEngine, describePhase, setVerboseLogging, type Engine, type LoadPhase } from './src/engine.ts';
import { MapPreview, MapScreen } from './src/map-probe.tsx';
import { currentFix, lastKnownFix, describeAccuracy, startRecording, stopRecording,
  isRecording, type LocationFix } from './src/location.ts';

interface Turn {
  readonly id: number;
  readonly question: string;
  readonly state: string | null;
  /** Streams in as tokens arrive. */
  text: string;
  kind: 'answer' | 'abstain' | 'needs-location' | 'error' | 'chat';
  /** True when the reader stopped it; the partial answer is kept. */
  stopped: boolean;
  citations: readonly Citation[];
  medical: boolean;
  /** State packs that would have answered, when the location is unknown. */
  candidateStates: readonly string[];
  done: boolean;
  /** The search's best score, passed on when the next message is a follow-up. */
  topScore?: number;
  /** A field card offered folded (small talk, a decline); opened on tap. */
  offer?: CardOffer;
  offerOpen?: boolean;
  /** "I'm lost", "where am I?", "no signal": a map is shown beside the reply (US-05). */
  map?: boolean;
  /** A card's clarifying question (#50): buttons under the answer until one is used. */
  clarify?: ClarifyView;
  clarifyUsed?: boolean;
}

/**
 * A field card's sources, as the reader would look them up: "ATP 3-50.21
 * pp. 28, 29 · WHO BEC 2018 p. 94".
 */
function describeBasis(basis: NonNullable<Citation['basis']>): string {
  return basis.map((b) => b.pages.length === 0 ? b.source
    : `${b.source} ${b.pages.length === 1 ? 'p.' : 'pp.'} ${b.pages.join(', ')}`).join(' · ');
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
  // send() reads the latest turns without re-creating itself on every token.
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  const [draft, setDraft] = useState('');
  const [state, setState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fix, setFix] = useState<LocationFix | null>(null);
  // Drive-test recording. Long-press the location chip to arm it; see
  // src/location.ts for why it is opt-in and what it writes.
  const [recording, setRecording] = useState(isRecording());
  // The full-screen map: opened from a map in the chat, or by tapping the wordmark.
  const [mapOpen, setMapOpen] = useState(false);
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
    // Conversation memory: the message just before, if Fred answered it. ask()
    // decides whether this one is really a follow-up (docs/plan-memory.md).
    const last = turnsRef.current.at(-1);
    const previous = last !== undefined && last.done && last.kind === 'answer' && !last.stopped &&
      last.topScore !== undefined && last.question !== question
      ? { question: last.question, topScore: last.topScore } : undefined;
    const map = wantsMap(question);
    setTurns((ts) => [...ts, {
      id, question, state: askState, text: '', kind: 'answer',
      citations: [], medical: false, candidateStates: [], done: false, stopped: false, map,
    }]);
    // A map with no position is no use to someone who is lost: find one now,
    // alongside the answer, instead of waiting to be asked.
    if (map && fix === null && !locating) void locate();
    setDraft('');
    setBusy(true);

    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const res = await eng.ask(question, askState, ctrl.signal, previous);
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
      if (res.kind === 'chat') {
        // Small talk: a fixed reply, never model-written advice, and the
        // matching card folded in case it's wanted (docs/results-intent-probe.md).
        update(id, { kind: 'chat', text: res.reply, done: true, ...(res.offer === null ? {} : { offer: res.offer }) });
        return;
      }
      if (res.kind === 'abstain') {
        // A clinical procedure gets a referral, not "I don't know": Fred does
        // know what it is, and knows it is not for a hiker to attempt.
        update(id, {
          kind: 'abstain', text: res.reason === 'provider-only' ? REFER_REPLY : '', done: true,
          ...(res.offer === undefined ? {} : { offer: res.offer }),
        });
        return;
      }
      update(id, {
        citations: res.citations, medical: res.medical, topScore: res.diagnostics.topScore,
        ...(res.clarify === undefined ? {} : { clarify: res.clarify }),
      });
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
      // Logged too, so a harness waiting on the log sees the question end and
      // where it failed ("Exception in HostFunction" alone does not say).
      console.log(`[fred] error ${e instanceof Error ? `${e.message} ${JSON.stringify(e.stack ?? '')}` : String(e)}`);
      update(id, { kind: 'error', text: e instanceof Error ? e.message : String(e), done: true });
    } finally {
      abort.current = null;
      setBusy(false);
    }
  }, [draft, state, busy, update, fix, locating, locate]);

  /**
   * A clarifying-question button (#50). The choice becomes the hiker's reply
   * and the card's steps for it become Fred's, with no search and no model:
   * the text was prepared with the question. Typing a new message instead
   * simply moves on; only the newest answer keeps its buttons.
   */
  const choose = useCallback((from: Turn, label: string, text: string): void => {
    const id = nextId.current++;
    update(from.id, { clarifyUsed: true });
    setTurns((ts) => [...ts, {
      id, question: label, state: from.state, text, kind: 'answer',
      citations: from.citations, medical: from.medical, candidateStates: [], done: true, stopped: false,
    }]);
  }, [update]);
  const input = useRef<TextInput | null>(null);

  /**
   * Development hook: ask questions from the desktop while the phone is locked.
   *
   * Only active when a file named `devhooks` exists in the app's private
   * storage, which only the debug staging flow creates (tools/eval/ask-phone.sh
   * writes it via `adb run-as`, which works only on debuggable builds). The app
   * then checks `devhooks-ask.txt` every two seconds and asks its first line
   * ("question<TAB>state") through the normal screen flow, so timing and
   * retrieval are logged exactly as for a typed question.
   */
  const sendRef = useRef(send);
  sendRef.current = send;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    if (!new File(Paths.document, 'devhooks').exists) return;
    setVerboseLogging(true);
    const inbox = new File(Paths.document, 'devhooks-ask.txt');
    const timer = setInterval(() => {
      if (!inbox.exists || engine.current === null || busyRef.current) return;
      const lines = inbox.textSync().split('\n').filter((l) => l.trim() !== '');
      inbox.delete();
      const [first, ...rest] = lines;
      if (rest.length > 0) inbox.write(rest.join('\n'));
      if (first === undefined) return;
      const [question, st] = first.split('\t');
      console.log(`[fred] devhook ask: ${question}`);
      void sendRef.current(question, st === undefined || st === '' ? null : st);
    }, 2000);
    return () => clearInterval(timer);
  }, []);

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

  if (mapOpen) return <MapScreen onClose={() => setMapOpen(false)} fix={fix} />;
  // Only the newest map in the chat is drawn live; older ones become a button,
  // so a long conversation does not hold a map renderer per lost message.
  const liveMap = turns.findLast((t) => t.map === true)?.id;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => setMapOpen(true)} hitSlop={8}>
          <Text style={styles.wordmarkSmall}>Fred</Text>
        </Pressable>
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

            {t.kind === 'abstain' && t.text === REFER_REPLY && (
              <View style={styles.card}>
                <Text style={styles.body}>{REFER_REPLY}</Text>
              </View>
            )}

            {t.kind === 'abstain' && t.text !== REFER_REPLY && (
              <View style={styles.card}>
                {/* "Where am I?" is not in the manuals, but the map below answers
                    it, so saying "I don't know" first would contradict it. */}
                <Text style={styles.body}>
                  {t.map === true ? 'Here\u2019s where you are.' : 'I don\u2019t have reliable information on that.'}
                </Text>
                {t.map === true && t.offer === undefined ? null : t.offer === undefined ? (
                  <Text style={styles.hint}>
                    Fred only answers from the manuals he carries, and says nothing rather
                    than guessing.
                  </Text>
                ) : (
                  <Text style={styles.hint}>The closest field card, in case it&apos;s what you need:</Text>
                )}
              </View>
            )}

            {t.kind === 'chat' && (
              <View style={styles.card}>
                <Text style={styles.body}>{t.text}</Text>
              </View>
            )}

            {t.offer !== undefined && t.done && (
              <View style={styles.card}>
                <Pressable onPress={() => update(t.id, { offerOpen: !t.offerOpen })} hitSlop={8}
                  accessibilityRole="button" accessibilityState={{ expanded: t.offerOpen === true }}>
                  <Text style={styles.offerTitle}>{t.offerOpen === true ? '▾' : '▸'} What to do: {t.offer.title}</Text>
                </Pressable>
                {t.offerOpen === true && (
                  <>
                    <Text style={styles.body}>{t.offer.text}</Text>
                    <Text style={styles.disclaimer}>{MEDICAL_DISCLAIMER}</Text>
                    <Text style={styles.source}>{t.offer.citation.source} — {t.offer.citation.section}</Text>
                    {t.offer.citation.basis !== undefined && (
                      <Text style={styles.sourceBasis}>from {describeBasis(t.offer.citation.basis)}</Text>
                    )}
                  </>
                )}
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

                {t.done && t.clarify !== undefined && !t.clarifyUsed && t.id === turns.at(-1)?.id && (
                  <View style={styles.clarify}>
                    <Text style={styles.clarifyQ}>
                      {t.clarify.picked === null ? t.clarify.question : `Showing: ${t.clarify.picked}. Not right?`}
                    </Text>
                    <View style={styles.stateRow}>
                      {t.clarify.choices.filter((c) => c.label !== t.clarify!.picked).map((c) => (
                        <Pressable key={c.label} style={styles.stateButton} onPress={() => choose(t, c.label, c.text)}>
                          <Text style={styles.stateButtonText}>{c.label}</Text>
                        </Pressable>
                      ))}
                      {/* Can't tell: the whole card is the safe answer. */}
                      <Pressable style={styles.stateButton}
                        onPress={() => choose(t, t.clarify!.picked === null ? 'Not sure' : 'Show the whole card', t.clarify!.whole)}>
                        <Text style={styles.stateButtonText}>{t.clarify.picked === null ? 'Not sure' : 'Whole card'}</Text>
                      </Pressable>
                      <Pressable style={styles.stateButton} onPress={() => input.current?.focus()}>
                        <Text style={styles.clarifyOther}>Something else…</Text>
                      </Pressable>
                    </View>
                  </View>
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
                      <View key={c.chunkId}>
                        <Text style={styles.source}>
                          {c.source}{c.page === null ? '' : `, p. ${c.page}`} — {c.section}
                        </Text>
                        {c.basis !== undefined && <Text style={styles.sourceBasis}>from {describeBasis(c.basis)}</Text>}
                        {/* Required by CC BY-SA for Wikivoyage passages: article, authors,
                            licence, and a link to the revision quoted (docs/licensing.md). */}
                        {c.credit !== undefined && (
                          <Text style={styles.sourceBasis} onPress={() => void Linking.openURL(c.credit!.url)}>
                            {c.credit.text} <Text style={styles.sourceLink}>Open article</Text>
                          </Text>
                        )}
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

            {t.map === true && (
              <View style={[styles.card, styles.mapCard]}>
                {t.id === liveMap
                  ? <MapPreview fix={fix} onOpen={() => setMapOpen(true)} />
                  : (
                    <Pressable onPress={() => setMapOpen(true)} hitSlop={8} accessibilityRole="button">
                      <Text style={styles.offerTitle}>▸ Open the map</Text>
                    </Pressable>
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
            ref={input}
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
  offerTitle: { color: '#6ca', fontSize: 15, fontWeight: '600' },
  mapCard: { marginTop: 8 },
  clarify: { marginTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#232a2d', paddingTop: 10 },
  clarifyQ: { color: '#eaf2ef', fontSize: 14, fontWeight: '600' },
  clarifyOther: { color: '#8b9a95', fontSize: 13, fontWeight: '600' },
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
  sourceBasis: { color: '#6b7a76', fontSize: 12, lineHeight: 18, marginLeft: 12 },
  sourceLink: { color: '#6ca', textDecorationLine: 'underline' },

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
