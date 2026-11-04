/**
 * The horizon at the top of the app: a paper-cut sky, the sun or the moon,
 * drifting clouds, a bird far off, and three layers of hills.
 *
 * It stands where a header bar would. The nearest hill is the colour of the
 * page, so the chat below reads as the ground the landscape sits on.
 *
 * The sun is also the switch between the day and night colours (theme.tsx).
 * The sun and the moon sit at opposite ends of a wheel whose hub is below the
 * horizon. Press the one that is up and swipe sideways, either way, and the
 * wheel turns with the finger: one sinks behind the hills as the sky passes
 * through dusk and the other comes up the far side. Let go and it finishes
 * whichever way it was heading; a tap does the whole turn by itself.
 *
 * Plain tinted images (scripts/build-ui-glyphs.mjs) moved by transform and
 * opacity only, like the loader, so it costs the JavaScript thread nothing
 * while Fred works. Colours never animate: each sky and each hill has a day
 * and a night version, cross-faded.
 */
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Animated, Easing, Image, PanResponder, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useReduceMotion } from './motion.ts';
import { SUNSET, VEIL_COLOUR, follow, useTheme, veiled } from './theme.tsx';

const HILL_BACK = require('../assets/ui/hill-back.png');
const HILL_MID = require('../assets/ui/hill-mid.png');
const HILL_FRONT = require('../assets/ui/hill-front.png');
const CLOUD = require('../assets/ui/cloud.png');
const GULL = require('../assets/ui/gull.png');

const DAY = { sky: '#DDEDF2', orb: '#FBE49C', back: '#C3DEC6', mid: '#A8CFA8' } as const;
const DUSK = { sky: '#EDBFB4' } as const;
const NIGHT = { sky: '#263250', orb: '#FFFCF4', back: '#34495C', mid: '#284338' } as const;
const WHITE = '#FFFCF4';

/** Where the sun or moon rests: across the screen, and down the open sky, as fractions. Left of the middle, lowish. */
const ORB_ACROSS = 0.36;
const ORB_DOWN = 0.56;

/** Fixed, so the stars don't jump between renders: across, down. */
const STARS: readonly (readonly [number, number])[] = [
  [0.08, 0.3], [0.2, 0.62], [0.3, 0.12], [0.52, 0.5], [0.66, 0.2], [0.8, 0.58], [0.92, 0.2],
];

const CLOUD_MS = 110_000;
const GULL_MS = 34_000;
/** A press that moves less than this is a tap. */
const TAP = 8;

