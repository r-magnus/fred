/**
 * The app's colours, in a day set and a night set, and the switch between them.
 *
 * Day is cream paper, the logo's pine green and a few pastels; night is the
 * same forest after dark. Text colours are checked against their backgrounds
 * rather than chosen by eye: the phone is read outdoors in sunlight and in a
 * tent at night, so the soft look stops at the backgrounds and body text and
 * warnings keep at least 4.5:1 contrast in both.
 *
 * The switch is the sun in the horizon (src/scene.tsx): swiped sideways it
 * wheels down behind the hills and the moon wheels up. `turn` is that wheel,
 * in half-turns: day at 0, night at 1 (or -1, the other way round). Half way,
 * the page is hidden behind a dusk-coloured veil, and the colours underneath
 * change at that moment, so nothing is ever seen to jump.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { File, Paths } from 'expo-file-system';

export interface Palette {
  readonly night: boolean;
  /** The screen. */
  readonly cream: string;
  /** Cards and the text box, a shade lighter than the screen. */
  readonly paper: string;
  /** Buttons and chips that sit on a card. */
  readonly oat: string;
  /** Hairlines and card edges. */
  readonly sand: string;
  /** The logo's green: links, titles, the Ask button. */
  readonly pine: string;
  /** The logo itself, which has to stand out against the sky. */
  readonly logo: string;
  /** Body text. */
  readonly ink: string;
  /** Secondary text: sources, hints, notes. */
  readonly moss: string;
  /** Pastels: tabs and markers, and the loading tree. */
  readonly sage: string;
  readonly leaf: string;
  readonly sky: string;
  readonly fir: string;
  /** Between leaf and fir, and the trunk: the loader's tree. */
  readonly grove: string;
  readonly bark: string;
  /** A pale blue for tabs: replies drawn from the guides, and the map. */
  readonly skyWash: string;
  /** The dotted trail down the chat, and the rings on it. */
  readonly trail: string;
  readonly butter: string;
  readonly blush: string;
  /** Warnings stay warm but must not be missed. */
  readonly clay: string;
  readonly amber: string;
  readonly plum: string;
  /** Soft shadows under cards and floating controls. */
  readonly shade: string;
}

export const day: Palette = {
  night: false,
  cream: '#FBF4E4', paper: '#FFFCF4', oat: '#F3E9D2', sand: '#E6DAC0',
  pine: '#316C33', logo: '#316C33', ink: '#2B352C', moss: '#5C6A59',
  sage: '#D5E7CC', leaf: '#8DBF8A', sky: '#8CB9D9', fir: '#5E9A62', grove: '#76AD77', bark: '#BFA27C',
  skyWash: '#D6E8F1', trail: '#D9CBA8', butter: '#F8EBC0', blush: '#F6DDD3',
  clay: '#A4432B', amber: '#7A5A12', plum: '#73496A',
  shade: 'rgba(49, 108, 51, 0.10)',
};

export const night: Palette = {
  night: true,
  cream: '#16221E', paper: '#1F2E28', oat: '#2A3C34', sand: '#35483F',
  pine: '#A5D6A0', logo: '#E3EEDA', ink: '#EDF2E6', moss: '#A7B6A5',
  sage: '#2E4A3A', leaf: '#86BD84', sky: '#8CB9D9', fir: '#6CAA70', grove: '#79B07A', bark: '#A98C68',
  skyWash: '#2A4253', trail: '#3E5247', butter: '#463F22', blush: '#4D342E',
  clay: '#F2A48C', amber: '#EBCF82', plum: '#DDB6D2',
  shade: 'rgba(0, 0, 0, 0.35)',
};

/** Rounded corners, used everywhere so nothing on screen has a hard edge. */
export const radius = { card: 18, control: 14, pill: 999 } as const;

/** What the page hides behind while its colours change: the sky at dusk. */
const VEIL = '#C9A0AE';

/**
 * #209: how far the page below the sky has turned, for a given point in the
 * change to About: it is fully turned by half way (about.tsx). The nearest
 * hill is the page's top edge, so it turns by this too, or a line shows.
 */
export const pageTurn = (p: Animated.Value): Animated.AnimatedInterpolation<number> =>
  p.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1, 1] });

/** #209: the light dusk veil that passes over the page (and its hill) half way to About. */
export const pageVeil = (p: Animated.Value): Animated.AnimatedInterpolation<number> =>
  p.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0.45, 0] });

