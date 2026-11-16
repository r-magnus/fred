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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, Image, KeyboardAvoidingView, Linking, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CONDITION_HISTORY, MEDICAL_DISCLAIMER, REFER_REPLY, SAFETY_NET_REPLY, WATCH_REPLY, declineReply, isRefusal, typeOut, wantsMap, wantsSignal, type CardOffer, type Citation, type ClarifyView, type DeclineReply, type LinePart } from '@fred/rag-core';

/** One piece of fixed text as a stream, for typeOut. */
async function* oneShot(text: string): AsyncIterable<string> { yield text; }
import { File, Paths } from 'expo-file-system';
import { loadEngine, describePhase, setVerboseLogging, type Engine, type LoadPhase } from './src/engine.ts';
import { beginAnswer, ceilingEstimate, endAnswer, estimateFor, sampleIdle } from './src/battery.ts';
import { MapPreview, MapScreen } from './src/map-probe.tsx';
import { signalAdvice } from './src/coverage-layer.ts';
import { JumpToEnd } from './src/jump-to-end.tsx';
import { CalmLoader } from './src/calm-loader.tsx';
import { ReplyText } from './src/reply-text.tsx';
import { Scene } from './src/scene.tsx';
import { SIDE_TAB_HEIGHT, SideDrawer, SideTab } from './src/side-drawer.tsx';
import { SetupWizard } from './src/setup-wizard.tsx';
import { guidesOnPhone, markSetupDone, wizardWanted } from './src/setup.ts';
import { loadChats, removeChat, saveChat, type SavedChat } from './src/chat-log.ts';
import { AboutScreen } from './src/about.tsx';
import { GREETINGS, TOPICS, pick } from './src/words.ts';
import { Crossfade, SUNSET, ThemeProvider, Veil, radius, useTheme, useThemed, type Palette } from './src/theme.tsx';

/** The logo is 900 x 415; sized by height wherever it is shown. */
const LOGO = require('./assets/ui/fred-logo.png');
const LOGO_RATIO = 900 / 415;
/** The small logo's height in the sky. */
const LOGO_HEIGHT = 28;
/**
 * #209: the line, below the status bar, that the logo (top right) and the menu
 * tab (left edge) are both centred on, so they sit opposite each other.
 */
const TOP_ROW = 30;
const ARROW = require('./assets/ui/arrow-up.png');
/** The hiker's own words are set like a journal entry; Fred's stay in the plain reading face. */
const JOURNAL = Platform.select({ ios: 'Georgia', default: 'serif' });

import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { currentFix, lastKnownFix, describeAccuracy, startRecording, stopRecording,
  isRecording, type LocationFix } from './src/location.ts';

/** Earlier messages older than this are not read with a new one (#98). */
const HISTORY_WINDOW_MS = 30 * 60 * 1000;

interface Turn {
  readonly id: number;
  readonly question: string;
  /** When it was asked (ms). Only recent messages are passed as history (#98). */
  readonly askedAt: number;
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
  /**
   * #77: the reply to a signal question, "Nearest reported coverage: about
   * 3.2 km north-east." It is the map's own sentence for where the hiker stood.
   */
  signal?: string;
  /** A card's clarifying question (#50): buttons under the answer until one is used. */
  clarify?: ClarifyView;
  clarifyUsed?: boolean;
  /** The opening line (#130) is shown and the answer has not started: a wait of about 10 s. */
  waiting?: boolean;
  /** Asked by the desktop test hook, not typed: such a chat is not kept in past chats. */
  hook?: boolean;
  /** Asked with deep thinking on (#21). */
  deep?: boolean;
  /** #172: a first line before the safety-net or watch reply. */
  lead?: string;
  /** #172: what a plain decline says, fitted to the message. */
  decline?: DeclineReply;
}

/**
 * The jump-to-end hint shows when more than this share of a screen of chat is
 * below, and goes once less than the smaller share is: near the end it would
 * only be in the way, and two cut-offs keep it from flickering at the edge.
 */
const MORE_BELOW_SHOW = 0.3;
const MORE_BELOW_HIDE = 0.15;

/** #77: how long after a signal question its reply may still be filled in. */
const SIGNAL_REPLY_WINDOW_MS = 2 * 60_000;

/**
 * Whether Fred's own reply carries the signal line (#77): the plain decline
 * does, in place of "I don't have that". Any other reply keeps its words, and
 * the line goes with the map under it.
 */
