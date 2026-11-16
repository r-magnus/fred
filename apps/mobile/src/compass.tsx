/**
 * The compass on the map: a small dial that turns with the phone.
 *
 * The map itself always has north at the top, so the dial answers the other
 * half of "where am I": which way the phone is pointing. The mark at the top
 * of the dial is the phone; the rose under it turns so that N stays on true
 * north, and the middle spells the direction faced ("NE").
 *
 * The reading comes from expo-location's heading watcher, which runs only
 * while the map is open. A phone with no magnetometer, or one that has not
 * sent a reading yet, shows the rose at rest with N up, which is still true
 * of the map.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { useThemed, type Palette } from './theme.tsx';

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
const NAMES: Record<(typeof POINTS)[number], string> = {
  N: 'north', NE: 'north-east', E: 'east', SE: 'south-east',
  S: 'south', SW: 'south-west', W: 'west', NW: 'north-west',
};
const SIZE = 64;

export interface Heading {
  /** The rose's angle in degrees: minus the heading, and never jumping from 359 back to 0. */
  readonly turn: Animated.Value;
  readonly facing: (typeof POINTS)[number] | null;
  /** Low calibration: the reading can be tens of degrees out. */
  readonly unsure: boolean;
  /**
   * The smoothed heading in degrees from true north, 0-360, or null before
   * the first reading. A ref, not state: it changes many times a second, and
   * the route view reads it on its own clock to turn the map (#226).
   */
  readonly degrees: { readonly current: number | null };
}

/** The phone's heading while the caller is on screen: one watcher for the dial and the map's marker. */
export function useHeading(): Heading {
  const turn = useRef(new Animated.Value(0)).current;
  // The rose's angle without the jump from 359 back to 0, so it never spins the long way round.
  const angle = useRef(0);
  const [facing, setFacing] = useState<(typeof POINTS)[number] | null>(null);
  // Low calibration: the reading can be tens of degrees out, so it is shown fainter.
  const [unsure, setUnsure] = useState(false);
  const degrees = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    let sub: Location.LocationSubscription | null = null;
    void Location.watchHeadingAsync((h) => {
      if (!live) return;
      // True north needs the location permission; without it only magnetic is given.
      const heading = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
      if (!Number.isFinite(heading)) return;
      const target = -heading;
      const step = ((target - angle.current + 540) % 360) - 180;
      // The sensor reports many times a second; a slight lag steadies the needle.
      angle.current += step * 0.35;
      turn.setValue(angle.current);
      degrees.current = ((-angle.current % 360) + 360) % 360;
      setFacing(POINTS[Math.round(heading / 45) % 8]!);
      setUnsure(h.accuracy <= 1);
    }).then((s) => { if (live) sub = s; else s.remove(); }, () => undefined);
    return () => { live = false; sub?.remove(); };
  }, [turn]);
  return { turn, facing, unsure, degrees };
}

export function Compass({ heading }: { heading: Heading }): React.JSX.Element {
  const { styles } = useThemed(makeStyles);
  const { turn, facing, unsure } = heading;

  return (
    <View style={styles.dial} accessibilityRole="image"
      accessibilityLabel={facing === null ? 'Compass. North is at the top of the map.' : `Compass. You are facing ${NAMES[facing]}.`}>
      <Animated.View style={[styles.rose, unsure && styles.unsure, { transform: [{
        rotate: turn.interpolate({ inputRange: [-360, 360], outputRange: ['-360deg', '360deg'] }),
      }] }]}>
        <Text style={styles.north}>N</Text>
        <View style={[styles.tick, styles.east]} />
        <View style={[styles.tick, styles.south]} />
        <View style={[styles.tick, styles.west]} />
      </Animated.View>
      {/* The phone: a fixed mark at the top of the dial. */}
      <View style={styles.phone} />
      <Text style={styles.facing}>{facing ?? ''}</Text>
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  dial: {
    width: SIZE, height: SIZE, borderRadius: SIZE / 2, alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.paper, borderWidth: 1, borderColor: palette.sand,
    boxShadow: `0 3 12 ${palette.shade}`,
  },
  rose: { position: 'absolute', width: SIZE, height: SIZE, alignItems: 'center' },
  unsure: { opacity: 0.45 },
  north: { position: 'absolute', top: 5, color: palette.clay, fontSize: 13, fontWeight: '800' },
  tick: { position: 'absolute', width: 5, height: 5, borderRadius: 3, backgroundColor: palette.trail },
  east: { right: 8, top: SIZE / 2 - 3 },
  south: { bottom: 8 },
  west: { left: 8, top: SIZE / 2 - 3 },
  phone: {
    position: 'absolute', top: -5, width: 10, height: 10, borderRadius: 5,
    backgroundColor: palette.pine, borderWidth: 2, borderColor: palette.paper,
  },
  facing: { color: palette.ink, fontSize: 15, fontWeight: '700' },
});