/**
 * #209: the About page sits at sunset. The sky is the dusk of the day-night
 * change by day and a deeper twilight by night; the page under it is a warm
 * tint that keeps the theme's own text colours readable (ink on it is about
 * 12:1 by day and 12:1 by night, pine about 5.5:1 and 9:1).
 */
export const SUNSET = {
  // The hills turn with the sky: the far one paler, as distance does at dusk.
  // The logo warms with them: a deep rust on the sunset sky by day, a pale blush by night.
  day: { sky: '#EDBFB4', page: '#FBE3E1', back: '#D8ADA6', mid: '#BC918D', logo: '#8C4B3F' },
  night: { sky: '#5B4560', page: '#2A2230', back: '#4A3A55', mid: '#3A2E45', logo: '#F4D3C6' },
} as const;

export type Mode = 'day' | 'night';
interface Theme {
  readonly palette: Palette;
  readonly mode: Mode;
  /** The sun-and-moon wheel, in half-turns: even is day, odd is night. Kept within -2 to 2. */
  readonly turn: Animated.Value;
  /** Where the wheel is now. */
  readonly at: () => number;
  /** Take hold of the wheel: stops it if it is running, and says where it is. */
  readonly hold: () => number;
  /** Run the wheel to a whole half-turn from wherever it is, and remember the choice. */
  readonly settle: (to: number) => void;
}

/** How far into night a wheel position is: 0 at any day, 1 at any night. */
export const nightness = (turn: number): number => Math.abs(turn - 2 * Math.round(turn / 2));

/**
 * Something that follows the day-to-night change, as an animated number: `f`
 * gives its value for 0 (day) to 1 (night). The wheel can go round either way,
 * so the curve is laid out along the whole of it, in steps the native driver
 * joins with straight lines.
 *
 * Make these once (useMemo), not on every render. One made while the wheel is
 * already moving is not told where the wheel is until it next moves, which is
 * how a fast swipe used to leave the screen stuck half way.
 */
export function follow(turn: Animated.Value, f: (night: number) => number): Animated.AnimatedInterpolation<number> {
  const steps = Array.from({ length: 65 }, (_, i) => -2 + i / 16);
  return turn.interpolate({ inputRange: steps, outputRange: steps.map((t) => f(nightness(t))), extrapolate: 'clamp' });
}

