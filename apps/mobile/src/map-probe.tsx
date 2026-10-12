/**
 * The map: full screen, and as a small preview inside the chat.
 *
 * It began as a throwaway probe (does a PMTiles basemap render from local
 * storage, offline? It does: docs/results-map-research.md) and has since grown
 * the location zone, the topographic layers and the B-KR3 coverage warnings.
 * The file name stayed. `FredMap` draws the map and its overlays; `MapScreen`
 * puts it full screen with the carrier picker; `MapPreview` is the tappable
 * thumbnail the chat shows when someone says they are lost (US-05).
 */
import { Map, Camera, GeoJSONSource, Layer, Marker, type CameraRef } from '@maplibre/maplibre-react-native';
import { File, Paths } from 'expo-file-system';
import { Animated, BackHandler, Easing, Image, PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { FilterSpecification, StyleSpecification } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { circleRing } from '@fred/geo';
import type { CoveragePack } from '@fred/geo/coverage';
import { loadCoverage, coverageNear, carrierName, type CoverageView } from './coverage-layer.ts';
import { loadCarrier, saveCarrier, forgetCarrier, type CarrierChoice } from './carrier.ts';
import type { LocationFix } from './location.ts';
import { MapDownloads } from './map-downloads-panel.tsx';
import { Compass, useHeading, type Heading } from './compass.tsx';
import { CalmLoader } from './calm-loader.tsx';
import { useReduceMotion } from './motion.ts';
import { radius, useThemed, type Palette } from './theme.tsx';

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
/**
 * The map's own colours, by day and by night. Coloured the way a paper trail
 * map is, so each thing has one look: land, woods, water, faint contours,
 * roads with an edge, dashed trails. Only the hiker and the signal warnings
 * use strong colour.
 */
interface MapColours {
  readonly land: string; readonly water: string; readonly stream: string;
  readonly forest: string; readonly meadow: string; readonly rock: string; readonly glacier: string; readonly wetland: string;
  readonly contour: string; readonly cliff: string;
  readonly roadEdge: string; readonly road: string; readonly trail: string;
  /** The ring round the hiker's dot. */
  readonly halo: string;
}
const MAP_DAY: MapColours = {
  land: '#F7F1E3', water: '#B8DAEC', stream: '#6FAFD2',
  forest: '#D3E6C8', meadow: '#E7EFCD', rock: '#E7E2D8', glacier: '#F5F9FA', wetland: '#D2E7DF',
  contour: '#B9966A', cliff: '#6E5F4E', roadEdge: '#C9BBA2', road: '#FFFFFF', trail: '#A9593A', halo: '#FFFFFF',
};
const MAP_NIGHT: MapColours = {
  land: '#1C2823', water: '#16303E', stream: '#2F6A86',
  forest: '#213C2A', meadow: '#2B3A27', rock: '#33383A', glacier: '#56626A', wetland: '#1D3634',
  contour: '#B8A27A', cliff: '#0C100D', roadEdge: '#141C19', road: '#5E7068', trail: '#D08A66', halo: '#16221E',
};
const coloursFor = (palette: Palette): MapColours => (palette.night ? MAP_NIGHT : MAP_DAY);

/** Drawn when the state's map is not on the device: overlays still render. */
const emptyStyle = (c: MapColours): StyleSpecification => ({
  version: 8, sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': c.land } }],
});

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
/** The basemap's `roads` layer also carries footpaths, which get their own look. */
const TRAILS: FilterSpecification = ['==', ['get', 'kind'], 'path'];
const ROADS: FilterSpecification = ['in', ['get', 'kind'], ['literal', ['highway', 'major_road', 'minor_road', 'other']]];

const style = (uri: string, contoursUri: string | null, c: MapColours): StyleSpecification => ({
  version: 8,
  sources: {
    proto: { type: 'vector', url: `pmtiles://${uri}` },
    ...(contoursUri === null ? {} : {
      contours: { type: 'vector', url: `pmtiles://${contoursUri}` },
    }),
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': c.water } },
    { id: 'earth', type: 'fill', source: 'proto', 'source-layer': 'earth',
      filter: POLYGONS, paint: { 'fill-color': c.land } },
    // Topographic map (docs/results-topo-research.md, option B). Land cover is
    // already in the basemap archive, so it is always drawn; contours come
    // from a separate per-state archive and are drawn when it is present.
    { id: 'landuse', type: 'fill', source: 'proto', 'source-layer': 'landuse',
      filter: POLYGONS,
      paint: { 'fill-color': ['match', ['get', 'kind'],
        ['forest', 'wood'], c.forest,
        ['meadow', 'grassland', 'scrub'], c.meadow,
        ['bare_rock', 'scree'], c.rock,
        'glacier', c.glacier,
        'wetland', c.wetland,
        c.land] } },
    ...(contoursUri === null ? [] : [
      { id: 'contours', type: 'line', source: 'contours', 'source-layer': 'contours',
        paint: {
          'line-color': c.contour,
          'line-opacity': ['case', ['==', ['get', 'idx'], 1], 0.55, 0.26],
          'line-width': ['case', ['==', ['get', 'idx'], 1], 1, 0.5],
        } },
    ] as StyleSpecification['layers']),
    { id: 'water', type: 'fill', source: 'proto', 'source-layer': 'water',
      filter: POLYGONS, paint: { 'fill-color': c.water } },
    { id: 'waterways', type: 'line', source: 'proto', 'source-layer': 'water',
      filter: LINES, paint: { 'line-color': c.stream, 'line-width': 1.2 } },
    // Cliffs, from earth's line features. On a topo map they matter as much as
    // contours, so they are drawn dark and a little heavier than a contour.
    { id: 'cliffs', type: 'line', source: 'proto', 'source-layer': 'earth',
      filter: LINES, paint: { 'line-color': c.cliff, 'line-width': 1.3 } },
    // Roads are white with a soft edge, and widen as the map is zoomed in, so
    // they can't be taken for contour lines. Trails are the dashed ones.
    { id: 'road-edge', type: 'line', source: 'proto', 'source-layer': 'roads', filter: ROADS,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': c.roadEdge, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.4, 14, 5] } },
    { id: 'roads', type: 'line', source: 'proto', 'source-layer': 'roads', filter: ROADS,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': c.road, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 14, 3] } },
    { id: 'trails', type: 'line', source: 'proto', 'source-layer': 'roads', filter: TRAILS,
      paint: { 'line-color': c.trail, 'line-width': 1.5, 'line-dasharray': [2.5, 1.5] } },
  ],
});

/**
 * The state's coverage pack, the chosen carrier, and the zones near the user.
 * The pack is loaded once per state; the zones are recomputed only when the
 * position or the carrier changes (B-KR3, issue #58).
 */
function useCoverage(fix: LocationFix | null, reload = 0) {
  const [pack, setPack] = useState<CoveragePack | null>(null);
  const [carrier, setCarrier] = useState<CarrierChoice | null>(null);
  const packState = fix?.state ?? null;
  useEffect(() => {
    if (packState === null) return;
    let live = true;
    void loadCoverage(packState).then((p) => { if (live) setPack(p); });
    return () => { live = false; };
  }, [packState, reload]);
  useEffect(() => { void loadCarrier().then(setCarrier); }, []);
  const coverage = useMemo(() =>
    fix === null || fix.state === null || pack === null || carrier === null ? null
      : coverageNear(fix.latitude, fix.longitude, fix.state, pack, carrier.id),
  [fix, pack, carrier]);
  const reloadCarrier = (): void => { void loadCarrier().then(setCarrier); };
  return { pack, carrier, coverage, reloadCarrier };
}

/**
 * The dots after "Finding you": one, two, three, and round again, so the wait
 * visibly moves. All three are always laid out and the ones not yet lit are
 * clear, so the words beside them stay put. Three still dots when the phone
 * has animations turned off.
 */
function Dots(): React.JSX.Element {
  const { styles } = useThemed(makeStyles);
  const still = useReduceMotion();
  const [lit, setLit] = useState(1);
  useEffect(() => {
    if (still) return;
    const t = setInterval(() => setLit((n) => (n % 3) + 1), 450);
    return () => clearInterval(t);
  }, [still]);
  return (
    <>
      {[1, 2, 3].map((n) => <Text key={n} style={!still && n > lit ? styles.dotOff : undefined}>.</Text>)}
    </>
  );
}

/** The map and every overlay: basemap, contours, coverage zones, the user's position. */
function FredMap(
  { fix, coverage, zoom, credit = true, creditBottom = 8, camera, heading }: {
    fix: LocationFix | null; coverage: CoverageView | null; zoom: number;
    /** The map-data credit button. The chat preview leaves it to the full map it opens. */
    credit?: boolean;
    /** How far the credit button sits above the bottom edge: clear of the sheet. */
    creditBottom?: number;
    camera?: Ref<CameraRef>;
    /** The phone's heading: with it, the hiker is drawn as a drop pointing the way the phone faces. */
    heading?: Heading;
  },
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
  const { palette, styles } = useThemed(makeStyles);
  const colours = coloursFor(palette);
  // Built once per map and colour set: a new style object makes the map reload.
  const mapStyle = useMemo(
    () => (haveMap && uri !== null ? style(uri, contoursUri, colours) : emptyStyle(colours)),
    [haveMap, uri, contoursUri, colours]);

  return (
    <>
      <Map style={styles.map}
        mapStyle={mapStyle}
        // TextureView, not the default GLSurfaceView: on the Nothing Phone (3)
        // the surface drew over the left third of every overlay (2026-09-26).
        androidView="texture"
        attribution={credit} attributionPosition={{ bottom: creditBottom, right: 10 }} logo={false}
        // North stays up and the map stays flat: the compass dial shows which
        // way the phone points, and a turned map would make it read wrongly.
        touchRotate={false} touchPitch={false}>
        {/* Centre on the user when known; otherwise Yosemite, a public landmark
            packages/geo's tests already use, so no real position is hardcoded. */}
        <Camera ref={camera} initialViewState={{
          center: fix === null ? [-119.5383, 37.8651] : [fix.longitude, fix.latitude],
          // 11 shows the coverage zones around the user (~1.2 km cells, 30 km
          // searched); 13 showed three hexagons and no context.
          zoom: fix === null ? 9 : zoom,
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
              paint={{ 'fill-color': GAP, 'fill-opacity': 0.2 }} />
            <Layer id="gap-edge" type="line"
              paint={{ 'line-color': GAP, 'line-width': 1.8 }} />
          </GeoJSONSource>
        )}
        {coverage !== null && coverage.noService.length > 0 && (
          <GeoJSONSource
            id="no-service"
            data={{ type: 'Feature', properties: {},
              geometry: { type: 'MultiPolygon', coordinates: coverage.noService } }}
          >
            <Layer id="none-fill" type="fill"
              paint={{ 'fill-color': NONE, 'fill-opacity': 0.26 }} />
            <Layer id="none-edge" type="line"
              paint={{ 'line-color': NONE, 'line-width': 2 }} />
          </GeoJSONSource>
        )}
        {ring.length > 0 && (
          <GeoJSONSource
            id="zone"
            data={{ type: 'Feature', properties: {},
              geometry: { type: 'Polygon', coordinates: [ring] } }}
          >
            <Layer id="zone-fill" type="fill"
              paint={{ 'fill-color': ME, 'fill-opacity': 0.16 }} />
            <Layer id="zone-edge" type="line"
              paint={{ 'line-color': ME, 'line-width': 2 }} />
          </GeoJSONSource>
        )}
        {/* The accuracy ring is metres wide and vanishes when zoomed out to
            see the coverage zones, so the position also gets a fixed-size dot. */}
        {fix !== null && heading != null && heading.facing !== null && (
          // A drop instead of a dot: the round end is where you stand, the
          // point is the way the phone faces. It turns with the compass dial,
          // the opposite way to the rose.
          <Marker id="me-facing" lngLat={[fix.longitude, fix.latitude]}>
            <Animated.View collapsable={false} style={[styles.facing, heading.unsure && styles.facingUnsure, { transform: [{
              rotate: heading.turn.interpolate({ inputRange: [-360, 360], outputRange: ['360deg', '-360deg'] }),
            }] }]}>
              <View style={[styles.drop, { borderColor: colours.halo }]} />
            </Animated.View>
          </Marker>
        )}
        {/* Until the compass has a reading, and in the chat's small map: a plain dot. */}
        {fix !== null && (heading == null || heading.facing === null) && (
          <GeoJSONSource
            id="me"
            data={{ type: 'Feature', properties: {},
              geometry: { type: 'Point', coordinates: [fix.longitude, fix.latitude] } }}
          >
            <Layer id="me-dot" type="circle"
              paint={{ 'circle-radius': 7, 'circle-color': ME,
                'circle-stroke-color': colours.halo, 'circle-stroke-width': 3 }} />
          </GeoJSONSource>
        )}
      </Map>
    </>
  );
}

export function MapScreen(
  { onClose, fix, onPacksChanged, where }: {
    onClose: () => void; fix: LocationFix | null; onPacksChanged: () => void;
    /** The location button's state and actions, which live with the chat screen. */
    where: {
      readonly locating: boolean;
      /** The accuracy so far while a fix is being taken, in metres. */
      readonly progress: number | null;
      readonly note: string | null;
      readonly recording: boolean;
      readonly locate: () => void;
      readonly dismissNote: () => void;
      /** Long-press: the drive-test recording (src/location.ts). */
      readonly toggleRecording: () => void;
    };
  },
): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { styles } = useThemed(makeStyles);
  // Bumped after a download or removal, so the map and coverage re-read the disk.
  const [files, setFiles] = useState(0);
  const { pack, carrier, coverage, reloadCarrier } = useCoverage(fix, files);
  const [picking, setPicking] = useState(false);
  const [managing, setManaging] = useState(false);
  const camera = useRef<CameraRef | null>(null);
  const heading = useHeading();
  // The sheet's height, so the map's credit button can sit just above it.
  const [sheet, setSheet] = useState(0);
  // The sheet folds down to its title, to give the map the screen: drag its
  // top edge, or tap it. `drop` is how far down it has been pushed.
  const [folded, setFolded] = useState(false);
  const drop = useRef(new Animated.Value(0)).current;
  const peek = 66 + insets.bottom;
  const fold = useRef({ max: 0, folded });
  fold.current = { max: Math.max(0, sheet - peek), folded };
  // Its height changes as the signal advice arrives; a folded sheet stays folded.
  useEffect(() => { drop.setValue(folded ? fold.current.max : 0); }, [sheet]);
  const drag = useMemo(() => {
    let from = 0;
    const rest = (down: boolean): void => {
      Animated.timing(drop, {
        toValue: down ? fold.current.max : 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }).start();
      setFolded(down);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => { drop.stopAnimation(); from = fold.current.folded ? fold.current.max : 0; },
      onPanResponderMove: (_, g) => drop.setValue(Math.max(0, Math.min(fold.current.max, from + g.dy))),
      onPanResponderRelease: (_, g) => {
        if (Math.hypot(g.dx, g.dy) < 8) { rest(!fold.current.folded); return; }
        // Where it would come to rest, allowing for a flick.
        rest(from + g.dy + g.vy * 140 > fold.current.max / 2);
      },
      onPanResponderTerminate: () => rest(fold.current.folded),
    });
  }, [drop]);
  const haveMap = fix?.state == null ? true : new File(Paths.document, mapFile(fix.state)).exists;
  const choose = (id: string | null | 'sim'): void => {
    setPicking(false);
    if (id === 'sim') forgetCarrier(); else saveCarrier(id);
    reloadCarrier();
  };
  const panel = picking || managing;
  // A map with no position is no use: look for one as soon as it opens.
  useEffect(() => { if (fix === null && !where.locating) where.locate(); }, []);
  // The map follows a new position. It drew the one it opened with itself;
  // opened with none, it starts far out and has to be brought in to the first.
  const seen = useRef(fix === null ? 'none' : 'drawn');
  useEffect(() => {
    if (fix === null) return;
    if (seen.current !== 'drawn') {
      camera.current?.easeTo({
        center: [fix.longitude, fix.latitude], duration: 600, ...(seen.current === 'none' ? { zoom: 11 } : {}),
      });
    }
    seen.current = 'moved';
  }, [fix?.latitude, fix?.longitude]);
  // The phone's back button closes whatever is on top: a panel, then the map.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (picking) setPicking(false); else if (managing) setManaging(false); else onClose();
      return true;
    });
    return () => sub.remove();
  }, [picking, managing, onClose]);
  return (
    <View style={styles.root}>
      <FredMap key={files} fix={fix} coverage={coverage} zoom={11} camera={camera} heading={heading} creditBottom={(folded ? peek : sheet) + 8} />

      {/* Three round controls and one sheet: everything else that used to
          float over the map is written on the sheet. */}
      <Pressable style={[styles.round, { top: insets.top + 10, left: 14 }]} onPress={onClose} hitSlop={10}
        accessibilityRole="button" accessibilityLabel="Back to chat">
        <Image source={ARROW} resizeMode="contain" style={styles.backMark} />
      </Pressable>
      {!panel && (
        <View style={[styles.corner, { top: insets.top + 10 }]}>
          <Compass heading={heading} />
          {/* The location button: a target. Tap for a fresh position, which
              the map then centres on. Long-press arms the drive-test recording
              (it writes coordinates to disk, so it is not a visible control),
              and the button turns red while that runs. */}
          <Pressable style={[styles.roundInline, where.recording && styles.roundRecording]} hitSlop={10}
            disabled={where.locating}
            onPress={() => {
              if (fix !== null) camera.current?.easeTo({ center: [fix.longitude, fix.latitude], zoom: 12, duration: 600 });
              where.locate();
            }}
            onLongPress={where.toggleRecording}
            accessibilityRole="button"
            accessibilityLabel={where.locating ? 'Finding your location' : where.recording ? 'Find my location. Recording a track.' : 'Find my location'}>
            {where.locating ? <CalmLoader size={24} />
              : <View style={[styles.target, where.recording && styles.targetRecording]}>
                  <View style={[styles.targetDot, where.recording && styles.targetDotRecording]} />
                </View>}
          </Pressable>
        </View>
      )}

      {!panel && (
        <Animated.View style={[styles.sheet, { paddingBottom: insets.bottom + 12, transform: [{ translateY: drop }] }]}
          onLayout={(e) => setSheet(e.nativeEvent.layout.height)}>
          {/* The handle: the grip and the title under it. */}
          <View {...drag.panHandlers} style={styles.handle}
            accessible accessibilityRole="button" accessibilityState={{ expanded: !folded }}
            accessibilityLabel={folded ? 'Show the map details' : 'Hide the map details'}>
          <View style={styles.grip} />
          <View style={styles.where}>
            <Text style={[styles.whereTitle, where.locating && styles.whereTitleBusy]}
              accessibilityLabel={where.locating ? 'Finding you' : undefined}>
              {where.locating ? <>Finding you<Dots /></> : fix === null ? 'Where are you?' : 'You are here'}
            </Text>
            {(fix !== null || where.progress !== null) && (
              <View style={styles.wherePill}>
                <View style={styles.meDot} />
                <Text style={styles.wherePillText}>
                  {where.locating && where.progress !== null ? `±${Math.round(where.progress)} m so far`
                    : fix === null ? '' : `within ${fix.accuracyMeters === null ? '?' : Math.round(fix.accuracyMeters)} m`
                      + `${fix.state === null ? '' : ` · ${fix.state}`}`}
                </Text>
              </View>
            )}
          </View>
          </View>
          {/* The rest fades as the sheet is pushed down, so the folded sheet is a clean title. */}
          <Animated.View style={{ opacity: drop.interpolate({ inputRange: [0, 70], outputRange: [1, 0], extrapolate: 'clamp' }) }}>
          {where.note !== null && (
            <Pressable onPress={where.dismissNote}>
              <Text style={styles.note}>{where.note}</Text>
            </Pressable>
          )}
          {fix === null && !where.locating && where.note === null && (
            <Text style={styles.sheetText}>Tap the round target button, top right, to find where you are.</Text>
          )}
          {/* The map for where you are isn't on the phone: offer it right here. */}
          {!haveMap && (
            <>
              <Text style={styles.sheetText}>The {fix?.state} map isn&apos;t on this phone yet, so only your position and the signal zones are drawn.</Text>
              <Pressable style={styles.getMap} onPress={() => setManaging(true)}>
                <Text style={styles.getMapText}>Download the {fix?.state} map</Text>
              </Pressable>
            </>
          )}
          {coverage !== null && (
            <>
              <Text style={styles.sheetText}>{coverage.advice}</Text>
              <View style={styles.legend}>
                {coverage.carrierName !== null && (
                  <View style={styles.legendItem}>
                    <View style={[styles.swatch, { backgroundColor: `${GAP}55`, borderColor: GAP }]} />
                    <Text style={styles.legendText}>{`No ${coverage.carrierName}`}</Text>
                  </View>
                )}
                <View style={styles.legendItem}>
                  <View style={[styles.swatch, { backgroundColor: `${NONE}55`, borderColor: NONE }]} />
                  <Text style={styles.legendText}>No carrier: 911 may fail</Text>
                </View>
              </View>
            </>
          )}
          <View style={styles.links}>
            {pack !== null && carrier !== null && (
              <Pressable onPress={() => setPicking(true)} hitSlop={10} style={styles.link}>
                <Text style={styles.linkLabel}>Carrier</Text>
                <Text style={styles.linkValue} numberOfLines={1}>
                  {carrier.id === null ? 'Not set' : carrierName(pack, carrier.id) ?? carrier.id}
                  {carrier.source === 'sim' ? ' (SIM)' : ''}
                </Text>
              </Pressable>
            )}
            <Pressable onPress={() => setManaging(true)} hitSlop={10} style={styles.link}>
              <Text style={styles.linkLabel}>Offline maps</Text>
              <Text style={styles.linkValue}>Download or remove</Text>
            </Pressable>
          </View>
          </Animated.View>
        </Animated.View>
      )}

      {managing && (
        <MapDownloads
          here={fix?.state ?? null}
          onClose={() => setManaging(false)}
          onChanged={() => { setFiles((n) => n + 1); onPacksChanged(); }}
        />
      )}
      {picking && pack !== null && (
        <View style={[styles.picker, { top: insets.top + 70 }]}>
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
    </View>
  );
}

/**
 * The map inside a chat reply. Tapping anywhere on it opens `MapScreen`: the
 * preview itself takes no gestures, so scrolling the chat never pans the map.
 */
export function MapPreview(
  { fix, onOpen, quiet = false }: { fix: LocationFix | null; onOpen: () => void; quiet?: boolean },
): React.JSX.Element {
  const { styles } = useThemed(makeStyles);
  const { coverage } = useCoverage(fix);
  const caption = coverage !== null ? coverage.advice
    : fix === null ? 'Finding your location…'
    : fix.state !== null && !new File(Paths.document, mapFile(fix.state)).exists
      ? `You are here, within ${fix.accuracyMeters === null ? '?' : Math.round(fix.accuracyMeters)} m. The ${fix.state} map isn't on this phone yet.`
    : `You are here, within ${fix.accuracyMeters === null ? '?' : Math.round(fix.accuracyMeters)} m.`;
  return (
    <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel="Open the map">
      <View style={styles.preview} pointerEvents="none">
        <FredMap fix={fix} coverage={coverage} zoom={12} credit={false} />
      </View>
      {/* #77: left out when Fred's reply above has already said it. */}
      {quiet && coverage !== null ? null : <Text style={styles.previewCaption}>{caption}</Text>}
      <Text style={styles.previewOpen}>Tap to open the map</Text>
    </Pressable>
  );
}

/** Your carrier's gaps: amber. No carrier at all: red, the stronger warning. */
const GAP = '#E0892B';
const NONE = '#D8423F';
/** The hiker: the one blue on the map, so it is never taken for woods or water. */
const ME = '#2F7BD6';
const ARROW = require('../assets/ui/arrow-up.png');
const JOURNAL = Platform.select({ ios: 'Georgia', default: 'serif' });

const makeStyles = (palette: Palette) => {
  const round = {
    width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.paper, borderWidth: 1, borderColor: palette.sand,
    boxShadow: `0 3 12 ${palette.shade}`,
  } as const;
  const land = coloursFor(palette).land;
  return StyleSheet.create({
  preview: { height: 190, borderRadius: radius.control, overflow: 'hidden', backgroundColor: land },
  previewCaption: { color: palette.ink, fontSize: 14, lineHeight: 20, marginTop: 10 },
  previewOpen: { color: palette.pine, fontSize: 13, fontWeight: '700', marginTop: 4 },
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: land },
  map: { flex: 1 },
  // The hiker's marker: a box that turns about its middle, holding a square
  // with one sharp corner, stood on its point so the corner leads.
  facing: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  facingUnsure: { opacity: 0.85 },
  drop: {
    width: 26, height: 26, borderRadius: 13, borderTopLeftRadius: 2, borderWidth: 3,
    backgroundColor: ME, transform: [{ rotate: '45deg' }],
  },

  round: { position: 'absolute', ...round },
  roundInline: round,
  roundRecording: { backgroundColor: palette.clay, borderColor: palette.clay },
  targetRecording: { borderColor: palette.paper },
  targetDotRecording: { backgroundColor: palette.paper },
  note: {
    color: palette.amber, backgroundColor: palette.butter, fontSize: 13, lineHeight: 18,
    borderRadius: radius.control, paddingHorizontal: 12, paddingVertical: 8, marginTop: 10, overflow: 'hidden',
  },
  backMark: { width: 22, height: 22, tintColor: palette.pine, transform: [{ rotate: '-90deg' }] },
  corner: { position: 'absolute', right: 14, alignItems: 'center', gap: 12 },
  target: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: ME,
    alignItems: 'center', justifyContent: 'center',
  },
  targetDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: ME },

  // The one sheet at the foot of the map: where you are, what the signal is
  // doing, and the two settings.
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: palette.paper, borderTopLeftRadius: 26, borderTopRightRadius: 26,
    paddingHorizontal: 20,
    boxShadow: `0 -4 18 ${palette.shade}`,
  },
  // Reaches the sheet's edges, so the whole top strip takes the drag.
  handle: { marginHorizontal: -20, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 4 },
  grip: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: palette.trail, marginBottom: 12 },
  where: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  whereTitle: { fontFamily: JOURNAL, color: palette.ink, fontSize: 22 },
  whereTitleBusy: { color: palette.pine, fontSize: 26 },
  // Not 'transparent': inside a line of text Android drew a fully clear dot in the title's colour.
  dotOff: { color: 'rgba(0, 0, 0, 0.01)' },
  wherePill: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: palette.oat, borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 5,
  },
  meDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: ME, borderWidth: 2, borderColor: palette.paper },
  wherePillText: { color: palette.ink, fontSize: 12, fontWeight: '700' },
  sheetText: { color: palette.ink, fontSize: 15, lineHeight: 22, marginTop: 10 },
  getMap: {
    alignSelf: 'flex-start', marginTop: 12,
    backgroundColor: palette.pine, borderRadius: radius.pill, paddingHorizontal: 18, paddingVertical: 11,
  },
  getMapText: { color: palette.paper, fontSize: 14, fontWeight: '700' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 6, marginTop: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  swatch: { width: 14, height: 14, borderRadius: 4, borderWidth: 1.5 },
  legendText: { color: palette.moss, fontSize: 12 },
  links: { flexDirection: 'row', gap: 10, marginTop: 14, borderTopWidth: 1, borderTopColor: palette.sand, paddingTop: 12 },
  link: { flex: 1, backgroundColor: palette.cream, borderRadius: radius.control, paddingHorizontal: 12, paddingVertical: 9 },
  linkLabel: { color: palette.moss, fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  linkValue: { color: palette.pine, fontSize: 14, fontWeight: '700', marginTop: 2 },

  picker: {
    position: 'absolute', left: 16, right: 16,
    backgroundColor: palette.paper, borderRadius: radius.card,
    borderWidth: 1, borderColor: palette.sand, padding: 16,
  },
  pickerTitle: { color: palette.ink, fontSize: 16, fontWeight: '700' },
  pickerHint: { color: palette.moss, fontSize: 12, lineHeight: 17, marginTop: 4, marginBottom: 6 },
  pickerRow: { paddingVertical: 12, borderTopWidth: 1, borderTopColor: palette.sand },
  pickerText: { color: palette.ink, fontSize: 15 },
  pickerSub: { color: palette.pine, fontSize: 14, fontWeight: '600' },
  });
};
