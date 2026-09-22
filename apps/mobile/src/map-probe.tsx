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
import { Map, Camera, GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import { Paths } from 'expo-file-system';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { StyleSpecification } from '@maplibre/maplibre-react-native';
import { useEffect, useState } from 'react';
import { circleRing } from '@fred/geo';
import { loadCoverage, coverageNear, type CoverageView } from './coverage-layer.ts';
import type { LocationFix } from './location.ts';

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

export function MapProbe(
  { onClose, fix }: { onClose: () => void; fix: LocationFix | null },
): React.JSX.Element {
  const uri = `${Paths.document.uri}${ARCHIVE}`;
  // B-KR2's "estimated location zone". The radius is the GPS's own 68%
  // confidence figure, so the circle is a claim the hardware already makes
  // rather than one invented for the display. Outdoors this is single-digit
  // metres and the ring is tight; indoors it is tens of metres and visibly
  // loose, which is the honest picture rather than a flattering one.
  const ring = fix === null || fix.accuracyMeters === null
    ? [] : circleRing(fix.latitude, fix.longitude, fix.accuracyMeters);

  // B-KR3. Loaded once per screen open rather than per render: the pack is a
  // few kilobytes but the ring search walks outward until it finds something.
  const [coverage, setCoverage] = useState<CoverageView | null>(null);
  useEffect(() => {
    if (fix === null || fix.state === null) return;
    let live = true;
    void loadCoverage(fix.state).then((index) => {
      if (!live || index === null) return;
      setCoverage(coverageNear(fix.latitude, fix.longitude, index));
    });
    return () => { live = false; };
  }, [fix]);
  return (
    <View style={styles.root}>
      <Map style={styles.map} mapStyle={style(uri)} attribution logo={false}>
        {/* Centre on the user when known; otherwise Yosemite, a public landmark
            packages/geo's tests already use, so no real position is hardcoded. */}
        <Camera initialViewState={{
          center: fix === null ? [-119.5383, 37.8651] : [fix.longitude, fix.latitude],
          zoom: fix === null ? 9 : 13,
        }} />
        {coverage !== null && coverage.polygons.length > 0 && (
          <GeoJSONSource
            id="coverage"
            data={{ type: 'Feature', properties: {},
              geometry: { type: 'MultiPolygon',
                coordinates: coverage.polygons.map((p) => [p]) } }}
          >
            {/* Under the location ring in draw order, so the user's own zone
                stays readable on top of the shading. */}
            <Layer id="cov-fill" type="fill"
              paint={{ 'fill-color': '#e8b04f', 'fill-opacity': 0.22 }} />
            <Layer id="cov-edge" type="line"
              paint={{ 'line-color': '#e8b04f', 'line-opacity': 0.5, 'line-width': 1 }} />
          </GeoJSONSource>
        )}
        {ring.length > 0 && (
          <GeoJSONSource
            id="zone"
            data={{ type: 'Feature', properties: {},
              geometry: { type: 'Polygon', coordinates: [ring] } }}
          >
            <Layer id="zone-fill" type="fill"
              paint={{ 'fill-color': '#4fd1a5', 'fill-opacity': 0.18 }} />
            <Layer id="zone-edge" type="line"
              paint={{ 'line-color': '#4fd1a5', 'line-width': 2 }} />
          </GeoJSONSource>
        )}
      </Map>
      {fix !== null && (
        <Text style={styles.zoneNote}>
          {`within ${fix.accuracyMeters === null ? '?' : Math.round(fix.accuracyMeters)} m`}
          {fix.state === null ? '' : ` · ${fix.state}`}
        </Text>
      )}
      {coverage?.advice !== undefined && coverage.advice !== null && (
        <Text style={styles.covNote}>{coverage.advice}</Text>
      )}
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
  covNote: {
    position: 'absolute', bottom: 80, alignSelf: 'center',
    color: '#e8b04f', fontSize: 13, fontWeight: '600', textAlign: 'center',
    backgroundColor: '#0d1117cc', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 6, overflow: 'hidden',
    maxWidth: '86%',
  },
  zoneNote: {
    position: 'absolute', bottom: 40, alignSelf: 'center',
    color: '#4fd1a5', fontSize: 13, fontWeight: '600',
    backgroundColor: '#0d1117cc', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 6, overflow: 'hidden',
  },
});