const choice = (): File => new File(Paths.document, 'theme.json');
/** The hiker's own choice if they made one; otherwise by the clock. */
function startMode(): Mode {
  try {
    const f = choice();
    if (f.exists) {
      const saved: unknown = JSON.parse(f.textSync());
      if (saved === 'day' || saved === 'night') return saved;
    }
  } catch { /* fall through to the clock */ }
  const hour = new Date().getHours();
  return hour >= 20 || hour < 6 ? 'night' : 'day';
}

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [mode, setMode] = useState<Mode>(startMode);
  const turn = useRef(new Animated.Value(mode === 'night' ? 1 : 0)).current;
  const now = useRef(mode === 'night' ? 1 : 0);
  // The colours are changed from here and nowhere else, so that the change
  // always happens behind the veil. `wanted` is the set asked for, which the
  // screen may not have drawn yet; `after` runs once it has.
  const wanted = useRef(mode);
  const after = useRef<(() => void) | null>(null);
  const flip = useCallback((to: Mode, then?: () => void) => {
    if (wanted.current === to) { then?.(); return; }
    wanted.current = to;
    after.current = then ?? null;
    setMode(to);
  }, []);
  useEffect(() => {
    const then = after.current;
    after.current = null;
    // A frame's grace, so the new colours are on screen before the veil lifts.
    if (then !== null) requestAnimationFrame(then);
  }, [mode]);

  // True while the wheel is running by itself. The wheel then reports where
  // it is late and sometimes out of order, and a stale report from the wrong
  // side of half way used to switch the colours back for a moment: the page
  // came out of the veil in the wrong colours and then snapped right. So the
  // reports only change the colours while a finger is moving the wheel, when
  // they are immediate; a run changes them itself, at its half-way stop.
  const running = useRef(false);
  const run = useRef(0);
  useEffect(() => {
    const id = turn.addListener(({ value }) => {
      now.current = value;
      if (running.current) return;
      // A little past half way in each direction, so a finger resting on the
      // mark does not flick the whole app back and forth.
      const n = nightness(value);
      if (wanted.current === 'day' && n > 0.56) flip('night');
      else if (wanted.current === 'night' && n < 0.44) flip('day');
    });
    return () => turn.removeListener(id);
  }, [turn, flip]);

  const hold = useCallback(() => {
    run.current += 1;
    running.current = false;
    after.current = null;
    turn.stopAnimation((value) => { now.current = value; });
    return now.current;
  }, [turn]);

  const settle = useCallback((to: number) => {
    const end = Math.max(-2, Math.min(2, Math.round(to)));
    const rest = nightness(end);
    const target: Mode = rest === 1 ? 'night' : 'day';
    const mine = (run.current += 1);
    running.current = true;
    const go = (toValue: number, easing: (t: number) => number, then: () => void): void => {
      Animated.timing(turn, {
        toValue, duration: 140 + Math.abs(toValue - now.current) * 1000, easing, useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished || run.current !== mine) return;
        now.current = toValue;
        then();
      });
    };
    const land = (): void => go(end, Easing.out(Easing.cubic), () => {
      // Back to 0 or 1, which look the same as any other day or night, so the
      // next swipe has a full turn of room either way.
      turn.setValue(rest);
      now.current = rest;
      running.current = false;
    });
    if (wanted.current === target) land();
    else {
      // The colours have to change: stop half way, where the veil hides the
      // page, change them, and carry on once they are drawn.
      const way = Math.sign(end - now.current) || 1;
      const half = end - way * 0.5;
      const change = (): void => flip(target, () => { if (run.current === mine) land(); });
      if ((half - now.current) * way <= 0.02) change();
      else go(half, Easing.in(Easing.quad), change);
    }
    try { choice().write(JSON.stringify(target)); } catch { /* the choice lasts this session only */ }
  }, [turn, flip]);

  const theme = useMemo<Theme>(
    () => ({ palette: mode === 'night' ? night : day, mode, turn, at: () => now.current, hold, settle }),
    [mode, turn, hold, settle]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (theme === null) throw new Error('useTheme outside ThemeProvider');
  return theme;
}

/** A stylesheet per palette, built once each. */
const sheets = new WeakMap<object, Map<Palette, unknown>>();
export function sheetFor<S>(make: (palette: Palette) => S, palette: Palette): S {
  let made = sheets.get(make);
  if (made === undefined) { made = new Map(); sheets.set(make, made); }
  if (!made.has(palette)) made.set(palette, make(palette));
  return made.get(palette) as S;
}
export function useThemed<S>(make: (palette: Palette) => S): { palette: Palette; styles: S } {
  const { palette } = useTheme();
  return { palette, styles: sheetFor(make, palette) };
}

/**
 * For the few things that stay in plain sight above the veil during the change
 * (the logo, the side tab): drawn in both sets of colours, the night one
 * fading in over the day one and the day one then fading out beneath it, so
 * they turn with the sky instead of snapping. At rest only one is visible.
 */
export function Crossfade(
  { render, style }: { render: (palette: Palette) => ReactElement; style?: StyleProp<ViewStyle> },
): React.JSX.Element {
  const { turn } = useTheme();
  const fx = useMemo(() => ({
    day: follow(turn, (n) => (n < 0.5 ? 1 : 2 - 2 * n)),
    night: follow(turn, (n) => (n < 0.5 ? 2 * n : 1)),
  }), [turn]);
  return (
    <View style={style}>
      <Animated.View style={{ opacity: fx.day }}>{render(day)}</Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: fx.night }]}>{render(night)}</Animated.View>
    </View>
  );
}

/**
 * How much of the dusk veil shows: none by day or night, and all of it for a
 * stretch either side of half way, which is where the colours change.
 */
export const veiled = (night: number): number => Math.min(1, (0.5 - Math.abs(night - 0.5)) / 0.38);

/**
 * The veil over the page during the change. It goes above the page's content
 * and below the horizon, which keeps moving in plain sight.
 */
export function Veil(): React.JSX.Element {
  const { turn } = useTheme();
  const opacity = useMemo(() => follow(turn, veiled), [turn]);
  return (
    <Animated.View pointerEvents="none"
      style={[StyleSheet.absoluteFill, { zIndex: 1, backgroundColor: VEIL, opacity }]} />
  );
}
export const VEIL_COLOUR = VEIL;
