/**
 * The map screen. It began as a throwaway probe (does a PMTiles basemap render
 * from local storage, offline? It does: docs/results-map-research.md) and has
 * since grown the B-KR2 location zone, the topographic layers and the B-KR3
 * coverage warnings. The name stayed.
 */
import { Map, Camera, GeoJSONSource, Layer } from '@maplibre/maplibre-react-native';
import { File, Paths } from 'expo-file-system';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { FilterSpecification, StyleSpecification } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useState } from 'react';
import { circleRing } from '@fred/geo';
import type { CoveragePack } from '@fred/geo/coverage';
import { loadCoverage, coverageNear, carrierName } from './coverage-layer.ts';
import { loadCarrier, saveCarrier, forgetCarrier, type CarrierChoice } from './carrier.ts';
import type { LocationFix } from './location.ts';

/**
 * Per state, selected the same way the flora packs are.
 *
 * z14, not the z12 the research settled on. z12 satisfies the +/-1 km the
 * rubric grades and is useless to look at — zooming in shows shapes and no
 * detail. Measured for California: z12 95 MB, z13 250 MB, z14 598 MB, z15
 * 1417 MB. z14 is where trails and forest roads appear, which is the point of
 * carrying a map at all.
 *
 * At ~600 MB per state these cannot all ship at once, unlike coverage at
 * ~7 KB. Whatever fetches them later, the naming and the lookup are the same
 * as `stateForCoords` already drives for packs.
 */
/** Drawn when the state's map is not on the device: overlays still render. */
const EMPTY_STYLE: StyleSpecification = {
  version: 8, sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0d1117' } }],
};

export const mapFile = (state: string): string => `map-${state}-z14.pmtiles`;

/**
 * Minimal style rather than @protomaps/basemaps.
 *
 * Hand-written, and Protomaps basemap v4's source layers are not all one
 * geometry: `water` carries streams and canals as lines and `earth` carries
 * cliffs as lines, alongside their polygons. MapLibre fills a line as
 * straight-edged wedges, so every fill layer below takes polygons only and the
 * lines get line layers of their own. The style spec reports MultiPolygon and
 * MultiLineString as Polygon and LineString, so one name covers each.
 */
const POLYGONS: FilterSpecification = ['==', ['geometry-type'], 'Polygon'];
const LINES: FilterSpecification = ['==', ['geometry-type'], 'LineString'];

const style = (uri: string, contoursUri: string | null): StyleSpecification => ({
  version: 8,
  sources: {
    proto: { type: 'vector', url: `pmtiles://${uri}` },
    ...(contoursUri === null ? {} : {
      contours: { type: 'vector', url: `pmtiles://${contoursUri}` },
    }),
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0d1117' } },
    { id: 'earth', type: 'fill', source: 'proto', 'source-layer': 'earth',
      filter: POLYGONS, paint: { 'fill-color': '#1d2a22' } },
    // Topographic map (docs/results-topo-research.md, option B). Land cover is
    // already in the basemap archive, so it is always drawn; contours come
    // from a separate per-state archive and are drawn when it is present.
    { id: 'landuse', type: 'fill', source: 'proto', 'source-layer': 'landuse',
      filter: POLYGONS,
      paint: { 'fill-color': ['match', ['get', 'kind'],
        ['forest', 'wood'], '#1f3a26',
        ['meadow', 'grassland', 'scrub'], '#2c3b25',
        ['bare_rock', 'scree'], '#34383a',
        'glacier', '#56626a',
        'wetland', '#1c3432',
        '#1d2a22'] } },
    ...(contoursUri === null ? [] : [
      { id: 'contours', type: 'line', source: 'contours', 'source-layer': 'contours',
        paint: {
          'line-color': '#b8a27a',
          'line-opacity': ['case', ['==', ['get', 'idx'], 1], 0.7, 0.35],
          'line-width': ['case', ['==', ['get', 'idx'], 1], 1.2, 0.6],
        } },
    ] as StyleSpecification['layers']),
    { id: 'water', type: 'fill', source: 'proto', 'source-layer': 'water',
      filter: POLYGONS, paint: { 'fill-color': '#12303d' } },
    { id: 'waterways', type: 'line', source: 'proto', 'source-layer': 'water',
      filter: LINES, paint: { 'line-color': '#1f4d61', 'line-width': 1 } },
    // Cliffs, from earth's line features. On a topo map they matter as much as
    // contours, so they are drawn dark and a little heavier than a contour.
    { id: 'cliffs', type: 'line', source: 'proto', 'source-layer': 'earth',
      filter: LINES, paint: { 'line-color': '#0b0f0c', 'line-width': 1.4 } },
    { id: 'roads', type: 'line', source: 'proto', 'source-layer': 'roads',
      paint: { 'line-color': '#4a5d55', 'line-width': 1 } },
  ],
});

