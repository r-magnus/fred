/**
 * Throwaway probe: does a PMTiles basemap render from local storage, offline?
 *
 * `docs/results-map-research.md` proposes MapLibre reading a Protomaps PMTiles
 * archive off the device, and names one unverified risk: the React Native
 * wrapper's PMTiles path is newer than the native engine's, and had never been
 * run on Fred's build. This answers that and nothing else.
 *
 * Deliberately not a feature. No B-KR2 zone, no B-KR3 overlay, no interaction
 * beyond a close button. If this draws with the radios off, the library and
 * file-format decisions in that document are settled and the real map work can
 * start; if it does not, the fallback is MBTiles.
 */
import { Map, Camera } from '@maplibre/maplibre-react-native';
import { Paths } from 'expo-file-system';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleSpecification } from '@maplibre/maplibre-react-native';

/**
 * Staged by hand for the probe; the real thing ships per-state packs.
 *
 * z14, not the z12 the research settled on. z12 is enough for the +/-1 km the
 * rubric grades, and useless to look at — zooming in shows shapes and no
 * detail. Measured for California: z12 95 MB, z13 250 MB, z14 598 MB, z15
 * 1417 MB. z14 is where trails and forest roads appear, which is the point of
 * carrying a map at all in this product.
 */
const ARCHIVE = 'ca-z14.pmtiles';

/**
 * Minimal style rather than @protomaps/basemaps.
 *
 * Three layers is enough to prove tiles are being read, decoded and drawn, and
 * a hand-written style keeps a second dependency out of a throwaway. Source
 * layer names are Protomaps basemap v4's.
 */
const style = (uri: string): StyleSpecification => ({
  version: 8,
  sources: { proto: { type: 'vector', url: `pmtiles://${uri}` } },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0d1117' } },
    { id: 'earth', type: 'fill', source: 'proto', 'source-layer': 'earth',
      paint: { 'fill-color': '#1d2a22' } },
    { id: 'water', type: 'fill', source: 'proto', 'source-layer': 'water',
      paint: { 'fill-color': '#12303d' } },
    { id: 'roads', type: 'line', source: 'proto', 'source-layer': 'roads',
      paint: { 'line-color': '#4a5d55', 'line-width': 1 } },
  ],
});

export function MapProbe({ onClose }: { onClose: () => void }): React.JSX.Element {
  const uri = `${Paths.document.uri}${ARCHIVE}`;
  return (
    <View style={styles.root}>
      <Map style={styles.map} mapStyle={style(uri)} attribution logo={false}>
        {/* Yosemite: a public landmark already used in packages/geo's tests, so
            the probe does not put anyone's real position in the repo. */}
        <Camera initialViewState={{ center: [-119.5383, 37.8651], zoom: 9 }} />
      </Map>
      <Pressable style={styles.close} onPress={onClose} hitSlop={12}>
        <Text style={styles.closeText}>close probe</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#0d1117' },
  map: { flex: 1 },
  close: {
    position: 'absolute', top: 60, right: 16,
    backgroundColor: '#161b1e', borderRadius: 12,
    borderWidth: 1, borderColor: '#2a3a35',
    paddingHorizontal: 12, paddingVertical: 6,
  },
  closeText: { color: '#6ca', fontSize: 12, fontWeight: '600' },
});
