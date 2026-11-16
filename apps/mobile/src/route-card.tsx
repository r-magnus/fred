/**
 * The route's part of the map sheet (#223): what the pin is, the "Route here"
 * button, the plan in progress, and the route's numbers and warnings.
 *
 * Laid out like the sheet's other blocks (the edge warning, the signal advice)
 * so it reads as part of the same sheet. Warnings sit in a block with a heading
 * and a coloured edge, as the edge warning does, so they are not carried by
 * colour alone. The standing caveat is always shown, never behind a tap.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { distanceMeters } from '@fred/geo';
import { CalmLoader } from './calm-loader.tsx';
import { radius, useThemed, type Palette } from './theme.tsx';
import {
  ALWAYS_CAVEAT, MOVE_PIN_HINT, ROUTE_HEADLINE, SIGNAL_SOURCE, SIGNAL_TITLE, STAY_PUT, climbWords, distanceWords, failureStep, failureWords, progressLine, routeWarnings, timeWords, trailNames,
  type RouteProgress,
} from './route-view.ts';
import type { RouteState } from './use-route.ts';

export interface RouteCardProps {
  readonly state: RouteState;
  readonly fix: { readonly latitude: number; readonly longitude: number } | null;
  readonly onRoute: () => void;
  readonly onClear: () => void;
  /** Start walking it: the map follows and turns with the phone. */
  readonly onStart?: () => void;
  /** No position yet: ask for one, in place of a greyed-out Route here. */
  readonly onLocate?: () => void;
  /** No detailed map here: open the offline maps panel. */
  readonly onGetMap?: () => void;
}

/**
 * 2026-11-16 UX pass: the ready card went from about a dozen lines to the
 * fewest that still say what matters. The title carries "rough"; distance,
 * time and climb share one line; the caution is one sentence. Every failure
 * ends with something to do (skill §4, never a dead end).
 */
export function RouteCard({ state, fix, onRoute, onClear, onStart, onLocate, onGetMap }: RouteCardProps): React.JSX.Element | null {
  const { styles } = useThemed(makeStyles);
  if (state.kind === 'none') return null;
  // Fred's suggestion of the nearest signal (#226): staying put comes first,
  // before any walking, on every state of the card.
  const signal = state.purpose === 'signal';
  const stayPut = signal ? (
    <View style={styles.stay} accessibilityRole="text">
      <Text style={styles.stayText}>{STAY_PUT}</Text>
    </View>
  ) : null;

  const clear = (label: string) => (
    <Pressable onPress={onClear} hitSlop={10} style={styles.link} accessibilityRole="button">
      <Text style={styles.linkText}>{label}</Text>
    </Pressable>
  );
  const primary = (label: string, onPress: () => void, hint?: string) => (
    <Pressable style={styles.primary} onPress={onPress} accessibilityRole="button" accessibilityHint={hint}>
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  );

  if (state.kind === 'pin') {
    const away = fix === null ? null : distanceMeters(fix.latitude, fix.longitude, state.pin[1], state.pin[0]);
    return (
      <View style={styles.card}>
        {stayPut}
        <Text style={styles.title}>{signal ? 'Nearest reported signal' : 'Pin dropped'}</Text>
        <Text style={styles.text}>
          {away === null ? 'Fred needs to know where you are to plan a route.'
            : `${distanceWords(away)} away in a straight line.`}
        </Text>
        <View style={styles.row}>
          {away === null
            ? (onLocate !== undefined && primary('Find where I am', onLocate))
            : primary('Route here', onRoute)}
          {clear('Remove pin')}
        </View>
      </View>
    );
  }

  if (state.kind === 'planning') {
    return (
      <View style={styles.card}>
        {stayPut}
        <View style={styles.planning}>
          <CalmLoader size={26} />
          <Text style={styles.text}>{signal ? 'Planning a route to the nearest signal…' : 'Planning a walking route…'}</Text>
        </View>
        <View style={styles.row}>{clear('Cancel')}</View>
      </View>
    );
  }

  if (state.kind === 'failed') {
    const step = failureStep(state.reason);
    return (
      <View style={styles.card}>
        {stayPut}
        <Text style={styles.title}>{signal ? 'No route to signal' : 'No route'}</Text>
        <Text style={styles.text}>{failureWords(state.reason)}</Text>
        {step === 'move-pin' && <Text style={styles.hint}>{MOVE_PIN_HINT}</Text>}
        <View style={styles.row}>
          {step === 'get-map' && onGetMap !== undefined && primary('Get the map', onGetMap)}
          {step === 'retry' && fix !== null && primary('Try again', onRoute)}
          {clear('Remove pin')}
        </View>
      </View>
    );
  }

  const { route } = state;
  const climb = climbWords(route);
  const names = trailNames(route);
  const warnings = routeWarnings(route);
  // "2.3 km · about 40–60 min · 120 m up": one line to read, not three.
  const numbers = [distanceWords(route.meters), timeWords(route.seconds), ...(climb === null ? [] : [climb.toLowerCase()])].join(' · ');
  return (
    <View style={styles.card}>
      {stayPut}
      <Text style={styles.title} accessibilityRole="header">{signal ? SIGNAL_TITLE : ROUTE_HEADLINE}</Text>
      <Text style={styles.numbers} accessibilityRole="summary">{numbers}</Text>
      {names.length > 0 && <Text style={styles.text}>Follows {names.join(', ')}.</Text>}
      {warnings.length > 0 && (
        <View style={styles.warn}>
          <Text style={styles.warnTitle}>Take care</Text>
          {warnings.map((w) => <Text key={w} style={styles.warnText}>{w}</Text>)}
        </View>
      )}
      <Text style={styles.caveat}>{signal ? `${ALWAYS_CAVEAT} ${SIGNAL_SOURCE}` : ALWAYS_CAVEAT}</Text>
      <View style={styles.row}>
        {onStart !== undefined && primary('Start', onStart, 'The map follows you and turns the way you face')}
        {clear('Clear route')}
      </View>
    </View>
  );
}