export function MapProbe(
  { onClose, fix }: { onClose: () => void; fix: LocationFix | null },
): React.JSX.Element {
  // No state means no map to choose; an absent file means that state has not
  // been downloaded. Both render the terrain-less background rather than
  // failing, because a missing map must not take the location zone with it.
  const archive = fix?.state == null ? null : mapFile(fix.state);
  const haveMap = archive !== null && new File(Paths.document, archive).exists;
  const uri = archive === null ? null : `${Paths.document.uri}${archive}`;
  const contours = fix?.state == null ? null : `contours-${fix.state}.pmtiles`;
  const contoursUri = contours !== null && new File(Paths.document, contours).exists
    ? `${Paths.document.uri}${contours}` : null;
  // B-KR2's "estimated location zone". The radius is the GPS's own 68%
  // confidence figure, so the circle is a claim the hardware already makes
  // rather than one invented for the display. Outdoors this is single-digit
  // metres and the ring is tight; indoors it is tens of metres and visibly
  // loose, which is the honest picture rather than a flattering one.
  const ring = fix === null || fix.accuracyMeters === null
    ? [] : circleRing(fix.latitude, fix.longitude, fix.accuracyMeters);

  // B-KR3 (issue #58): where your carrier reports nothing, and where no
  // carrier does. The pack is loaded once per state; the zones are recomputed
  // only when the position or the carrier changes.
  const [pack, setPack] = useState<CoveragePack | null>(null);
  const [carrier, setCarrier] = useState<CarrierChoice | null>(null);
  const [picking, setPicking] = useState(false);
  const packState = fix?.state ?? null;
  useEffect(() => {
    if (packState === null) return;
    let live = true;
    void loadCoverage(packState).then((p) => { if (live) setPack(p); });
    return () => { live = false; };
  }, [packState]);
  useEffect(() => { void loadCarrier().then(setCarrier); }, []);
  const coverage = useMemo(() =>
    fix === null || fix.state === null || pack === null || carrier === null ? null
      : coverageNear(fix.latitude, fix.longitude, fix.state, pack, carrier.id),
  [fix, pack, carrier]);
  const choose = (id: string | null | 'sim'): void => {
    setPicking(false);
    if (id === 'sim') forgetCarrier(); else saveCarrier(id);
    void loadCarrier().then(setCarrier);
  };
  return (
    <View style={styles.root}>
      <Map style={styles.map}
        mapStyle={haveMap && uri !== null ? style(uri, contoursUri) : EMPTY_STYLE}
        // TextureView, not the default GLSurfaceView: on the Nothing Phone (3)
        // the surface drew over the left third of every overlay (2026-09-26).
        androidView="texture"
        attribution logo={false}>
        {/* Centre on the user when known; otherwise Yosemite, a public landmark
            packages/geo's tests already use, so no real position is hardcoded. */}
        <Camera initialViewState={{
          center: fix === null ? [-119.5383, 37.8651] : [fix.longitude, fix.latitude],
          // 11 shows the coverage zones around the user (~1.2 km cells, 30 km
          // searched); 13 showed three hexagons and no context.
          zoom: fix === null ? 9 : 11,
        }} />
        {/* Under the location ring in draw order, so the user's own zone
            stays readable on top of the shading. Unshaded means assumed
            covered; the two zones never overlap. */}
        {coverage !== null && coverage.carrierGap.length > 0 && (
          <GeoJSONSource
            id="carrier-gap"
            data={{ type: 'Feature', properties: {},
              geometry: { type: 'MultiPolygon', coordinates: coverage.carrierGap } }}
          >
            <Layer id="gap-fill" type="fill"
              paint={{ 'fill-color': GAP, 'fill-opacity': 0.25 }} />
            <Layer id="gap-edge" type="line"
              paint={{ 'line-color': GAP, 'line-opacity': 0.6, 'line-width': 1 }} />
          </GeoJSONSource>
        )}
        {coverage !== null && coverage.noService.length > 0 && (
          <GeoJSONSource
            id="no-service"
            data={{ type: 'Feature', properties: {},
              geometry: { type: 'MultiPolygon', coordinates: coverage.noService } }}
          >
            <Layer id="none-fill" type="fill"
              paint={{ 'fill-color': NONE, 'fill-opacity': 0.35 }} />
            <Layer id="none-edge" type="line"
              paint={{ 'line-color': NONE, 'line-opacity': 0.8, 'line-width': 1.2 }} />
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
        {/* The accuracy ring is metres wide and vanishes when zoomed out to
            see the coverage zones, so the position also gets a fixed-size dot. */}
        {fix !== null && (
          <GeoJSONSource
            id="me"
            data={{ type: 'Feature', properties: {},
              geometry: { type: 'Point', coordinates: [fix.longitude, fix.latitude] } }}
          >
            <Layer id="me-dot" type="circle"
              paint={{ 'circle-radius': 6, 'circle-color': '#4fd1a5',
                'circle-stroke-color': '#0d1117', 'circle-stroke-width': 2 }} />
          </GeoJSONSource>
        )}
      </Map>
      {!haveMap && (
        <Text style={styles.missingNote}>
          {fix?.state == null
            ? 'Location unknown, so no map selected.'
            : `No map downloaded for ${fix.state}.`}
        </Text>
      )}
      {fix !== null && (
        <Text style={styles.zoneNote}>
          {`within ${fix.accuracyMeters === null ? '?' : Math.round(fix.accuracyMeters)} m`}
          {fix.state === null ? '' : ` · ${fix.state}`}
        </Text>
      )}
      {coverage !== null && (
        <View style={styles.covPanel}>
          <Text style={styles.covNote}>{coverage.advice}</Text>
          <View style={styles.legend}>
            {coverage.carrierName !== null && (
              <Text style={styles.legendItem}>
                <Text style={{ color: GAP }}>{'\u25A0 '}</Text>
                {`No ${coverage.carrierName}`}
              </Text>
            )}
            <Text style={styles.legendItem}>
              <Text style={{ color: NONE }}>{'\u25A0 '}</Text>
              No carrier: 911 may fail
            </Text>
          </View>
        </View>
      )}
      {pack !== null && carrier !== null && (
        <Pressable style={styles.carrierChip} onPress={() => setPicking(true)} hitSlop={12}>
          <Text style={styles.carrierText}>
            {carrier.id === null ? 'Carrier: not set' : `Carrier: ${carrierName(pack, carrier.id) ?? carrier.id}`}
            {carrier.source === 'sim' ? ' (SIM)' : ''}
          </Text>
        </Pressable>
      )}
      {picking && pack !== null && (
        <View style={styles.picker}>
          <Text style={styles.pickerTitle}>Your carrier</Text>
          <Text style={styles.pickerHint}>
            Budget carriers use a big network: Mint and Metro use T-Mobile,
            Visible uses Verizon, Cricket uses AT&T.
          </Text>
          {[...pack.carriers].sort((a, b) => b.cells.size - a.cells.size).map((c) => (
            <Pressable key={c.id} onPress={() => choose(c.id)} style={styles.pickerRow}>
              <Text style={styles.pickerText}>{c.name}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => choose(null)} style={styles.pickerRow}>
            <Text style={styles.pickerText}>I don't know</Text>
          </Pressable>
          <Pressable onPress={() => choose('sim')} style={styles.pickerRow}>
            <Text style={styles.pickerSub}>Read it from my SIM</Text>
          </Pressable>
        </View>
      )}
      <Pressable style={styles.close} onPress={onClose} hitSlop={12}>
        <Text style={styles.closeText}>close probe</Text>
      </Pressable>
    </View>
  );
}

/** Your carrier's gaps: amber. No carrier at all: red, the stronger warning. */
const GAP = '#e8a04f';
const NONE = '#e5484d';

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
  missingNote: {
    position: 'absolute', top: 120, alignSelf: 'center',
    color: '#8b9a96', fontSize: 13, textAlign: 'center',
    backgroundColor: '#0d1117cc', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 6, overflow: 'hidden',
  },
  covPanel: {
    position: 'absolute', bottom: 80, alignSelf: 'center', maxWidth: '90%',
    backgroundColor: '#0d1117dd', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  covNote: { color: '#e6edf3', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: 14, marginTop: 6 },
  legendItem: { color: '#8b9a96', fontSize: 12 },
  carrierChip: {
    position: 'absolute', top: 60, left: 16,
    backgroundColor: '#161b1e', borderRadius: 12,
    borderWidth: 1, borderColor: '#2a3a35',
    paddingHorizontal: 12, paddingVertical: 6,
  },
  carrierText: { color: '#6ca', fontSize: 12, fontWeight: '600' },
  picker: {
    position: 'absolute', top: 100, left: 16, right: 16,
    backgroundColor: '#161b1e', borderRadius: 14,
    borderWidth: 1, borderColor: '#2a3a35', padding: 14,
  },
  pickerTitle: { color: '#e6edf3', fontSize: 15, fontWeight: '700' },
  pickerHint: { color: '#8b9a96', fontSize: 12, marginTop: 4, marginBottom: 6 },
  pickerRow: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#22302b' },
  pickerText: { color: '#e6edf3', fontSize: 14 },
  pickerSub: { color: '#6ca', fontSize: 13 },
  zoneNote: {
    position: 'absolute', bottom: 40, alignSelf: 'center',
    color: '#4fd1a5', fontSize: 13, fontWeight: '600',
    backgroundColor: '#0d1117cc', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 6, overflow: 'hidden',
  },
});
