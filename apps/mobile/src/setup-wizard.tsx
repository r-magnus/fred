/**
 * First-run setup (#196): five short pages under the horizon.
 *
 *   welcome  who Fred is
 *   guides   the models and the guides that are the same everywhere
 *   place    the hiker's state or states: map, contours, coverage, local guide
 *   sky      the day and night switch, tried on the sun itself
 *   ready    where everything is
 *
 * A trail of waypoints across the top marks the way, like the trail down the
 * chat. Nothing is downloaded without its size being shown first, because the
 * guides are over a gigabyte and a hiker may be on mobile data. Every page can
 * be passed without downloading: the map and the guide offer the same
 * downloads later, and a phone set up by cable needs none of them.
 *
 * What to say on each page is decided in setup-plan.ts; what is on the phone
 * is read in setup.ts; the downloads are map-downloads.ts, the same code the
 * map screen uses.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BackHandler, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { STATE_NAMES } from '@fred/rag-core';
import { CalmLoader } from './calm-loader.tsx';
import { Tour } from './guide.tsx';
import { currentFix, lastKnownFix } from './location.ts';
import {
  downloadBundle, fetchIndex, installState, remainingBytes,
  type MapIndex, type Progress, type StateBundle,
} from './map-downloads.ts';
import { Scene } from './scene.tsx';
import { STEPS, guidesStatus, listNames, orderStates, queueFor, size, stepFrom, type IndexState, type Step } from './setup-plan.ts';
import { guidesOnPhone, statesOnPhone } from './setup.ts';
import { Crossfade, Veil, radius, useTheme, useThemed, type Palette } from './theme.tsx';

const LOGO = require('../assets/ui/fred-logo.png');
const LEAF = require('../assets/ui/leaf.png');
const TREE = require('../assets/ui/tree.png');
const CHECK = require('../assets/ui/check.png');
const JOURNAL = Platform.select({ ios: 'Georgia', default: 'serif' });

/** The screen stays on under this name while a download runs. */
const AWAKE = 'setup-download';
/** A state is enough to choose a guide by: no need to wait for a fix good to ten metres. */
const NEAR_ENOUGH_M = 3000;
const LOCATE_MS = 12_000;

/** What is downloading now: the guides, or a state by its code. */
interface Job {
  readonly what: string;
  readonly progress: Progress | null;
}
const GUIDES = 'guides';

/** The waypoints across the top: passed, here, and still ahead. */
function Trail({ step }: { step: Step }): React.JSX.Element {
  const { styles } = useThemed(makeStyles);
  const at = STEPS.indexOf(step);
  return (
    <View style={styles.trail} accessible accessibilityRole="progressbar"
      accessibilityLabel={`Step ${at + 1} of ${STEPS.length}`}>
      {STEPS.map((s, i) => (
        <View key={s} style={styles.trailPart}>
          {i > 0 && (
            <View style={styles.trailDots}>
              <View style={styles.trailDot} /><View style={styles.trailDot} /><View style={styles.trailDot} />
            </View>
          )}
          <View style={[styles.waypoint, i < at && styles.waypointPassed, i === at && styles.waypointHere]}>
            {i < at && <Image source={CHECK} resizeMode="contain" style={styles.waypointCheck} />}
            {i === at && <Image source={LEAF} resizeMode="contain" style={styles.waypointLeaf} />}
          </View>
        </View>
      ))}
    </View>
  );
}

/** A filling bar with the figures under it. */
function Bar({ progress }: { progress: Progress | null }): React.JSX.Element {
  const { styles } = useThemed(makeStyles);
  const share = progress === null ? 0 : progress.done / Math.max(1, progress.total);
  return (
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(share * 100) }}>
      <View style={styles.bar}><View style={[styles.fill, { width: `${Math.round(share * 100)}%` }]} /></View>
      <Text style={styles.meta}>
        {progress === null ? 'Starting…' : `${size(progress.done)} of ${size(progress.total)}`}
      </Text>
    </View>
  );
}