export function Scene(
  { height, top, hint = false, sunset = false, children }: {
    height: number;
    /** The status bar's height: nothing of the sky's furniture is drawn under the clock. */
    top: number;
    /** A slow ring round the sun or moon, for the page that teaches the switch (#196). */
    hint?: boolean;
    /** #209: the sky held at sunset (the About page), whatever the time of day. */
    sunset?: boolean;
    children?: ReactNode;
  },
): React.JSX.Element {
  const { width } = useWindowDimensions();
  const still = useReduceMotion();
  const { palette, mode, turn, at, hold, settle } = useTheme();

  const drift = useRef(new Animated.Value(0)).current;
  const glide = useRef(new Animated.Value(0)).current;
  const ripple = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (still || !hint) return;
    const loop = Animated.loop(Animated.timing(ripple, { toValue: 1, duration: 2400, easing: Easing.out(Easing.quad), useNativeDriver: true }));
    loop.start();
    return () => { loop.stop(); ripple.setValue(0); };
  }, [still, hint, ripple]);
  useEffect(() => {
    if (still) return;
    const forever = (v: Animated.Value, duration: number) =>
      Animated.loop(Animated.timing(v, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }));
    const loops = [forever(drift, CLOUD_MS), forever(glide, GULL_MS)];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [still, drift, glide]);

  // The hills are drawn four times as wide as tall and keep that shape.
  const hills = { width, height: width / 4 };
  const open = Math.max(40, height - top - hills.height * 0.5);
  const orb = Math.min(60, Math.max(30, open * 0.42));
  // The wheel: its hub sits under the bottom edge, and the sun rides the top
  // of the rim with the moon opposite, out of sight below.
  const rest = { x: width * ORB_ACROSS, y: top + ORB_DOWN * open };
  const hub = height + orb * 0.7;
  const rim = hub - rest.y;
  // The second cloud runs half a lap behind the first.
  const lap = [-90, width + 10];
  const halfLap = (lap[0]! + lap[1]!) / 2;

  // The swipe. A little over half the screen's width is one half-turn, and a
  // swipe can take the wheel one half-turn either way from where it started.
  const reach = width * 0.55;
  const live = useRef({ reach, hold, settle });
  live.current = { reach, hold, settle };
  const pan = useMemo(() => {
    let from = 0;
    let home = 0;
    let last = 0;
    const end = (to: number): void => live.current.settle(Math.max(home - 1, Math.min(home + 1, to)));
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        // A swipe may catch the wheel still turning from the last one.
        from = live.current.hold();
        home = Math.round(from);
        last = from;
      },
      onPanResponderMove: (_, g) => {
        last = Math.max(home - 1, Math.min(home + 1, from + g.dx / live.current.reach));
        turn.setValue(last);
      },
      onPanResponderRelease: (_, g) => {
        if (Math.hypot(g.dx, g.dy) < TAP) { end(home + 1); return; }
        // A quick flick carries on the way it was going.
        end(Math.round(last + (g.vx * 220) / live.current.reach));
      },
      onPanResponderTerminate: () => end(Math.round(last)),
    });
  }, [turn]);

  // Made once: see `follow` for why not on every render.
  const fx = useMemo(() => ({
    spin: turn.interpolate({ inputRange: [-2, 2], outputRange: ['-360deg', '360deg'] }),
    dusk: follow(turn, (n) => (n < 0.5 ? 1 : 2 - 2 * n)),
    day: follow(turn, (n) => Math.max(0, 1 - 2 * n)),
    stars: follow(turn, (n) => Math.max(0, (n - 0.55) / 0.45)),
    clouds: follow(turn, (n) => 0.9 - 0.68 * n),
    // By day the night hills are not drawn at all: under the day ones they
    // showed through at the edges as a dark outline.
    nightHills: follow(turn, (n) => Math.min(1, n / 0.12)),
    dayHills: follow(turn, (n) => 1 - n),
    veil: follow(turn, veiled),
    // The hint's ring changes colour with the page, so it steps aside for the change.
    hint: follow(turn, (n) => 1 - veiled(n)),
  }), [turn]);

  return (
    <View style={[styles.root, { height, backgroundColor: NIGHT.sky }]}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none"
        accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: DUSK.sky, opacity: fx.dusk }]} />
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: DAY.sky, opacity: fx.day }]} />
        {sunset && <View style={[StyleSheet.absoluteFill, { backgroundColor: palette.night ? SUNSET.night.sky : SUNSET.day.sky }]} />}

        <Animated.View style={[StyleSheet.absoluteFill, { opacity: fx.stars }]}>
          {STARS.map(([x, y], i) => (
            <View key={i} style={[styles.star, { left: x * width, top: top + y * open }]} />
          ))}
        </Animated.View>

        {/* The wheel, with the sun at the top of its rim and the moon at the bottom. */}
        <Animated.View style={[styles.wheel, { left: rest.x - rim, top: hub - rim, width: rim * 2, height: rim * 2,
          transform: [{ rotate: fx.spin }] }]}>
          <View style={[styles.orbBox, { left: rim - orb, top: -orb, width: orb * 2, height: orb * 2 }]}>
            <View style={[styles.glow, { width: orb * 1.7, height: orb * 1.7, borderRadius: orb, backgroundColor: DAY.orb }]} />
            <View style={{ width: orb, height: orb, borderRadius: orb / 2, backgroundColor: DAY.orb }} />
          </View>
          <View style={[styles.orbBox, { left: rim - orb, top: rim * 2 - orb, width: orb * 2, height: orb * 2 }]}>
            <View style={[styles.glow, { width: orb * 1.6, height: orb * 1.6, borderRadius: orb, backgroundColor: NIGHT.orb, opacity: 0.16 }]} />
            <View style={{ width: orb * 0.86, height: orb * 0.86, borderRadius: orb / 2, backgroundColor: NIGHT.orb }} />
          </View>
        </Animated.View>

        <Animated.View style={[StyleSheet.absoluteFill, { opacity: fx.clouds }]}>
          <Animated.Image source={CLOUD} resizeMode="contain"
            style={[styles.cloud, { top: top + open * 0.12, transform: [{
              translateX: still ? width * 0.12 : drift.interpolate({ inputRange: [0, 1], outputRange: lap }),
            }] }]} />
          <Animated.Image source={CLOUD} resizeMode="contain"
            style={[styles.cloudSmall, { top: top + open * 0.5, transform: [{
              translateX: still ? width * 0.7 : drift.interpolate({
                inputRange: [0, 0.5, 0.5, 1], outputRange: [halfLap, lap[1]!, lap[0]!, halfLap],
              }),
            }] }]} />
          {!still && (
            <Animated.Image source={GULL} resizeMode="contain"
              style={[styles.gull, { top: top + open * 0.42, transform: [
                { translateX: glide.interpolate({ inputRange: [0, 1], outputRange: [-40, width + 40] }) },
                { translateY: glide.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, -9, 2, -7, 0] }) },
                // A slow wingbeat: the wings flatten and lift a few times per crossing.
                { scaleY: glide.interpolate({
                  inputRange: Array.from({ length: 25 }, (_, i) => i / 24),
                  outputRange: Array.from({ length: 25 }, (_, i) => (i % 2 === 0 ? 1 : 0.55)),
                }) },
              ] }]} />
          )}
        </Animated.View>

        {hint && (
          <Animated.View style={[styles.hint, { left: rest.x - orb, top: rest.y - orb, width: orb * 2, height: orb * 2, opacity: fx.hint }]}>
            <Animated.View style={{
              width: orb * 1.3, height: orb * 1.3, borderRadius: orb, borderWidth: 2,
              borderColor: palette.night ? WHITE : palette.pine,
              // Standing still, a plain ring; moving, it widens and fades like a ripple.
              opacity: still ? 0.5 : ripple.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.6, 0] }),
              transform: [{ scale: still ? 1.15 : ripple.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.5] }) }],
            }} />
          </Animated.View>
        )}

        <Animated.Image source={HILL_BACK} resizeMode="stretch"
          style={[styles.hill, hills, { tintColor: NIGHT.back, opacity: fx.nightHills }]} />
        <Animated.Image source={HILL_BACK} resizeMode="stretch"
          style={[styles.hill, hills, { tintColor: DAY.back, opacity: fx.dayHills }]} />
        <Animated.Image source={HILL_MID} resizeMode="stretch"
          style={[styles.hill, hills, { tintColor: NIGHT.mid, opacity: fx.nightHills }]} />
        <Animated.Image source={HILL_MID} resizeMode="stretch"
          style={[styles.hill, hills, { tintColor: DAY.mid, opacity: fx.dayHills }]} />
        {/* The nearest hill is the page, and hides behind the same veil as the page. */}
        <Image source={HILL_FRONT} resizeMode="stretch" style={[styles.hill, hills, {
          tintColor: !sunset ? palette.cream : palette.night ? SUNSET.night.page : SUNSET.day.page }]} />
        <Animated.Image source={HILL_FRONT} resizeMode="stretch"
          style={[styles.hill, hills, { tintColor: VEIL_COLOUR, opacity: fx.veil }]} />
      </View>

      {/* The part of the sky that takes the press: where the sun or the moon rests. */}
      <View {...pan.panHandlers}
        style={[styles.handle, { left: rest.x - 40, top: rest.y - 40 }]}
        accessible accessibilityRole="switch" accessibilityState={{ checked: mode === 'night' }}
        accessibilityLabel="Night colours" accessibilityHint="Swipe sideways or double tap to switch between day and night"
        onAccessibilityTap={() => settle(Math.round(at()) + 1)} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  // Above the veil that covers the page while the colours change.
  root: { overflow: 'hidden', zIndex: 2 },
  star: { position: 'absolute', width: 3, height: 3, borderRadius: 2, backgroundColor: WHITE, opacity: 0.9 },
  wheel: { position: 'absolute' },
  orbBox: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', opacity: 0.3 },
  hint: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  cloud: { position: 'absolute', left: 0, width: 80, height: 35, tintColor: WHITE },
  cloudSmall: { position: 'absolute', left: 0, width: 52, height: 23, tintColor: WHITE },
  gull: { position: 'absolute', left: 0, width: 22, height: 12, tintColor: WHITE },
  // Sunk a hair below the edge so no line of sky shows under the nearest hill.
  hill: { position: 'absolute', left: 0, bottom: -1 },
  handle: { position: 'absolute', width: 80, height: 80 },
});
