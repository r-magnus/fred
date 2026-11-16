/**
 * The route's part of the map sheet (#223): what the pin is, the "Route here"
 * button, the plan in progress, and the route's numbers and warnings.
 *
 * Laid out like the sheet's other blocks (the edge warning, the signal advice)
 * so it reads as part of the same sheet. Warnings sit in a block with a heading
 * and a coloured edge, as the edge warning does, so they are not carried by
 * colour alone. The standing caveat is always shown, never behind a tap.
 */

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { distanceMeters } from '@fred/geo';
import { CalmLoader } from './calm-loader.tsx';
import { radius, useThemed, type Palette } from './theme.tsx';
import {
  ALWAYS_CAVEAT, MOVE_PIN_HINT, ROUTE_HEADLINE, SIGNAL_SOURCE, SIGNAL_TITLE, STAY_PUT, climbWords, distanceWords, failureStep, failureWords, progressLine, routeWarnings, timeWords, trailNames, warningTags,
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
 * 2026-11-16 UX passes. Ryan: "still a ton of text". Laid out the way trail
 * and map apps show a route before you go (one big line of numbers, the
 * action, details on request) and per the skill: the fewest things on
 * screen, warnings never hidden, only shortened. The face: a small "Rough
 * route" label, time · distance · climb, the warnings as short tags in the
 * warning block, Start and Details. Behind Details: the full warning
 * sentences, the trails, and the map caveat. ✕ in the corner clears it.
 * Every failure ends with something to do (never a dead end).
 */
export function RouteCard({ state, fix, onRoute, onClear, onStart, onLocate, onGetMap }: RouteCardProps): React.JSX.Element | null {
  const { styles } = useThemed(makeStyles);
  const [open, setOpen] = useState(false);
  if (state.kind === 'none') return null;
  // Fred's suggestion of the nearest signal (#226): staying put comes first,
  // before any walking, on every state of the card. Wording Ryan approved.
  const signal = state.purpose === 'signal';
  const stayPut = signal ? (
    <View style={styles.stay} accessibilityRole="text">
      <Text style={styles.stayText}>{STAY_PUT}</Text>
    </View>
  ) : null;

  const close = (label: string) => (
    <Pressable onPress={onClear} style={styles.close} accessibilityRole="button" accessibilityLabel={label}>
      <Text style={styles.closeMark} importantForAccessibility="no">✕</Text>
    </Pressable>
  );
  const head = (label: string, closeLabel: string) => (
    <View style={styles.head}>
      <Text style={styles.label} accessibilityRole="header" numberOfLines={2}>{label}</Text>
      {close(closeLabel)}
    </View>
  );
  const primary = (text: string, onPress: () => void, hint?: string) => (
    <Pressable style={styles.primary} onPress={onPress} accessibilityRole="button" accessibilityHint={hint}>
      <Text style={styles.primaryText}>{text}</Text>
    </Pressable>
  );

  if (state.kind === 'pin') {
    const away = fix === null ? null : distanceMeters(fix.latitude, fix.longitude, state.pin[1], state.pin[0]);
    return (
      <View style={styles.card}>
        {stayPut}
        {head(signal ? 'Nearest reported signal' : 'Pin', 'Remove pin')}
        <Text style={away === null ? styles.text : styles.numbers}>
          {away === null ? 'Fred needs your position to plan a route.' : `${distanceWords(away)} away`}
        </Text>
        <View style={styles.row}>
          {away === null
            ? (onLocate !== undefined && primary('Find where I am', onLocate))
            : primary('Route here', onRoute)}
        </View>
      </View>
    );
  }

  if (state.kind === 'planning') {
    return (
      <View style={styles.card}>
        {stayPut}
        <View style={styles.head}>
          <View style={styles.planning}>
            <CalmLoader size={26} />
            <Text style={styles.text}>Planning a route…</Text>
          </View>
          {close('Cancel')}
        </View>
      </View>
    );
  }

  if (state.kind === 'failed') {
    const step = failureStep(state.reason);
    return (
      <View style={styles.card}>
        {stayPut}
        {head('No route', 'Remove pin')}
        <Text style={styles.text}>{failureWords(state.reason)}</Text>
        {step === 'move-pin' && <Text style={styles.hint}>{MOVE_PIN_HINT}</Text>}
        {((step === 'get-map' && onGetMap !== undefined) || (step === 'retry' && fix !== null)) && (
          <View style={styles.row}>
            {step === 'get-map' && onGetMap !== undefined && primary('Get the map', onGetMap)}
            {step === 'retry' && fix !== null && primary('Try again', onRoute)}
          </View>
        )}
      </View>
    );
  }

  const { route } = state;
  const climb = climbWords(route);
  const names = trailNames(route);
  const tags = warningTags(route);
  // "3–4½ h · 8.5 km · ↑780 m": time first, the number a walker plans by.
  // Each part kept whole, so a narrow screen wraps between parts.
  const whole = (part: string): string => part.replace(/ /g, '\u00A0');
  const up = route.hasElevation && route.ascent >= 20 ? `↑${(Math.round(route.ascent / 10) * 10).toLocaleString('en-US')} m` : null;
  const numbers = [timeWords(route.seconds).replace(/^about /, ''), distanceWords(route.meters), ...(up === null ? [] : [up])]
    .map(whole).join('  ·  ');
  const spoken = `About ${timeWords(route.seconds).replace(/^about /, '')}, ${distanceWords(route.meters)}${climb === null ? '' : `, ${climb}`}`;
  return (
    <View style={styles.card}>
      {stayPut}
      {head(names.length > 0 ? `${signal ? 'Rough route to signal' : 'Rough route'} · ${names[0]}` : signal ? SIGNAL_TITLE : ROUTE_HEADLINE, 'Clear route')}
      <Text style={styles.numbers} accessibilityLabel={spoken}>{numbers}</Text>
      {tags.length > 0 && (
        <View style={styles.warn}>
          <Text style={styles.warnText}><Text style={styles.warnTitle}>Take care: </Text>{tags.join(' · ')}</Text>
        </View>
      )}
      <View style={styles.row}>
        {onStart !== undefined && primary('Start', onStart, 'The map follows you and turns the way you face')}
        <Pressable style={styles.details} onPress={() => setOpen((o) => !o)}
          accessibilityRole="button" accessibilityState={{ expanded: open }}>
          <Text style={styles.detailsText}>Details</Text>
          <Text style={styles.chevron} importantForAccessibility="no">{open ? '▴' : '▾'}</Text>
        </Pressable>
      </View>
      {open && (
        <View style={styles.more}>
          {routeWarnings(route).map((w) => <Text key={w} style={styles.moreText}>{w}</Text>)}
          {climb !== null && <Text style={styles.moreText}>Climb: {climb}.</Text>}
          {names.length > 0 && <Text style={styles.moreText}>Follows {names.join(', ')}.</Text>}
          <Text style={styles.moreText}>{ALWAYS_CAVEAT}</Text>
          {signal && <Text style={styles.moreText}>{SIGNAL_SOURCE}</Text>}
        </View>
      )}
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
            // Time first, as on the route card; "left" says it counts down.
            : `${timeWords(progress.remainingSeconds).replace(/^about /, '')} · ${distanceWords(progress.remainingMeters)} left`}
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
  card: { marginTop: 4 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  label: { flex: 1, color: palette.moss, fontSize: 14, fontWeight: '700', lineHeight: 20 },
  close: {
    width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginRight: -8,
  },
  closeMark: { color: palette.moss, fontSize: 20, fontWeight: '700' },
  numbers: { color: palette.ink, fontSize: 24, fontWeight: '700', lineHeight: 30 },
  text: { color: palette.ink, fontSize: 16, lineHeight: 23, marginTop: 4 },
  hint: { color: palette.moss, fontSize: 15, lineHeight: 22, marginTop: 6 },
  planning: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
  primary: {
    minHeight: 48, justifyContent: 'center',
    backgroundColor: palette.pine, borderRadius: radius.pill, paddingHorizontal: 24, paddingVertical: 11,
  },
  primaryText: { color: palette.paper, fontSize: 16, fontWeight: '700' },
  details: {
    minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: radius.pill, paddingHorizontal: 18, borderWidth: 1.5, borderColor: palette.pine,
  },
  detailsText: { color: palette.pine, fontSize: 16, fontWeight: '700' },
  chevron: { color: palette.pine, fontSize: 14 },
  // Words and a left edge as well as colour (skill §3).
  warn: {
    marginTop: 10, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.control,
    backgroundColor: palette.butter, borderLeftWidth: 4, borderLeftColor: palette.amber,
  },
  warnTitle: { fontWeight: '700' },
  warnText: { color: palette.ink, fontSize: 16, lineHeight: 23 },
  more: { marginTop: 12, gap: 8, borderTopWidth: 1, borderTopColor: palette.sand, paddingTop: 12 },
  moreText: { color: palette.ink, fontSize: 15, lineHeight: 22 },
  // Safety advice before the route, not a warning about it: pine, not amber.
  stay: {
    padding: 12, borderRadius: radius.control, marginBottom: 10,
    backgroundColor: palette.cream, borderLeftWidth: 4, borderLeftColor: palette.pine,
  },
  stayText: { color: palette.ink, fontSize: 16, fontWeight: '700', lineHeight: 22 },
  nav: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10 },
  navText: { flex: 1 },
  navWarn: {
    backgroundColor: palette.butter, borderLeftWidth: 4, borderLeftColor: palette.amber,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, overflow: 'hidden',
  },
  end: {
    minHeight: 48, minWidth: 72, justifyContent: 'center', alignItems: 'center',
    borderRadius: radius.pill, paddingHorizontal: 18, borderWidth: 1.5, borderColor: palette.clay, backgroundColor: palette.paper,
  },
  endText: { color: palette.clay, fontSize: 16, fontWeight: '700' },
});