/**
 * The sheet while walking the route: small, so the map gets the screen.
 * What's left, where you are on it, and End.
 */
export function NavCard(
  { progress, accuracyMeters, onEnd }: { progress: RouteProgress | null; accuracyMeters: number | null; onEnd: () => void },
): React.JSX.Element {
  const { styles } = useThemed(makeStyles);
  const line = progress === null ? null : progressLine(progress, accuracyMeters);
  return (
    <View style={styles.nav}>
      <View style={styles.navText}>
        <Text style={styles.numbers} accessibilityLiveRegion="polite">
          {progress === null ? 'Finding you…'
            : progress.arrived ? 'You made it'
            : `${distanceWords(progress.remainingMeters)} to go · ${timeWords(progress.remainingSeconds)}`}
        </Text>
        {line !== null && (
          <Text style={[styles.text, line.warn && styles.navWarn]} accessibilityLiveRegion={line.warn ? 'assertive' : 'polite'}>
            {line.text}
          </Text>
        )}
      </View>
      <Pressable style={styles.end} onPress={onEnd} accessibilityRole="button" accessibilityLabel="End the route">
        <Text style={styles.endText}>End</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  card: { marginTop: 12 },
  title: { color: palette.ink, fontSize: 16, fontWeight: '700', lineHeight: 22 },
  numbers: { color: palette.ink, fontSize: 20, fontWeight: '700', lineHeight: 26, marginTop: 6 },
  text: { color: palette.ink, fontSize: 16, lineHeight: 23, marginTop: 6 },
  hint: { color: palette.moss, fontSize: 15, lineHeight: 22, marginTop: 6 },
  planning: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 12 },
  primary: {
    minHeight: 48, justifyContent: 'center',
    backgroundColor: palette.pine, borderRadius: radius.pill, paddingHorizontal: 20, paddingVertical: 11,
  },
  primaryText: { color: palette.paper, fontSize: 15, fontWeight: '700' },
  link: { minHeight: 48, justifyContent: 'center' },
  linkText: { color: palette.pine, fontSize: 15, fontWeight: '700', textDecorationLine: 'underline' },
  warn: {
    marginTop: 12, padding: 12, borderRadius: radius.control,
    backgroundColor: palette.butter, borderLeftWidth: 4, borderLeftColor: palette.amber,
  },
  warnTitle: { color: palette.ink, fontSize: 15, fontWeight: '700', lineHeight: 21 },
  // Safety text: body size, not small print (skill §2).
  warnText: { color: palette.ink, fontSize: 16, lineHeight: 23, marginTop: 4 },
  // Safety advice before the route, not a warning about it: pine, not amber.
  stay: {
    padding: 12, borderRadius: radius.control, marginBottom: 10,
    backgroundColor: palette.cream, borderLeftWidth: 4, borderLeftColor: palette.pine,
  },
  stayText: { color: palette.ink, fontSize: 16, fontWeight: '700', lineHeight: 22 },
  // Ink, not moss: it is safety text, and 7:1 survives the sun better (skill §3).
  caveat: { color: palette.ink, fontSize: 14, lineHeight: 20, marginTop: 10 },
  nav: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10 },
  navText: { flex: 1 },
  // Words and a left edge as well as colour, as the sheet's other warnings.
  navWarn: {
    backgroundColor: palette.butter, borderLeftWidth: 4, borderLeftColor: palette.amber,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, overflow: 'hidden',
  },
  end: {
    minHeight: 48, minWidth: 72, justifyContent: 'center', alignItems: 'center',
    borderRadius: radius.pill, paddingHorizontal: 18, borderWidth: 1.5, borderColor: palette.clay, backgroundColor: palette.paper,
  },
  endText: { color: palette.clay, fontSize: 15, fontWeight: '700' },
});