function saidSignal(t: Turn): boolean {
  return t.signal !== undefined && t.kind === 'abstain' &&
    t.text !== REFER_REPLY && t.text !== SAFETY_NET_REPLY && t.text !== WATCH_REPLY;
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
      <ThemeProvider>
        <Bar />
        <Screen />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/** The clock and icons at the top: dark on the day sky, light on the night one. */
function Bar(): React.JSX.Element {
  const { mode } = useTheme();
  return <StatusBar style={mode === 'night' ? 'light' : 'dark'} />;
}

function Screen() {
  const { palette, styles } = useThemed(makeStyles);
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const [load, setLoad] = useState<LoadPhase>({ phase: 'idle' });
  const [turns, setTurns] = useState<Turn[]>([]);
  // send() reads the latest turns without re-creating itself on every token.
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
  // An empty chat's title, and what the text box suggests (src/words.ts):
  // a new greeting for each fresh page, a new topic whenever the chat moves on.
  const [greeting, setGreeting] = useState(() => pick(GREETINGS));
  const [topic, setTopic] = useState<string>(() => pick(TOPICS));
  const started = useRef(false);
  useEffect(() => {
    if (!started.current) { started.current = true; return; }
    setTopic((was) => pick(TOPICS, was));
    if (turns.length === 0) setGreeting((was) => pick(GREETINGS, was));
  }, [turns.length]);
  const [draft, setDraft] = useState('');
  // #21: deep thinking, chosen per question while typing; off again after sending.
  const [deep, setDeep] = useState(false);
  const deepRef = useRef(false);
  deepRef.current = deep;
  const [state, setState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // US-13: the battery estimate for the message being typed.
  const [costLine, setCostLine] = useState<readonly LinePart[] | null>(null);
  const [fix, setFix] = useState<LocationFix | null>(null);
  // Drive-test recording. Long-press the location chip to arm it; see
  // src/location.ts for why it is opt-in and what it writes.
  const [recording, setRecording] = useState(isRecording());
  // The full-screen map: opened from a map in the chat or from the menu.
  const [mapOpen, setMapOpen] = useState(false);
  // #209: About Fred, opened by tapping the wordmark.
  const [aboutOpen, setAboutOpen] = useState(false);
  // 0 the chat, 1 About: the sky sets its sun by it and the page eases in by it.
  const sunset = useRef(new Animated.Value(0)).current;
  const tabShown = useMemo(() => sunset.interpolate({ inputRange: [0, 0.4], outputRange: [1, 0], extrapolate: 'clamp' }), [sunset]);
  // First-run setup (#196): shown once on a new phone, and again from the
  // start screen when the guides are missing. The engine is not loaded under it: a download and a
  // model in memory at once is more than a small phone has room for.
  const [setup, setSetup] = useState(wizardWanted);
  const [locating, setLocating] = useState(false);
  const [locProgress, setLocProgress] = useState<number | null>(null);
  const [locNote, setLocNote] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const engine = useRef<Engine | null>(null);
  const scroller = useRef<ScrollView | null>(null);
  // The chat follows a new answer only until its question reaches the top of
  // the screen, then stays put while the rest is written below; a hint
  // offers the jump to the end when there is a good deal more below.
  // Following the answer all the way down made it hard to read (Ryan,
  // 2026-10-11). No empty room is added under a short answer to get the
  // question to the top: that looked odd.
  const scrollAt = useRef({ offset: 0, height: 0, content: 0, lastTop: 0 });
  const [moreBelow, setMoreBelow] = useState(false);
  // Set when the number of messages changes (one sent, a past chat opened),
  // and dropped when the question is at the top or the reader takes over.
  const following = useRef(false);
  const shownCount = useRef(0);
  if (shownCount.current !== turns.length) { shownCount.current = turns.length; following.current = true; }
  const checkBelow = useCallback((): void => {
    const { offset, height, content } = scrollAt.current;
    const below = content - (offset + height);
    setMoreBelow((was) => below > height * (was ? MORE_BELOW_HIDE : MORE_BELOW_SHOW));
  }, []);
  /** While following: as far down as the chat goes, and no further than the newest question at the top. */
  const follow = useCallback((): void => {
    if (!following.current) return;
    const { height, content, lastTop } = scrollAt.current;
    const end = content - height;
    const top = lastTop - 6;
    if (end >= top) following.current = false;
    const y = Math.max(0, Math.min(end, top));
    // Counted as there already: the scroll's own reports lag, and the hint flashed up meanwhile.
    scrollAt.current.offset = y;
    scroller.current?.scrollTo({ y, animated: true });
  }, []);
  const toEnd = useCallback((): void => { scroller.current?.scrollToEnd({ animated: true }); }, []);
  const nextId = useRef(1);

  // Past chats (src/chat-log.ts) and the drawer that lists them.
  const [drawer, setDrawer] = useState(false);
  // The drawer's position, shared so that pulling the side tab drags it out (src/side-drawer.tsx).
  const drawerSlide = useRef(new Animated.Value(0)).current;
  const [drawerPeek, setDrawerPeek] = useState(false);
  const [chats, setChats] = useState<SavedChat<Turn>[]>(() => loadChats<Turn>());
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  // The chat on screen: its id once it has one, and the turns as last saved or
  // opened, so opening an old chat to read it does not count as changing it.
  const chatId = useRef<number | null>(null);
  const savedTurns = useRef<readonly Turn[] | null>(null);
  useEffect(() => {
    if (busy || turns.length === 0 || turns === savedTurns.current) return;
    if (turns.some((t) => !t.done || t.hook === true)) return;
    chatId.current ??= turns[0]!.askedAt;
    savedTurns.current = turns;
    setChats(saveChat(chatsRef.current, chatId.current, turns));
  }, [turns, busy]);
  /** Puts another chat on screen: a saved one, or a fresh page. */
  const showChat = useCallback((chat: SavedChat<Turn> | null): void => {
    abort.current?.abort();
    const next = chat === null ? [] : [...chat.turns];
    chatId.current = chat?.id ?? null;
    savedTurns.current = next;
    // New questions must not reuse an id from the chat just opened.
    nextId.current = Math.max(nextId.current, ...next.map((t) => t.id + 1));
    setTurns(next);
    setDraft('');
    setDrawer(false);
  }, []);

  // Bumped to reload the engine after a state's packs are downloaded or
  // removed on the map screen, so a new plant and animal guide is searched
  // without restarting the app. Deferred until the map closes.
  const [engineGen, setEngineGen] = useState(0);
  const packsChanged = useRef(false);
  useEffect(() => {
    if (setup) return;
    let live = true;
    // Back from setup, or a reload: the loading screen again, not the last failure.
    setLoad({ phase: 'idle' });
    void loadEngine((p) => { if (live) setLoad(p); })
      .then((e) => { if (live) engine.current = e; })
      .catch(() => { /* phase already carries the message */ });
    return () => {
      live = false;
      void engine.current?.release();
      engine.current = null;
    };
  }, [engineGen, setup]);

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
    // Read again after setup, where location may just have been allowed.
  }, [setup]);

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

  // #77: a signal question ("no service", "where can I call from?") is answered
  // with how far and which way the nearest reported coverage is. Filled in once
  // a position is known, and only for a message just asked: an old chat opened
  // again is not answered for wherever the phone is now. Not only the newest
  // message: a position can take fifteen seconds, and the hiker may have sent
  // another by then (seen on the phone, 2026-10-11).
  const signalOwed = turns.findLast((t) => t.signal === undefined &&
    Date.now() - t.askedAt < SIGNAL_REPLY_WINDOW_MS && wantsSignal(t.question))?.id ?? null;
  useEffect(() => {
    if (signalOwed === null || fix === null) return;
    let live = true;
    void signalAdvice(fix).then((line) => {
      if (!live || line === null) return;
      console.log(`[fred] signal ${line}`);
      update(signalOwed, { signal: line });
    });
    return () => { live = false; };
  }, [signalOwed, fix, update]);

  const send = useCallback(async (questionText?: string, withState?: string | null, viaHook = false) => {
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
    // The hiker's recent messages, answered or not, for the understanding step
    // and the record of conditions (#98): "i'm lost and scared" then "help",
    // or a snakebite a few messages back. Only this conversation's last few,
    // so a message hours later is not read against an old one.
    const now = Date.now();
    const history = turnsRef.current
      .filter((t) => now - t.askedAt <= HISTORY_WINDOW_MS)
      .slice(-CONDITION_HISTORY)
      .map((t) => t.question);
    // The card Fred just showed, when its last reply was a field card (#101):
    // a follow-up with nothing of its own stays on it.
    const shown = last !== undefined && last.done && last.kind === 'answer' && !last.stopped &&
      last.citations[0]?.source === 'Fred field card' ? last.citations[0].section : undefined;
    const map = wantsMap(question);
    const deepOn = deepRef.current && !viaHook;
    setTurns((ts) => [...ts, {
      id, question, askedAt: now, state: askState, text: '', kind: 'answer',
      citations: [], medical: false, candidateStates: [], done: false, stopped: false, map,
      ...(viaHook ? { hook: true } : {}),
      ...(deepOn ? { deep: true } : {}),
    }]);
    // A map with no position is no use to someone who is lost: find one now,
    // alongside the answer, instead of waiting to be asked.
    if (map && fix === null && !locating) void locate();
    setDraft('');
    setDeep(false);
    setBusy(true);

    const ctrl = new AbortController();
    abort.current = ctrl;
    // US-13: measure what this answer costs the battery (battery.ts).
    setCostLine(null);
    let written = false;
    let finished = false;
    // An estimate still searching finishes first: one use of the search model at a time.
    await estimating.current?.catch(() => undefined);
    beginAnswer();
    try {
      const res = await eng.ask(question, askState, ctrl.signal, previous, history, shown, deepOn);
      written = res.kind === 'answer' && res.diagnostics.cardAnswer === undefined;
      finished = res.kind !== 'answer';
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
          kind: 'abstain', done: true,
          text: res.reason === 'provider-only' ? REFER_REPLY : res.reason === 'safety-net' ? SAFETY_NET_REPLY : res.reason === 'watch' ? WATCH_REPLY : '',
          ...(res.offer === undefined ? {} : { offer: res.offer }),
          ...(res.lead === undefined ? {} : { lead: res.lead }),
          ...(res.decline === undefined ? {} : { decline: res.decline }),
        });
        return;
      }
      update(id, {
        citations: res.citations, medical: res.medical, topScore: res.diagnostics.topScore,
        ...(res.clarify === undefined ? {} : { clarify: res.clarify }),
        // #109: a short answer from a card, with the card folded beneath it.
        ...(res.card === undefined ? {} : { offer: res.card }),
      });
      let text = '';
      // Fixed text (a card, its matched lines) is shown a few words at a
      // time like a written answer; model tokens pass through as they come.
      for await (const tok of typeOut(res.stream, { signal: ctrl.signal })) {
        text += tok;
        // After the opening line the model reads its sources before the
        // answer's first word: show that Fred is still working.
        const opener = res.opener?.text;
        // Only a written answer has that wait: a card follows its line at once.
        update(id, { text, waiting: written && opener != null && text.trim() === opener });
      }
      finished = !ctrl.signal.aborted;
      // The model can decline even when retrieval scored above the gate. Showing
      // that with sources and a medical disclaimer would read as a sourced
      // answer, so it is rendered as the abstention it is.
      // A decline after an opening line is still a decline.
      const line = res.opener?.text;
      update(id, isRefusal(line != null && text.startsWith(line) ? text.slice(line.length) : text)
        ? { kind: 'abstain', done: true, waiting: false, ...(eng.voice ? { decline: declineReply(question, history) } : {}) }
        : { done: true, stopped: ctrl.signal.aborted, waiting: false });
    } catch (e) {
      // Logged too, so a harness waiting on the log sees the question end and
      // where it failed ("Exception in HostFunction" alone does not say).
      console.log(`[fred] error ${e instanceof Error ? `${e.message} ${JSON.stringify(e.stack ?? '')}` : String(e)}`);
      update(id, { kind: 'error', text: e instanceof Error ? e.message : String(e), done: true });
    } finally {
      endAnswer(written ? 'written' : 'quick', finished);
      abort.current = null;
      setBusy(false);
    }
  }, [draft, state, busy, update, fix, locating, locate]);

  /**
   * US-13: the battery estimate for a message not yet sent. Reads the idle
   * draw, then runs the search only (no model) to tell a written answer from
   * a quick reply. The line is logged for the honesty check.
   */
  const estimating = useRef<Promise<unknown> | null>(null);
  const prepare = useCallback((text: string, st: string | null, wanted: () => boolean = () => true): Promise<readonly LinePart[] | null> => {
    const before = estimating.current;
    const run = (async (): Promise<readonly LinePart[] | null> => {
      // One use of the search model at a time; a message typed over since is not searched.
      await before?.catch(() => undefined);
      const eng = engine.current;
      if (eng === null || !wanted()) return null;
      await sampleIdle();
      const kind = await eng.predict(text, st);
      const e = estimateFor(kind);
      console.log(`[fred] estimate kind=${kind} ${e === undefined ? 'none' : `percent=${e.percent.toFixed(4)} left=${e.answersLeft ?? 'none'} measured=${e.measured}`}`);
      return e?.line ?? null;
    })();
    estimating.current = run;
    return run;
  }, []);
  // Shown from the first character as a ceiling (no search), narrowed to the
  // predicted kind of reply once typing pauses; never while Fred is answering.
  useEffect(() => {
    const q = draft.trim();
    if (busy || q === '') { setCostLine(null); return; }
    setCostLine((was) => was ?? ceilingEstimate()?.line ?? null);
    if (q.length < 4) return;
    let live = true;
    const t = setTimeout(() => {
      prepare(q, state, () => live).then((line) => { if (live && line !== null) setCostLine(line); }, () => undefined);
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [draft, busy, state, prepare]);

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
      id, question: label, askedAt: Date.now(), state: from.state, text: '', kind: 'answer',
      citations: from.citations, medical: from.medical, candidateStates: [], done: false, stopped: false,
    }]);
    // Shown a few words at a time, like any other answer.
    void (async () => {
      let shown = '';
      for await (const w of typeOut(oneShot(text))) { shown += w; update(id, { text: shown }); }
      update(id, { done: true });
    })();
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
  const prepareRef = useRef(prepare);
  const preparing = useRef(false);
  prepareRef.current = prepare;
  useEffect(() => {
    if (!new File(Paths.document, 'devhooks').exists) return;
    setVerboseLogging(true);
    const inbox = new File(Paths.document, 'devhooks-ask.txt');
    const timer = setInterval(() => {
      if (!inbox.exists || engine.current === null || busyRef.current || preparing.current) return;
      const lines = inbox.textSync().split('\n').filter((l) => l.trim() !== '');
      inbox.delete();
      const [first, ...rest] = lines;
      if (rest.length > 0) inbox.write(rest.join('\n'));
      if (first === undefined) return;
      const [question, st] = first.split('\t');
      console.log(`[fred] devhook ask: ${question}`);
      const askIn = st === undefined || st === '' ? null : st;
      // As a typed message: the estimate first, then the send.
      preparing.current = true;
      void prepareRef.current(question!, askIn).catch(() => null)
        .then(() => sendRef.current(question, askIn, true))
        .finally(() => { preparing.current = false; });
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  /**
   * The drive-test recording, armed by a long-press on the map's location
   * button rather than a visible control: it writes coordinates to disk and
   * exists for verifying B-KR1/2/3, not for daily use.
   */
  const toggleRecording = (): void => {
    if (recording) {
      const s = stopRecording();
      setRecording(false);
      void deactivateKeepAwake('drive-test').catch(() => {});
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
      // The position watch stops when the screen locks, so a drive would
      // record only its first minute. The screen stays on until it is stopped.
      void activateKeepAwakeAsync('drive-test').catch(() => {});
      // The map and the answers follow the drive: every reading the recorder
      // writes is also the position on screen, with no tap at each stop.
      const follow = (f: LocationFix): void => {
        setFix(f);
        if (f.state !== null) setState(f.state);
      };
      void startRecording({ onSample: follow }).then((path) => {
        setLocNote(`Recording to ${path.split('/').pop() ?? path} — no need to touch the phone`);
      });
    }
  };

  if (setup) {
    return <SetupWizard onDone={() => { markSetupDone(); setSetup(false); }} />;
  }

  if (load.phase !== 'ready') {
    const failed = load.phase === 'failed';
    return (
      <View style={styles.root}>
        <Scene height={window.height * 0.44} top={insets.top} />
        <Veil />
        <View style={styles.loading}>
          <Image source={LOGO} style={styles.wordmark} resizeMode="contain" accessibilityLabel="Fred" />
          {!failed && <CalmLoader size={72} style={styles.loadShapes} />}
          <Text style={failed ? styles.loadFailed : styles.loadNote}>{describePhase(load)}</Text>
          {!failed && <Text style={styles.loadHint}>Getting the guides ready. This takes a moment.</Text>}
          {/* A phone with no guides: setup is where they come from. */}
          {failed && !guidesOnPhone() && (
            <Pressable style={styles.loadSetup} onPress={() => setSetup(true)} accessibilityRole="button">
              <Text style={styles.loadSetupText}>Set up Fred</Text>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  if (mapOpen) {
    return (
      <MapScreen
        fix={fix}
        onPacksChanged={() => { packsChanged.current = true; }}
        onClose={() => {
          setMapOpen(false);
          if (packsChanged.current) { packsChanged.current = false; setEngineGen((g) => g + 1); }
        }}
        // B-KR1. The accuracy is on the map's sheet rather than in a log: the
        // key result is verified by standing somewhere and reading it, and a
        // ±2 km fix and a ±8 m one should not look the same to a reader
        // deciding whether to trust the local guide.
        where={{
          locating, progress: locProgress, note: locNote, recording,
          locate: () => void locate(), dismissNote: () => setLocNote(null), toggleRecording,
        }}
      />
    );
  }
  // Only the newest map in the chat is drawn live; older ones become a button,
  // so a long conversation does not hold a map renderer per lost message.
  const liveMap = turns.findLast((t) => t.map === true)?.id;
  // The open sky under the status bar: wide before the first question, a slim
  // strip once the chat needs the room.
  const sky = turns.length === 0 ? 236 : 112;

  return (
    <View style={styles.root}>
      {/* The horizon stands in for a header bar: wide open before the first
          question, a slim strip once the chat needs the room. */}
      <Scene height={insets.top + sky} top={insets.top} sunset={sunset}>
       <View style={[styles.header, { paddingTop: insets.top + TOP_ROW - LOGO_HEIGHT / 2 }]} pointerEvents="box-none">
        {/* Opens About Fred; tapped again, closes it. */}
        <Pressable onPress={() => setAboutOpen((o) => !o)} hitSlop={8} accessibilityRole="button"
          accessibilityLabel={aboutOpen ? 'Fred. Close About Fred' : 'Fred. About Fred'}>
          <Crossfade render={(p) => (
            <Image source={LOGO} style={[styles.wordmarkSmall, { tintColor: p.logo }]} resizeMode="contain" />
          )} />
          {/* At sunset (About) the logo warms with the sky. */}
          <Animated.Image source={LOGO} resizeMode="contain" style={[styles.wordmarkSmall, styles.logoOver, {
            tintColor: (palette.night ? SUNSET.night : SUNSET.day).logo, opacity: sunset }]} />
        </Pressable>
       </View>
      </Scene>

      {locNote !== null && (
        <Pressable onPress={() => setLocNote(null)}>
          <Text style={styles.locNote}>{locNote}</Text>
        </Pressable>
      )}

      <ScrollView
        ref={scroller}
        style={styles.thread}
        contentContainerStyle={styles.threadInner}
        onContentSizeChange={(_w, h) => { scrollAt.current.content = h; follow(); checkBelow(); }}
        onLayout={(e) => { scrollAt.current.height = e.nativeEvent.layout.height; checkBelow(); }}
        onScroll={(e) => { scrollAt.current.offset = e.nativeEvent.contentOffset.y; checkBelow(); }}
        scrollEventThrottle={100}
        // A finger on the chat: the reader is in charge from here.
        onScrollBeginDrag={() => { following.current = false; }}
        // The last report of a fling can be dropped by the throttle: read where it came to rest.
        onMomentumScrollEnd={(e) => { scrollAt.current.offset = e.nativeEvent.contentOffset.y; checkBelow(); }}
        onScrollEndDrag={(e) => { scrollAt.current.offset = e.nativeEvent.contentOffset.y; checkBelow(); }}
      >
        {turns.length === 0 && (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyLead}>{greeting.line}</Text>
            <Text style={styles.empty}>{greeting.more}</Text>
          </View>
        )}

        {turns.map((t, i) => (
          <View
            key={t.id}
            style={styles.turn}
            onLayout={i !== turns.length - 1 ? undefined : (e) => { scrollAt.current.lastTop = e.nativeEvent.layout.y; follow(); }}
          >
            <View style={styles.askedNote}>
              <Text style={styles.question}>{t.question}</Text>
            </View>
            <View style={styles.cards}>

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

            {t.kind === 'abstain' && (t.text === REFER_REPLY || t.text === SAFETY_NET_REPLY || t.text === WATCH_REPLY) && (
              <View style={styles.card}>
                <ReplyText text={t.lead === undefined ? t.text : `${t.lead}\n${t.text}`} />
              </View>
            )}

            {t.kind === 'abstain' && t.text !== REFER_REPLY && t.text !== SAFETY_NET_REPLY && t.text !== WATCH_REPLY && (
              <View style={styles.card}>
                {/* "Where am I?" is not in the manuals, but the map below answers
                    it, so saying "I don't know" first would contradict it. */}
                <Text style={styles.body}>
                  {t.signal !== undefined ? `${t.signal} The map below shows where.` : t.map === true ? 'Here\u2019s where you are.' : t.decline?.text ?? 'I don\u2019t have that in my guides, and I\u2019d rather not guess.'}
                </Text>
                {t.map === true && t.offer === undefined ? null : t.offer === undefined ? (
                  <Text style={styles.hint}>
                    {t.decline?.hint ?? 'Try asking another way, or tell me a bit more about what\u2019s going on.'}
                  </Text>
                ) : (
                  <Text style={styles.hint}>The closest field card, in case it&apos;s what you need:</Text>
                )}
              </View>
            )}

            {t.kind === 'chat' && (
              <View style={styles.card}>
                <ReplyText text={t.text} />
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
                    <ReplyText text={t.offer.text} />
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
              <View style={styles.card}>
                <Text style={styles.error}>{t.text}</Text>
              </View>
            )}

            {t.kind === 'answer' && (
              <View style={styles.card}>
                {t.text === '' && !t.done && <CalmLoader size={34} style={styles.thinking} />}
                {t.deep === true && !t.done && t.text === '' && <Text style={styles.deepWorking}>Deep thinking: looking through the guides a second way…</Text>}
                {/* The opening line ends in a line break; no blank line above the wait note. */}
                {t.text !== '' && <ReplyText text={t.text} />}
                {t.waiting === true && !t.done && (
                  <View style={styles.waiting} accessibilityRole="progressbar" accessibilityLabel="Fred is working on your answer">
                    <CalmLoader size={24} />
                    <Text style={styles.waitingText}>Working on your answer…</Text>
                  </View>
                )}

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
              <View style={styles.card}>
                {t.id === liveMap
                  ? <MapPreview fix={fix} onOpen={() => setMapOpen(true)} quiet={saidSignal(t)} />
                  : (
                    <>
                      {t.signal !== undefined && !saidSignal(t) && <Text style={styles.body}>{t.signal}</Text>}
                      <Pressable onPress={() => setMapOpen(true)} hitSlop={8} accessibilityRole="button">
                        <Text style={styles.offerTitle}>▸ Open the map</Text>
                      </Pressable>
                    </>
                  )}
              </View>
            )}
            </View>
          </View>
        ))}
      </ScrollView>
      <JumpToEnd shown={moreBelow} onPress={toEnd} />

      {/* 'padding' on Android too. The usual Android answer is adjustResize in
          the manifest, but edge-to-edge (RN 0.86, Android 15+) means the window
          no longer resizes for the keyboard — the first build buried the
          composer under it. */}
      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={0}>
        {/* US-13: what sending this will cost the battery, with the figures standing out. */}
        {costLine !== null && !busy && (
          <Text style={styles.costLine} accessibilityLabel={`Battery estimate: ${costLine.map((p) => p.text).join('')}`}>
            {costLine.map((p, i) => (p.figure ? <Text key={i} style={styles.costFigure}>{p.text}</Text> : p.text))}
          </Text>
        )}
        {/* #21: offered while a question is being typed, for that question only. */}
        {draft.trim() !== '' && !busy && (
          <Pressable style={[styles.deepChip, deep && styles.deepChipOn]} onPress={() => setDeep((d) => !d)}
            accessibilityRole="switch" accessibilityState={{ checked: deep }}
            accessibilityLabel="Deep thinking: a slower, more careful answer">
            <View style={[styles.deepDot, deep && styles.deepDotOn]} />
            <Text style={styles.deepText}>Deep thinking</Text>
            <Text style={styles.deepNote}>{deep ? 'on · slower, more careful' : 'slower, more careful'}</Text>
          </Pressable>
        )}
        <View style={[styles.composer, { paddingBottom: insets.bottom + 10 }]}>
         <View style={styles.composerPill}>
          <TextInput
            ref={input}
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={`Ask about ${topic}…`}
            placeholderTextColor={palette.moss}
            editable={!busy}
            multiline
            onSubmitEditing={() => void send()}
          />
          {/* US-07. One button: ask, then stop while an answer is running. A
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
            accessibilityRole="button" accessibilityLabel={busy ? 'Stop' : 'Ask'}
          >
            {/* An arrow to send, a square to stop. */}
            {busy ? <View style={styles.stopMark} />
              : <Image source={ARROW} resizeMode="contain"
                  style={[styles.sendMark, draft.trim() === '' && styles.sendMarkOff]} />}
          </Pressable>
         </View>
        </View>
      </KeyboardAvoidingView>

      <Veil />
      {/* The bookmark on the left edge, level with the logo opposite it, and its drawer. */}
      {/* The tab steps aside while About is open. */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.tabLayer, { opacity: tabShown }]} pointerEvents={aboutOpen ? 'none' : 'box-none'}>
        <SideTab top={insets.top + TOP_ROW - SIDE_TAB_HEIGHT / 2} open={drawer} slide={drawerSlide}
          onOpen={() => setDrawer(true)} onClose={() => setDrawer(false)} onPeek={setDrawerPeek} />
      </Animated.View>
      <SideDrawer
        open={drawer}
        peek={drawerPeek}
        slide={drawerSlide}
        chats={chats}
        current={chatId.current}
        onClose={() => setDrawer(false)}
        onMap={() => { setDrawer(false); setMapOpen(true); }}
        onNewChat={() => showChat(null)}
        onOpenChat={showChat}
        onRemoveChat={(id) => {
          setChats(removeChat(chatsRef.current, id));
          // Removing the chat on screen clears the page too.
          if (id === chatId.current) showChat(null);
        }}
      />
      {/* Over the chat below the sky; it eases in through sunset (#209). */}
      <AboutScreen open={aboutOpen} onClose={() => setAboutOpen(false)} p={sunset} skyHeight={insets.top + sky} />
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  offerTitle: { color: palette.pine, fontSize: 15, fontWeight: '700' },
  clarify: { marginTop: 14, borderTopWidth: 1, borderTopColor: palette.sand, paddingTop: 12 },
  clarifyQ: { color: palette.ink, fontSize: 14, fontWeight: '600' },
  clarifyOther: { color: palette.moss, fontSize: 13, fontWeight: '600' },
  root: { flex: 1, backgroundColor: palette.cream },
  loading: { flex: 1, alignItems: 'center', paddingTop: 12 },
  wordmark: { height: 76, width: 76 * LOGO_RATIO, tintColor: palette.logo },
  wordmarkSmall: { height: LOGO_HEIGHT, width: LOGO_HEIGHT * LOGO_RATIO, tintColor: palette.logo },
  loadShapes: { marginTop: 30, marginBottom: 20 },
  loadNote: { color: palette.ink, fontSize: 15, fontWeight: '600' },
  loadHint: { color: palette.moss, fontSize: 13, marginTop: 6 },
  loadSetup: { marginTop: 22, borderRadius: radius.pill, backgroundColor: palette.pine, paddingHorizontal: 26, paddingVertical: 14 },
  loadSetupText: { color: palette.paper, fontSize: 16, fontWeight: '700' },
  loadFailed: { color: palette.clay, fontSize: 14, textAlign: 'center', paddingHorizontal: 32, lineHeight: 20, marginTop: 24 },

  // #209: the logo at the top right, clear of the menu tab on the left.
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end',
    paddingHorizontal: 18,
  },
  logoOver: { position: 'absolute', top: 0, left: 0 },
  thread: { flex: 1 },
  // Where the side tab's own zIndex (5) is kept, as when it sat on the page directly.
  tabLayer: { zIndex: 5 },
  threadInner: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 8 },
  emptyWrap: { marginTop: 18, paddingHorizontal: 14 },
  emptyLead: { fontFamily: JOURNAL, color: palette.ink, fontSize: 32, lineHeight: 40 },
  empty: { color: palette.moss, fontSize: 15, lineHeight: 22, marginTop: 14 },

  // #209: no icons, trail or labels down the side. The hiker's words in the
  // journal face and Fred's in the plain one are enough to tell them apart.
  turn: { marginBottom: 34 },
  // The hiker's words in a soft note on the right, the way a message you sent
  // sits in any chat; Fred answers across the full width below it.
  askedNote: {
    alignSelf: 'flex-end', maxWidth: '86%', marginBottom: 16,
    backgroundColor: palette.sage, borderRadius: radius.card, borderBottomRightRadius: 6,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  question: { fontFamily: JOURNAL, color: palette.ink, fontSize: 19, lineHeight: 26 },
  cards: { gap: 22 },
  card: {},
  thinking: { alignSelf: 'flex-start' },
  body: { color: palette.ink, fontSize: 16, lineHeight: 24 },
  hint: { color: palette.moss, fontSize: 13, lineHeight: 18, marginTop: 8 },
  error: { color: palette.clay, fontSize: 14, lineHeight: 20 },
  disclaimer: {
    color: palette.plum, fontSize: 12, lineHeight: 17, marginTop: 14,
    borderTopWidth: 1, borderTopColor: palette.sand, paddingTop: 10,
  },

  sources: { marginTop: 14, borderTopWidth: 1, borderTopColor: palette.sand, paddingTop: 10 },
  sourcesTitle: { color: palette.pine, fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 6 },
  source: { color: palette.moss, fontSize: 12, lineHeight: 18 },
  sourceBasis: { color: palette.moss, fontSize: 12, lineHeight: 18, marginLeft: 12 },
  sourceLink: { color: palette.pine, textDecorationLine: 'underline' },

  locNote: {
    color: palette.amber, fontSize: 13, lineHeight: 18, backgroundColor: palette.butter,
    paddingHorizontal: 20, paddingVertical: 10,
  },
  locateButton: {
    alignSelf: 'flex-start', marginTop: 12, borderRadius: radius.control,
    backgroundColor: palette.pine, paddingHorizontal: 14, paddingVertical: 10,
  },
  locateButtonText: { color: palette.paper, fontSize: 14, fontWeight: '700' },
  stateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  stateButton: { backgroundColor: palette.oat, borderRadius: radius.control, paddingHorizontal: 14, paddingVertical: 10 },
  stateButtonText: { color: palette.ink, fontSize: 14, fontWeight: '600' },

  composer: { paddingHorizontal: 12, paddingTop: 8 },
  // One floating pill: the text box with the Ask button inside it.
  composerPill: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 6, padding: 6,
    backgroundColor: palette.paper, borderRadius: 30,
    borderWidth: 1, borderColor: palette.sand,
    boxShadow: `0 4 16 ${palette.shade}`,
  },
  input: {
    flex: 1, color: palette.ink, fontSize: 16, maxHeight: 120, minHeight: 44,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  costLine: { color: palette.moss, fontSize: 12, paddingHorizontal: 26, paddingTop: 6 },
  // #21: a 48 dp toggle above the box; filled while on.
  deepChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', minHeight: 48,
    marginLeft: 14, marginTop: 6, paddingHorizontal: 14, borderRadius: radius.pill,
    borderWidth: 1, borderColor: palette.sand, backgroundColor: palette.paper,
  },
  deepChipOn: { backgroundColor: palette.sage, borderColor: palette.pine },
  deepDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: palette.moss },
  deepDotOn: { backgroundColor: palette.pine, borderColor: palette.pine },
  deepText: { color: palette.ink, fontSize: 14, fontWeight: '600' },
  deepNote: { color: palette.moss, fontSize: 13 },
  deepWorking: { color: palette.moss, fontSize: 13, fontStyle: 'italic', marginTop: 6 },
  costFigure: { color: palette.pine, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  send: { backgroundColor: palette.pine, borderRadius: radius.pill, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  sendOff: { backgroundColor: palette.sand },
  sendStop: { backgroundColor: palette.clay },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  waitingText: { color: palette.moss, fontSize: 13, fontStyle: 'italic' },
  stoppedNote: { color: palette.clay, fontSize: 12, marginTop: 10, fontStyle: 'italic' },
  sendMark: { width: 22, height: 22, tintColor: palette.paper },
  sendMarkOff: { tintColor: palette.moss },
  stopMark: { width: 14, height: 14, borderRadius: 3, backgroundColor: palette.paper },
});