/** A line of the welcome page: a glyph in a pastel circle, and a promise. */
function Promise_({ glyph, tone, title, children }: { glyph: number; tone: string; title: string; children: string }): React.JSX.Element {
  const { styles } = useThemed(makeStyles);
  return (
    <View style={styles.promise}>
      <View style={[styles.promiseMark, { backgroundColor: tone }]}>
        <Image source={glyph} resizeMode="contain" style={styles.promiseGlyph} />
      </View>
      <View style={styles.promiseWords}>
        <Text style={styles.promiseTitle}>{title}</Text>
        <Text style={styles.note}>{children}</Text>
      </View>
    </View>
  );
}

export function SetupWizard({ onDone }: { onDone: () => void }): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { palette, styles } = useThemed(makeStyles);
  const { mode } = useTheme();
  const [step, setStep] = useState<Step>('welcome');

  // The list of downloads. Asked for at once, so it is usually here by the
  // time the welcome page has been read; `again` asks once more.
  const [idx, setIdx] = useState<MapIndex | null>(null);
  const [idxError, setIdxError] = useState<string | null>(null);
  const [again, setAgain] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    setIdxError(null);
    fetchIndex(ctrl.signal).then(setIdx).catch((e: unknown) => {
      if (ctrl.signal.aborted) return;
      // The fetch's own words ("Network request failed") say nothing a hiker can act on.
      setIdxError(e instanceof Error && e.message.startsWith('This version') ? e.message
        : 'Fred can’t reach the downloads right now. Check your connection and try again.');
    });
    return () => ctrl.abort();
  }, [again]);

  // Bumped after each download, so what is on the phone is read again.
  const [disk, setDisk] = useState(0);
  const haveGuides = useMemo(() => guidesOnPhone(), [disk]);
  const haveStates = useMemo(() => statesOnPhone(), [disk]);

  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => { abort.current?.abort(); void deactivateKeepAwake(AWAKE).catch(() => {}); }, []);

  /** Downloads one after another; stops at the first that fails, keeping what arrived. */
  const fetchAll = useCallback((list: readonly { what: string; bundle: StateBundle }[]) => {
    if (idx === null || list.length === 0) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setError(null);
    // A phone that sleeps mid-download drops the connection.
    void activateKeepAwakeAsync(AWAKE).catch(() => {});
    void (async () => {
      try {
        for (const { what, bundle } of list) {
          setJob({ what, progress: null });
          await downloadBundle(idx, bundle, (progress) => setJob({ what, progress }), ctrl.signal);
          setDisk((n) => n + 1);
        }
      } catch (e) {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      } finally {
        abort.current = null;
        setJob(null);
        setDisk((n) => n + 1);
        void deactivateKeepAwake(AWAKE).catch(() => {});
      }
    })();
  }, [idx]);

  // The place page: where the hiker is, and the states they have ticked.
  const [here, setHere] = useState<string | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [locating, setLocating] = useState(false);
  const [locNote, setLocNote] = useState<string | null>(null);
  const found = useCallback((state: string) => {
    setHere(state);
    setPicked((was) => new Set(was).add(state));
  }, []);
  // A phone that has already granted location (setup run again) knows without asking.
  useEffect(() => {
    let live = true;
    void lastKnownFix().then((f) => { if (live && f?.state != null) found(f.state); }).catch(() => {});
    return () => { live = false; };
  }, [found]);
  const locate = useCallback(() => {
    setLocating(true);
    setLocNote(null);
    void currentFix({ targetMeters: NEAR_ENOUGH_M, timeoutMs: LOCATE_MS }).then((res) => {
      if (!res.ok) setLocNote(`${res.message} You can pick your state from the list instead.`);
      else if (res.fix.state === null) setLocNote('You’re outside the states Fred has maps for. Pick any you plan to visit.');
      else found(res.fix.state);
    }).catch(() => setLocNote('Fred couldn’t find you just now. Pick your state from the list instead.'))
      .finally(() => setLocating(false));
  }, [found]);

  const order = useMemo(
    () => (idx === null ? [] : orderStates(Object.keys(idx.states), here, STATE_NAMES)),
    [idx, here]);
  const left = (s: string): number => {
    const b = idx?.states[s];
    return b === undefined ? 0 : remainingBytes(b);
  };
  // `disk` is read through `left`, so the queue shrinks as states arrive.
  const queue = useMemo(() => queueFor(picked, order, left), [picked, order, disk, idx]);

  const index: IndexState = idx !== null
    ? { kind: 'loaded', coreBytesLeft: idx.core === undefined ? null : remainingBytes(idx.core) || idx.core.bytes }
    : idxError !== null ? { kind: 'unreachable', message: idxError } : { kind: 'loading' };
  const guides = guidesStatus(haveGuides, index);

  // The sky page says so once the switch has been tried.
  const startedIn = useRef(mode);
  const [turned, setTurned] = useState(false);
  useEffect(() => { if (step === 'sky' && mode !== startedIn.current) setTurned(true); }, [mode, step]);
  useEffect(() => { if (step === 'sky') startedIn.current = mode; }, [step]);

  const busy = job !== null;
  const go = useCallback((by: 1 | -1) => {
    setError(null);
    setStep((s) => stepFrom(s, by) ?? s);
  }, []);
  // The phone's back button is the wizard's Back; on the first page it leaves the app as usual.
  useEffect(() => {
    if (step === 'welcome') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { if (!busy) go(-1); return true; });
    return () => sub.remove();
  }, [step, busy, go]);

  /** The big button at the foot of each page. */
  const next: { label: string; onPress: () => void; quiet?: boolean; off?: boolean } =
    step === 'welcome' ? { label: 'Let’s set up', onPress: () => go(1) }
    : busy ? { label: 'Downloading…', onPress: () => {}, off: true }
    : step === 'guides' ? (guides.kind === 'ready' ? { label: 'Next', onPress: () => go(1) }
      : { label: 'Skip for now', onPress: () => go(1), quiet: true })
    : step === 'place' ? (queue.states.length > 0
      ? { label: `Download ${size(queue.bytes)}`, onPress: () => fetchAll(queue.states.map((s) => ({ what: s, bundle: idx!.states[s]! }))) }
      : haveStates.length > 0 ? { label: 'Next', onPress: () => go(1) }
      : { label: 'Skip for now', onPress: () => go(1), quiet: true })
    : step === 'sky' ? { label: 'Next', onPress: () => go(1) }
    : { label: 'Start', onPress: onDone };

  let page: ReactNode;
  if (step === 'welcome') {
    page = (
      <ScrollView style={styles.page} contentContainerStyle={styles.pageInner}>
        <Text style={styles.title}>Hey, you.</Text>
        <Text style={styles.lead}>
          I&apos;m Fred, a field guide that lives on your phone: first aid, survival, and the plants
          and animals around you.
        </Text>
        <View style={styles.card}>
          <Promise_ glyph={TREE} tone={palette.sage} title="With or without signal">
            Everything I know is stored on this phone.
          </Promise_>
          <Promise_ glyph={LEAF} tone={palette.skyWash} title="I show my sources">
            Every answer lists what I read, so you can check me.
          </Promise_>
          <Promise_ glyph={CHECK} tone={palette.butter} title="I say when I don't know">
            I&apos;d rather tell you that than guess.
          </Promise_>
        </View>
        <Text style={styles.note}>
          Setting up takes a few minutes and a connection, Wi-Fi if you can. After that I need neither.
        </Text>
      </ScrollView>
    );
  } else if (step === 'guides') {
    page = (
      <ScrollView style={styles.page} contentContainerStyle={styles.pageInner}>
        <Text style={styles.title}>First, the guides.</Text>
        <Text style={styles.lead}>
          The first aid and survival guides, and the part of me that reads them and writes your
          answer. I can&apos;t answer anything without these.
        </Text>
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>Fred&apos;s guides</Text>
            {guides.kind === 'ready' && (
              <View style={styles.tick}><Image source={CHECK} resizeMode="contain" style={styles.tickMark} /></View>
            )}
          </View>
          {guides.kind === 'ready' && <Text style={styles.body}>On this phone, ready to use offline.</Text>}
          {guides.kind === 'checking' && (
            <View style={styles.row}><CalmLoader size={30} /><Text style={styles.note}>Looking for the downloads…</Text></View>
          )}
          {guides.kind === 'offer' && job?.what !== GUIDES && (
            <>
              <Text style={styles.body}>{size(guides.bytes)} to download, once. Use Wi-Fi if you can.</Text>
              <Pressable style={styles.action} accessibilityRole="button"
                onPress={() => fetchAll([{ what: GUIDES, bundle: idx!.core! }])}>
                <Text style={styles.actionText}>Download {size(guides.bytes)}</Text>
              </Pressable>
            </>
          )}
          {job?.what === GUIDES && (
            <>
              <Bar progress={job.progress} />
              <Text style={styles.note}>Keep Fred open while this runs. The screen will stay on.</Text>
              <Pressable onPress={() => abort.current?.abort()} hitSlop={10} accessibilityRole="button">
                <Text style={styles.link}>Cancel</Text>
              </Pressable>
            </>
          )}
          {guides.kind === 'offline' && (
            <>
              <Text style={styles.body}>{guides.message}</Text>
              <Pressable style={styles.action} onPress={() => setAgain((n) => n + 1)} accessibilityRole="button">
                <Text style={styles.actionText}>Try again</Text>
              </Pressable>
            </>
          )}
          {guides.kind === 'unpublished' && (
            <Text style={styles.body}>
              These can&apos;t be downloaded yet: this early version of Fred has them put on the phone by
              cable. You can carry on and look around, and the map will still work.
            </Text>
          )}
          {error !== null && <Text style={styles.error}>{error}</Text>}
        </View>
      </ScrollView>
    );
  } else if (step === 'place') {
    page = (
      // The list scrolls by itself here, so the page around it does not.
      <View style={[styles.page, styles.pageInner, styles.pageFixed]}>
        <Text style={styles.title}>Where do you walk?</Text>
        <Text style={styles.lead}>
          Each state brings its map, contour lines, cell coverage and a guide to its plants and animals.
        </Text>
        {here === null ? (
          <View style={styles.row}>
            <Pressable style={[styles.action, styles.actionInline]} disabled={locating} onPress={locate} accessibilityRole="button">
              <Text style={styles.actionText}>{locating ? 'Finding you…' : 'Find my state'}</Text>
            </Pressable>
            <Text style={[styles.note, styles.grow]}>Your location stays on this phone.</Text>
          </View>
        ) : (
          <Text style={styles.note}>
            {haveStates.includes(here)
              ? `You\u2019re in ${STATE_NAMES[here] ?? here}, which is already on this phone.`
              : `You\u2019re in ${STATE_NAMES[here] ?? here}, so it\u2019s first in the list and ticked.`}
          </Text>
        )}
        {locNote !== null && <Text style={styles.caution}>{locNote}</Text>}
        {error !== null && <Text style={styles.error}>{error}</Text>}
        <View style={[styles.card, styles.listCard]}>
          {idx === null && idxError === null && <CalmLoader size={40} style={styles.centred} />}
          {idx === null && idxError !== null && (
            <>
              <Text style={styles.body}>{idxError}</Text>
              <Pressable style={styles.action} onPress={() => setAgain((n) => n + 1)} accessibilityRole="button">
                <Text style={styles.actionText}>Try again</Text>
              </Pressable>
            </>
          )}
          {idx !== null && (
            <ScrollView>
              {order.map((s, i) => {
                const bundle = idx.states[s]!;
                const status = installState(bundle);
                const on = status === 'installed' || picked.has(s);
                const mine = job !== null && job.what === s ? job : null;
                const name = STATE_NAMES[s] ?? s;
                return (
                  <Pressable key={s} style={[styles.state, i === 0 && styles.stateFirst]}
                    disabled={busy || status === 'installed'}
                    accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled: status === 'installed' }}
                    accessibilityLabel={`${name}, ${status === 'installed' ? 'on this phone' : size(remainingBytes(bundle))}`}
                    onPress={() => setPicked((was) => {
                      const now = new Set(was);
                      if (!now.delete(s)) now.add(s);
                      return now;
                    })}>
                    <View style={styles.grow}>
                      <Text style={styles.stateName}>{name}{s === here ? '  · you are here' : ''}</Text>
                      {mine !== null ? <Bar progress={mine.progress} /> : (
                        <Text style={styles.meta}>
                          {status === 'installed' ? `On this phone · ${size(bundle.bytes)}`
                            : status === 'partial' ? `Partly here · ${size(remainingBytes(bundle))} to go`
                            : size(bundle.bytes)}
                        </Text>
                      )}
                    </View>
                    <View style={[styles.box, on && styles.boxOn, status === 'installed' && styles.boxHere]}>
                      {on && <Image source={CHECK} resizeMode="contain"
                        style={[styles.boxMark, status === 'installed' && styles.boxMarkHere]} />}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>
        {busy
          ? (
            <Pressable onPress={() => abort.current?.abort()} hitSlop={10} accessibilityRole="button">
              <Text style={styles.link}>Cancel the download</Text>
            </Pressable>
          )
          : <Text style={styles.note}>More can be added any time from the map, under Offline maps.</Text>}
      </View>
    );
  } else if (step === 'sky') {
    page = (
      <ScrollView style={styles.page} contentContainerStyle={styles.pageInner}>
        <Text style={styles.title}>{turned ? 'There it goes.' : 'Day and night.'}</Text>
        <Text style={styles.lead}>
          {mode === 'night'
            ? 'That’s the moon up there, and it’s a switch. Swipe it sideways, or tap it, and the sun comes back up.'
            : 'That’s the sun up there, and it’s a switch. Swipe it sideways, or tap it, and night falls.'}
        </Text>
        <View style={styles.card}>
          <Text style={styles.body}>
            Day colours are for bright light on the trail. Night colours are easier on your eyes in a
            tent.
          </Text>
          <Text style={styles.note}>
            Until you choose, I go by the clock. Once you&apos;ve chosen, I remember.
          </Text>
        </View>
      </ScrollView>
    );
  } else {
    const names = haveStates.map((s) => STATE_NAMES[s] ?? s);
    page = (
      <ScrollView style={styles.page} contentContainerStyle={styles.pageInner}>
        <Text style={styles.title}>{haveGuides ? 'You’re all set.' : 'Nearly there.'}</Text>
        <Text style={styles.lead}>
          {haveGuides
            ? `The guides are on this phone${names.length === 0 ? '' : `, with ${listNames(names)}`}. Here’s where everything is.`
            : 'The guides aren’t on this phone yet, so I can’t answer questions. You can still look around, and come back to setup from the guide in the menu.'}
        </Text>
        <View style={styles.card}><Tour /></View>
      </ScrollView>
    );
  }

  return (
    <View style={styles.root}>
      <Scene height={insets.top + 168} top={insets.top} hint={step === 'sky' && !turned}>
        <View style={[styles.header, { paddingTop: insets.top + 10 }]} pointerEvents="none">
          <Crossfade render={(p) => (
            <Image source={LOGO} resizeMode="contain" style={[styles.logo, { tintColor: p.logo }]} accessibilityLabel="Fred" />
          )} />
        </View>
      </Scene>
      <Trail step={step} />
      {page}
      <View style={[styles.foot, { paddingBottom: insets.bottom + 14 }]}>
        {step === 'welcome'
          // Someone set up by cable, or who only wants a look, is not made to walk the pages.
          ? <Pressable onPress={onDone} hitSlop={10} accessibilityRole="button"><Text style={styles.back}>Skip setup</Text></Pressable>
          : <Pressable onPress={() => go(-1)} disabled={busy} hitSlop={10} accessibilityRole="button">
              <Text style={[styles.back, busy && styles.dim]}>Back</Text>
            </Pressable>}
        <Pressable style={[styles.next, next.quiet === true && styles.nextQuiet, next.off === true && styles.dim]}
          disabled={next.off === true} onPress={next.onPress} accessibilityRole="button">
          <Text style={[styles.nextText, next.quiet === true && styles.nextTextQuiet]}>{next.label}</Text>
        </Pressable>
      </View>
      <Veil />
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.cream },
  header: { paddingHorizontal: 18 },
  logo: { height: 34, width: 34 * (900 / 415) },

  trail: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingTop: 6, paddingBottom: 4 },
  trailPart: { flexDirection: 'row', alignItems: 'center' },
  trailDots: { flexDirection: 'row', gap: 5, paddingHorizontal: 7 },
  trailDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: palette.trail },
  waypoint: {
    width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.cream, borderWidth: 1.5, borderColor: palette.trail,
  },
  waypointPassed: { backgroundColor: palette.sage, borderColor: palette.sage },
  waypointHere: { borderColor: palette.pine, backgroundColor: palette.paper },
  waypointCheck: { width: 13, height: 13, tintColor: palette.pine },
  waypointLeaf: { width: 14, height: 14, tintColor: palette.pine },

  page: { flex: 1 },
  pageInner: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 12, gap: 14 },
  pageFixed: { paddingBottom: 4 },
  title: { fontFamily: JOURNAL, color: palette.ink, fontSize: 32, lineHeight: 40 },
  lead: { color: palette.ink, fontSize: 16, lineHeight: 24 },
  body: { color: palette.ink, fontSize: 15, lineHeight: 23 },
  note: { color: palette.moss, fontSize: 13, lineHeight: 19 },
  caution: { color: palette.amber, fontSize: 13, lineHeight: 19 },
  error: { color: palette.clay, fontSize: 13, lineHeight: 19 },
  link: { color: palette.pine, fontSize: 14, fontWeight: '700' },
  grow: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  centred: { alignSelf: 'center', marginVertical: 20 },

  card: {
    backgroundColor: palette.paper, borderRadius: radius.card, padding: 16, gap: 10,
    borderWidth: 1, borderColor: palette.sand, boxShadow: `0 3 12 ${palette.shade}`,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontFamily: JOURNAL, color: palette.ink, fontSize: 20 },
  tick: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.sage },
  tickMark: { width: 15, height: 15, tintColor: palette.pine },
  action: { alignSelf: 'flex-start', borderRadius: radius.control, backgroundColor: palette.pine, paddingHorizontal: 16, paddingVertical: 11 },
  actionInline: { alignSelf: 'center' },
  actionText: { color: palette.paper, fontSize: 15, fontWeight: '700' },

  promise: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 4 },
  promiseMark: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  promiseGlyph: { width: 22, height: 22, tintColor: palette.pine },
  promiseWords: { flex: 1 },
  promiseTitle: { fontFamily: JOURNAL, color: palette.ink, fontSize: 18 },

  listCard: { flex: 1, paddingVertical: 4 },
  state: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderTopWidth: 1, borderTopColor: palette.sand },
  stateFirst: { borderTopWidth: 0 },
  stateName: { color: palette.ink, fontSize: 15 },
  meta: { color: palette.moss, fontSize: 12, marginTop: 2 },
  box: { width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: palette.trail, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: palette.pine, borderColor: palette.pine },
  boxHere: { backgroundColor: palette.sage, borderColor: palette.sage },
  boxMark: { width: 14, height: 14, tintColor: palette.paper },
  boxMarkHere: { tintColor: palette.pine },
  bar: { height: 6, backgroundColor: palette.oat, borderRadius: 3, marginTop: 6, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: palette.leaf },

  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 10 },
  back: { color: palette.moss, fontSize: 15, fontWeight: '600', paddingVertical: 10 },
  next: { borderRadius: radius.pill, backgroundColor: palette.pine, paddingHorizontal: 26, paddingVertical: 14, boxShadow: `0 4 14 ${palette.shade}` },
  nextQuiet: { backgroundColor: palette.oat, boxShadow: 'none' },
  nextText: { color: palette.paper, fontSize: 16, fontWeight: '700' },
  nextTextQuiet: { color: palette.ink },
  dim: { opacity: 0.4 },
});
