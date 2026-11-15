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
  ALWAYS_CAVEAT, ROUTE_HEADLINE, climbWords, distanceWords, failureWords, routeWarnings, timeWords, trailNames,
} from './route-view.ts';
import type { RouteState } from './use-route.ts';

export interface RouteCardProps {
  readonly state: RouteState;
  readonly fix: { readonly latitude: number; readonly longitude: number } | null;
  readonly onRoute: () => void;
  readonly onClear: () => void;
}

export function RouteCard({ state, fix, onRoute, onClear }: RouteCardProps): React.JSX.Element | null {
  const { styles } = useThemed(makeStyles);
  if (state.kind === 'none') return null;

  const clear = (label: string) => (
    <Pressable onPress={onClear} hitSlop={10} style={styles.link} accessibilityRole="button">
      <Text style={styles.linkText}>{label}</Text>
    </Pressable>
  );

  if (state.kind === 'pin') {
    const away = fix === null ? null : distanceMeters(fix.latitude, fix.longitude, state.pin[1], state.pin[0]);
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Pin dropped</Text>
        <Text style={styles.text}>
          {away === null ? 'Fred needs to know where you are before it can plan a route.'
            : `${distanceWords(away)} away in a straight line.`}
        </Text>
        <View style={styles.row}>
          <Pressable style={[styles.primary, fix === null && styles.disabled]} disabled={fix === null}
            onPress={onRoute} accessibilityRole="button" accessibilityState={{ disabled: fix === null }}>
            <Text style={styles.primaryText}>Route here</Text>
          </Pressable>
          {clear('Remove pin')}
        </View>
      </View>
    );
  }

  if (state.kind === 'planning') {
    return (
      <View style={styles.card}>
        <View style={styles.planning}>
          <CalmLoader size={26} />
          <Text style={styles.text}>Planning a walking route…</Text>
        </View>
        <View style={styles.row}>{clear('Cancel')}</View>
      </View>
    );
  }

  if (state.kind === 'failed') {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>No route</Text>
        <Text style={styles.text}>{failureWords(state.reason)}</Text>
        <View style={styles.row}>{clear('Remove pin')}</View>
      </View>
    );
  }

  const { route } = state;
  const climb = climbWords(route);
  const names = trailNames(route);
  const warnings = routeWarnings(route);
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{ROUTE_HEADLINE}</Text>
      <Text style={styles.numbers} accessibilityRole="summary">
        {distanceWords(route.meters)} · {timeWords(route.seconds)}
      </Text>
      {climb !== null && <Text style={styles.text}>{climb}</Text>}
      {names.length > 0 && <Text style={styles.text}>Follows {names.join(', ')}.</Text>}
      {warnings.length > 0 && (
        <View style={styles.warn}>
          <Text style={styles.warnTitle}>Take care</Text>
          {warnings.map((w) => <Text key={w} style={styles.warnText}>{w}</Text>)}
        </View>
      )}
      <Text style={styles.caveat}>{ALWAYS_CAVEAT}</Text>
      <View style={styles.row}>{clear('Clear route')}</View>
    </View>
  );
}

const makeStyles = (palette: Palette) => StyleSheet.create({
  card: { marginTop: 12 },
  title: { color: palette.ink, fontSize: 16, fontWeight: '700', lineHeight: 22 },
  numbers: { color: palette.ink, fontSize: 20, fontWeight: '700', marginTop: 6 },
  text: { color: palette.ink, fontSize: 15, lineHeight: 22, marginTop: 6 },
  planning: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 12 },
  primary: {
    minHeight: 48, justifyContent: 'center',
    backgroundColor: palette.pine, borderRadius: radius.pill, paddingHorizontal: 20, paddingVertical: 11,
  },
  disabled: { opacity: 0.45 },
  primaryText: { color: palette.paper, fontSize: 15, fontWeight: '700' },
  link: { minHeight: 48, justifyContent: 'center' },
  linkText: { color: palette.pine, fontSize: 15, fontWeight: '700', textDecorationLine: 'underline' },
  warn: {
    marginTop: 12, padding: 12, borderRadius: radius.control,
    backgroundColor: palette.butter, borderLeftWidth: 4, borderLeftColor: palette.amber,
  },
  warnTitle: { color: palette.ink, fontSize: 15, fontWeight: '700', lineHeight: 21 },
  warnText: { color: palette.ink, fontSize: 14, lineHeight: 20, marginTop: 4 },
  caveat: { color: palette.moss, fontSize: 13, lineHeight: 19, marginTop: 10 },
});
