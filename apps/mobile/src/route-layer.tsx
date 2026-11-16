/**
 * The route and its pin, drawn on the map (#223). Children of `<Map>`.
 *
 * Purple for stretches along a mapped path: not blue, which is the hiker's own
 * dot, and not the map's brown dashed trails it runs on top of. Orange and
 * dashed for stretches Fred is unsure of (off trail, guessed joins), the
 * warning colour Ryan asked for. Dashes as well as colour, so the difference
 * survives colour blindness and sunlight. Both lines sit on a pale halo, so
 * they read over forest, rock and water alike.
 */

import { GeoJSONSource, Layer, Marker } from '@maplibre/maplibre-react-native';
import { StyleSheet, View } from 'react-native';
import { routeGeoJSON } from './route-view.ts';
import type { RouteState } from './use-route.ts';

export const ROUTE_COLOURS = {
  day: { sure: '#6A2C91', unsure: '#D96A00', halo: '#FFFFFF', pin: '#A4432B' },
  night: { sure: '#C79BEA', unsure: '#FFA24A', halo: '#16221E', pin: '#F2A48C' },
} as const;

export function RouteLayers({ state, night }: { state: RouteState; night: boolean }): React.JSX.Element | null {
  if (state.kind === 'none') return null;
  const c = night ? ROUTE_COLOURS.night : ROUTE_COLOURS.day;
  const line = state.kind === 'ready' ? routeGeoJSON(state.route) : null;
  return (
    <>
      {line !== null && (
        <GeoJSONSource id="route" data={line as unknown as GeoJSON.FeatureCollection}>
          <Layer id="route-halo" type="line"
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': c.halo, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 5, 15, 10], 'line-opacity': 0.9 }} />
          <Layer id="route-sure" type="line" filter={['==', ['get', 'sure'], true]}
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{ 'line-color': c.sure, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 15, 6] }} />
          <Layer id="route-unsure" type="line" filter={['==', ['get', 'sure'], false]}
            layout={{ 'line-cap': 'butt', 'line-join': 'round' }}
            paint={{ 'line-color': c.unsure, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 3, 15, 6], 'line-dasharray': [1.6, 1.1] }} />
        </GeoJSONSource>
      )}
      {/* A classic map pin (2026-11-16, Ryan): a teardrop standing on its
          point, the point exactly on the spot (anchor "bottom"). Not to be
          taken for the hiker's own drop, which is blue, smaller and turns
          with the compass: this one is clay, bigger, has a hole, and always
          points down. A square with one sharp corner, turned 45° so the
          corner is at the bottom. */}
      <Marker id="route-pin" lngLat={[state.pin[0], state.pin[1]]} anchor="bottom">
        <View style={styles.pin} accessibilityLabel="Route destination" collapsable={false}>
          <View style={[styles.drop, { backgroundColor: c.pin, borderColor: c.halo }]}>
            <View style={[styles.hole, { backgroundColor: c.halo }]} />
          </View>
        </View>
      </Marker>
    </>
  );
}

/**
 * The pin's size. A square of side S turned 45° about its middle: the round
 * part reaches S/2 above the middle, the point S/√2 below it, so the box is
 * S wide and S/2 + S/√2 tall, with the point on its bottom edge.
 */
const S = 30;
const TALL = Math.ceil(S / 2 + S / Math.SQRT2);

const styles = StyleSheet.create({
  pin: { width: S, height: TALL },
  drop: {
    position: 'absolute', left: 0, top: 0, width: S, height: S,
    borderRadius: S / 2, borderBottomRightRadius: 0, borderWidth: 3,
    transform: [{ rotate: '45deg' }], alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 1 3 rgba(0,0,0,0.35)',
  },
  hole: { width: 10, height: 10, borderRadius: 5 },
});
