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
      <Marker id="route-pin" lngLat={[state.pin[0], state.pin[1]]} anchor="bottom">
        <View style={styles.pin} accessibilityLabel="Route destination" collapsable={false}>
          <View style={[styles.head, { backgroundColor: c.pin, borderColor: c.halo }]} />
          <View style={[styles.stem, { backgroundColor: c.pin }]} />
        </View>
      </Marker>
    </>
  );
}

const styles = StyleSheet.create({
  pin: { alignItems: 'center', width: 28, height: 38 },
  head: { width: 22, height: 22, borderRadius: 11, borderWidth: 3 },
  stem: { width: 3, height: 14, marginTop: -1, borderRadius: 1.5 },
});
