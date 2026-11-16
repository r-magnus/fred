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
import { Animated, BackHandler, Easing, Image, Linking, PanResponder, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { FilterSpecification, StyleSpecification } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { circleRing } from '@fred/geo';
import type { CoveragePack } from '@fred/geo/coverage';
import { loadCoverage, coverageNear, carrierName, type CoverageView } from './coverage-layer.ts';
import { loadCarrier, saveCarrier, forgetCarrier, type CarrierChoice } from './carrier.ts';
import type { LocationFix } from './location.ts';
import { MapDownloads } from './map-downloads-panel.tsx';
import { detailOnPhone, mapArchives, outlinedStates, outlinesOnPhone, whereOnMap, type MapArchive } from './map-files.ts';
import { labelPoint, placeKey, roughKm, type RegionOutline } from './regions.ts';
import { RegionOffer } from './region-offer.tsx';
import { Compass, useHeading, type Heading } from './compass.tsx';
import { CalmLoader } from './calm-loader.tsx';
import { useReduceMotion } from './motion.ts';
import { RouteLayers } from './route-layer.tsx';
import { NavCard, RouteCard } from './route-card.tsx';
import { routeBounds, routeProgress, type RouteProgress } from './route-view.ts';
import { useFollow } from './use-follow.ts';
import { useRoute, type LngLat, type RouteState } from './use-route.ts';
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

/**
 * One map file's layers, named after it. Each file is drawn whole, land first,
 * so a detailed region covers the broader maps under it: its land and its sea
 * are both painted, and nothing of the coarser map shows through.
 */
const stack = (a: MapArchive, c: MapColours): StyleSpecification['layers'] => {
  const src = `m-${a.id}`;
  const id = (name: string): string => `${a.id}-${name}`;
  return [
    { id: id('earth'), type: 'fill', source: src, 'source-layer': 'earth',
      filter: POLYGONS, paint: { 'fill-color': c.land } },
    // Topographic map (docs/results-topo-research.md, option B). Land cover is
    // already in the basemap archive, so it is always drawn; contours come
    // from a separate archive and are drawn when it is present.
    { id: id('landuse'), type: 'fill', source: src, 'source-layer': 'landuse',
      filter: POLYGONS,
      paint: { 'fill-color': ['match', ['get', 'kind'],
        ['forest', 'wood'], c.forest,
        ['meadow', 'grassland', 'scrub'], c.meadow,
        ['bare_rock', 'scree'], c.rock,
        'glacier', c.glacier,
        'wetland', c.wetland,
        c.land] } },
    ...(a.contoursUri === null ? [] : [
      { id: id('contours'), type: 'line', source: `c-${a.id}`, 'source-layer': 'contours',
        paint: {
          'line-color': c.contour,
          'line-opacity': ['case', ['==', ['get', 'idx'], 1], 0.55, 0.26],
          'line-width': ['case', ['==', ['get', 'idx'], 1], 1, 0.5],
        } },
    ] as StyleSpecification['layers']),
    { id: id('water'), type: 'fill', source: src, 'source-layer': 'water',
      filter: POLYGONS, paint: { 'fill-color': c.water } },
    { id: id('waterways'), type: 'line', source: src, 'source-layer': 'water',
      filter: LINES, paint: { 'line-color': c.stream, 'line-width': 1.2 } },
    // Cliffs, from earth's line features. On a topo map they matter as much as
    // contours, so they are drawn dark and a little heavier than a contour.
    { id: id('cliffs'), type: 'line', source: src, 'source-layer': 'earth',
      filter: LINES, paint: { 'line-color': c.cliff, 'line-width': 1.3 } },
    // Roads are white with a soft edge, and widen as the map is zoomed in, so
    // they can't be taken for contour lines. Trails are the dashed ones.
    { id: id('road-edge'), type: 'line', source: src, 'source-layer': 'roads', filter: ROADS,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': c.roadEdge, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.4, 14, 5] } },
    { id: id('roads'), type: 'line', source: src, 'source-layer': 'roads', filter: ROADS,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': c.road, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 14, 3] } },
    { id: id('trails'), type: 'line', source: src, 'source-layer': 'roads', filter: TRAILS,
      paint: { 'line-color': c.trail, 'line-width': 1.5, 'line-dasharray': [2.5, 1.5] } },
  ];
};

/**
 * Every map on the phone at once (#224), broadest first: the country, then
 * whole states, then regions. Two downloaded regions side by side meet with
 * no seam, and where nothing detailed is downloaded the coarser map still
 * shows the roads and towns.
 */
const style = (archives: readonly MapArchive[], c: MapColours): StyleSpecification => ({
  version: 8,
  sources: Object.fromEntries(archives.flatMap((a) => [
    [`m-${a.id}`, { type: 'vector', url: `pmtiles://${a.uri}` }],
    ...(a.contoursUri === null ? [] : [[`c-${a.id}`, { type: 'vector', url: `pmtiles://${a.contoursUri}` }]]),
  ])),
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': c.water } },
    ...archives.flatMap((a) => stack(a, c)),
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

/** Flat [lon, lat, ...] to GeoJSON pairs. */
const pairs = (flat: readonly number[]): [number, number][] => {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i]!, flat[i + 1]!]);
  return out;
};

/** Regions of states with outlines on the phone, which are not downloaded themselves. */
function regionsToOffer(): { readonly place: string; readonly region: RegionOutline }[] {
  const have = detailOnPhone();
  return outlinedStates().flatMap((s) => {
    const o = outlinesOnPhone(s);
    if (o === null || have.has(s)) return [];
    return o.regions.filter((r) => !have.has(placeKey(s, r.id))).map((region) => ({ place: placeKey(s, region.id), region }));
  });
}

/** The map and every overlay: basemap, contours, coverage zones, the user's position. */
function FredMap(
  { fix, coverage, zoom, credit = true, creditBottom = 8, camera, heading, onRegion, route, onLongPress, headingUp = false, onUserMove }: {
    fix: LocationFix | null; coverage: CoverageView | null; zoom: number;
    /** A dropped pin and the walking route to it (#226), drawn under the hiker. */
    route?: RouteState;
    /** Long-press on the map: drops the route pin. */
    onLongPress?: (at: LngLat) => void;
    /**
     * Walking a route (#226): the camera turns the map so the way the phone
     * faces is up, so the hiker's drop points straight up instead of turning.
     */
    headingUp?: boolean;
    /** The hiker moved the map by hand. */
    onUserMove?: () => void;
    /**
     * Given on the full map: regions not on the phone are drawn washed out with
     * a dashed edge and a name tag, and a tap on either offers that region.
     */
    onRegion?: (place: string) => void;
    /** The map-data credit button. The chat preview leaves it to the full map it opens. */
    credit?: boolean;
    /** How far the credit button sits above the bottom edge: clear of the sheet. */
    creditBottom?: number;
    camera?: Ref<CameraRef>;
    /** The phone's heading: with it, the hiker is drawn as a drop pointing the way the phone faces. */
    heading?: Heading;
  },
): React.JSX.Element {
  // Every map on the phone, drawn together (#224). Read once per mount: the
  // full map is remounted after a download or a removal.
  const archives = useMemo(() => mapArchives(), []);
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
    () => (archives.length > 0 ? style(archives, colours) : emptyStyle(colours)),
    [archives, colours]);
  // The regions of downloaded states that are not on the phone themselves.
  const offered = useMemo(() => (onRegion === undefined ? [] : regionsToOffer()), [onRegion === undefined]);
  const offeredShapes = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: offered.flatMap(({ place, region }) => region.rings.map((ring) => ({
      type: 'Feature' as const, properties: { place },
      geometry: { type: 'Polygon' as const, coordinates: [pairs(ring)] },
    }))),
  }), [offered]);

  return (
    <>
      <Map style={styles.map}
        mapStyle={mapStyle}
        // TextureView, not the default GLSurfaceView: on the Nothing Phone (3)
        // the surface drew over the left third of every overlay (2026-09-26).
        androidView="texture"
        attribution={credit} attributionPosition={{ bottom: creditBottom, right: 10 }} logo={false}
        // Fred has its own dial; MapLibre's appeared as a dark disc behind it once the map turned (#226).
        compass={false}
        // North stays up and the map stays flat: the compass dial shows which
        // way the phone points, and a turned map would make it read wrongly.
        touchRotate={false} touchPitch={false}
        onRegionWillChange={onUserMove === undefined ? undefined : (e) => { if (e.nativeEvent.userInteraction) onUserMove(); }}
        onLongPress={onLongPress === undefined ? undefined : (e) => {
          const [lon, lat] = e.nativeEvent.lngLat;
          onLongPress([lon, lat]);
        }}>
        {/* Centre on the user when known; otherwise Yosemite, a public landmark
            packages/geo's tests already use, so no real position is hardcoded. */}
        <Camera ref={camera} initialViewState={{
          center: fix === null ? [-119.5383, 37.8651] : [fix.longitude, fix.latitude],
          // 11 shows the coverage zones around the user (~1.2 km cells, 30 km
          // searched); 13 showed three hexagons and no context.
          zoom: fix === null ? 9 : zoom,
        }} />
        {/* Regions not on the phone, under everything else drawn on top:
            washed out, with a dashed edge, and tappable. */}
        {offered.length > 0 && (
          <GeoJSONSource id="regions-offered" data={offeredShapes}
            onPress={(e) => {
              const place = e.nativeEvent.features[0]?.properties?.place;
              if (typeof place === 'string') onRegion?.(place);
            }}>
            <Layer id="offered-wash" type="fill" paint={{ 'fill-color': colours.cliff, 'fill-opacity': palette.night ? 0.28 : 0.1 }} />
            <Layer id="offered-edge" type="line"
              paint={{ 'line-color': colours.cliff, 'line-width': 1.6, 'line-dasharray': [3, 2] }} />
          </GeoJSONSource>
        )}
        {offered.map(({ place, region }) => (
          <Marker key={place} id={`tag-${place}`} lngLat={labelPoint(region) as [number, number]} onPress={() => onRegion?.(place)}>
            <View collapsable={false} style={styles.tag}>
              <Text style={styles.tagName}>{region.name}</Text>
              <Text style={styles.tagAction}>Tap to download</Text>
            </View>
          </Marker>
        ))}
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
        {route !== undefined && <RouteLayers state={route} night={palette.night} />}
        {/* The accuracy ring is metres wide and vanishes when zoomed out to
            see the coverage zones, so the position also gets a fixed-size dot. */}
        {fix !== null && heading != null && heading.facing !== null && (
          // A drop instead of a dot: the round end is where you stand, the
          // point is the way the phone faces. It turns with the compass dial,
          // the opposite way to the rose.
          <Marker id="me-facing" lngLat={[fix.longitude, fix.latitude]}>
            <Animated.View collapsable={false} style={[styles.facing, heading.unsure && styles.facingUnsure, { transform: [{
              rotate: headingUp ? '0deg' : heading.turn.interpolate({ inputRange: [-360, 360], outputRange: ['360deg', '-360deg'] }),
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
  /** A region being offered for download, e.g. "CA/bay". */
  const [offer, setOffer] = useState<string | null>(null);
  const camera = useRef<CameraRef | null>(null);
  const heading = useHeading();
  // A dropped pin and the walking route to it (#226).
  const route = useRoute();
  // Walking it: the map follows the live position and turns with the phone.
  // `following` drops when the hiker moves the map by hand, until Re-centre.
  const [navigating, setNavigating] = useState(false);
  const [following, setFollowing] = useState(true);
  const live = useFollow(navigating);
  const screen = useWindowDimensions();
  const readyForNav = route.state.kind === 'ready' ? route.state.route : null;
  useEffect(() => { if (readyForNav === null) setNavigating(false); }, [readyForNav]);
  const lastAlong = useRef(0);
  const progress: RouteProgress | null = useMemo(() => {
    if (!navigating || readyForNav === null || live === null) return null;
    const p = routeProgress(readyForNav, live.longitude, live.latitude, lastAlong.current);
    if (p !== null) lastAlong.current = p.along;
    return p;
  }, [navigating, readyForNav, live]);
  // Where to draw the hiker: the live position while walking, else the last fix.
  const shownFix: LocationFix | null = navigating && live !== null && fix !== null
    ? { ...fix, latitude: live.latitude, longitude: live.longitude, accuracyMeters: live.accuracyMeters }
    : fix;
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
  // A new pin opens the sheet, where its card is.
  const dropPin = (at: LngLat): void => {
    route.dropPin(at);
    drop.setValue(0);
    setFolded(false);
  };
  // A finished route is shown whole: from the hiker to the pin, clear of the
  // sheet. Fitted again when the sheet's height settles, because the route
  // card makes the sheet taller in the same render that brings the route, and
  // a fit to the old height hid the start behind it (phone, 2026-11-15).
  const readyRoute = route.state.kind === 'ready' ? route.state.route : null;
  useEffect(() => {
    if (readyRoute === null || navigating) return;
    const b = routeBounds(readyRoute);
    if (b === null) return;
    camera.current?.fitBounds(b, {
      padding: { top: insets.top + 80, right: 50, bottom: sheet + 40, left: 50 }, bearing: 0, pitch: 0, duration: 600,
    });
  }, [readyRoute, sheet, navigating]);
  // The navigation camera: on its own clock rather than on every sensor
  // reading, so the map turns smoothly and the JS thread is not flooded. Close
  // in and tilted a little, the hiker low on the screen with the way ahead
  // above, as navigation apps do.
  const liveRef = useRef(live);
  liveRef.current = live ?? (fix === null ? null : { latitude: fix.latitude, longitude: fix.longitude, accuracyMeters: fix.accuracyMeters });
  useEffect(() => {
    if (!navigating || !following) return;
    let lastBearing = -1;
    let lastKey = '';
    const tick = (): void => {
      const p = liveRef.current;
      if (p === null) return;
      const bearing = heading.degrees.current ?? Math.max(lastBearing, 0);
      const key = `${p.latitude.toFixed(6)},${p.longitude.toFixed(6)}`;
      const turned = Math.abs(((bearing - lastBearing + 540) % 360) - 180);
      if (key === lastKey && turned < 3) return;
      lastKey = key; lastBearing = bearing;
      camera.current?.easeTo({
        center: [p.longitude, p.latitude], bearing, zoom: 16.5, pitch: 40,
        // The hiker about two thirds down the visible map, the way ahead above.
        padding: { top: Math.max(0, (screen.height - sheet) * 0.6), right: 0, bottom: sheet, left: 0 }, duration: 450,
      });
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [navigating, following, sheet, screen.height]);
  const startNav = (): void => { lastAlong.current = 0; setFollowing(true); setNavigating(true); };
  // The fit effect above runs again when this drops, and puts the map back
  // north up and flat with the whole route on screen.
  const endNav = (): void => setNavigating(false);
  // What the map has here: read from disk at every render, which is cheap (a
  // directory listing and a point-in-polygon), so it can never lag behind a
  // download or a removal the way a cached answer did (#224, emulator walk).
  const onMap = whereOnMap(fix);
  useEffect(() => { console.log(`[fred] map here: ${onMap.kind} (files ${files})`); }, [onMap.kind, files]);
  const choose = (id: string | null | 'sim'): void => {
    setPicking(false);
    if (id === 'sim') forgetCarrier(); else saveCarrier(id);
    reloadCarrier();
  };
  const panel = picking || managing || offer !== null;
  // Iteration 4: ask for location only once the hiker knows why. With access
  // already given, the map looks at once, as before; without it, the sheet
  // explains and the system's question comes from "Find where I am". Blocked
  // for good, it offers the Settings page instead of a dead end.
  const [access, setAccess] = useState<'checking' | 'granted' | 'ask' | 'blocked'>('checking');
  const readAccess = (): void => {
    void Location.getForegroundPermissionsAsync().then((p) =>
      setAccess(p.granted ? 'granted' : p.canAskAgain ? 'ask' : 'blocked'));
  };
  useEffect(() => {
    void Location.getForegroundPermissionsAsync().then((p) => {
      setAccess(p.granted ? 'granted' : p.canAskAgain ? 'ask' : 'blocked');
      // A map with no position is no use: look for one as soon as it opens.
      if (p.granted && fix === null && !where.locating) where.locate();
    });
  }, []);
  // After the system's question is answered, and on coming back from Settings.
  const wasLocating = useRef(where.locating);
  useEffect(() => { if (wasLocating.current && !where.locating) readAccess(); wasLocating.current = where.locating; }, [where.locating]);
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
      if (offer !== null) setOffer(null); else if (picking) setPicking(false); else if (managing) setManaging(false);
      else if (navigating) endNav();
      else if (route.state.kind !== 'none') route.clear(); else onClose();
      return true;
    });
    return () => sub.remove();
  }, [offer, picking, managing, onClose, route.state.kind, route.clear, navigating]);
  return (
    <View style={styles.root}>
      <FredMap key={files} fix={shownFix} coverage={coverage} zoom={11} camera={camera} heading={heading} creditBottom={(folded ? peek : sheet) + 8}
        onRegion={setOffer} route={route.state} onLongPress={navigating ? undefined : dropPin}
        // Paused (moved by hand) the map keeps the last bearing it turned to, so
        // the drop still points up, not along the compass on top of the turn.
        headingUp={navigating} onUserMove={navigating ? () => setFollowing(false) : undefined} />

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
              // Walking a route: the target puts the map back on you, turning with the phone.
              if (navigating) { setFollowing(true); return; }
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

      {/* Walking a route and the map was moved by hand: one tap puts it back. */}
      {navigating && !following && !panel && (
        <Pressable style={[styles.recentre, { bottom: (folded ? peek : sheet) + 14 }]} onPress={() => setFollowing(true)}
          accessibilityRole="button" accessibilityLabel="Re-centre the map on you">
          <Text style={styles.recentreText}>Re-centre</Text>
        </Pressable>
      )}

      {!panel && (
        <Animated.View style={[styles.sheet, { paddingBottom: insets.bottom + 12, transform: [{ translateY: drop }] }]}
          onLayout={(e) => setSheet(e.nativeEvent.layout.height)}>
          {/* The handle: the grip and the title under it. */}
          <View {...drag.panHandlers} style={styles.handle}
            accessible accessibilityRole="button" accessibilityState={{ expanded: !folded }}
            accessibilityLabel={folded ? 'Show the map details' : 'Hide the map details'}>
          <View style={styles.grip} />
          {!navigating && (
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
          )}
          </View>
          {/* The rest fades as the sheet is pushed down, so the folded sheet is a clean title. */}
          <Animated.View style={{ opacity: drop.interpolate({ inputRange: [0, 70], outputRange: [1, 0], extrapolate: 'clamp' }) }}>
          {/* With a pin down, the sheet is about the route; the signal and
              settings come back when it is cleared. Keeps the sheet from
              growing over the map (#227). */}
          {navigating ? (
            <NavCard progress={progress} accuracyMeters={live?.accuracyMeters ?? null} onEnd={endNav} />
          ) : route.state.kind !== 'none' ? (
            <RouteCard state={route.state} fix={fix}
              onRoute={() => { if (fix !== null) route.plan(fix); }} onClear={route.clear}
              onStart={fix === null ? undefined : startNav} />
          ) : (<>
          {where.note !== null && (
            <Pressable onPress={where.dismissNote}>
              <Text style={styles.note}>{where.note}</Text>
            </Pressable>
          )}
          {fix === null && !where.locating && access === 'ask' && (
            <>
              <Text style={styles.sheetText}>
                Fred can show where you are, the signal near you, and pick your state&apos;s guide. Your location stays on this phone.
              </Text>
              <Pressable style={styles.getMap} onPress={where.locate} accessibilityRole="button" accessibilityLabel="Find where I am">
                <Text style={styles.getMapText}>Find where I am</Text>
              </Pressable>
            </>
          )}
          {fix === null && !where.locating && access === 'blocked' && (
            <>
              <Text style={styles.sheetText}>
                Location is turned off for Fred. To see where you are on the map, allow it in Settings.
              </Text>
              <Pressable style={styles.getMap} onPress={() => { void Linking.openSettings(); }} accessibilityRole="button" accessibilityLabel="Open Settings">
                <Text style={styles.getMapText}>Open Settings</Text>
              </Pressable>
            </>
          )}
          {fix === null && !where.locating && where.note === null && access === 'granted' && (
            <Text style={styles.sheetText}>Tap the round target button, top right, to find where you are.</Text>
          )}
          {/* The map for where you are isn't on the phone: offer it right here. */}
          {onMap.kind === 'state-missing' && (
            <>
              <Text style={styles.sheetText}>The {onMap.state} map isn&apos;t on this phone yet, so only your position and the signal zones are drawn.</Text>
              <Pressable style={styles.getMap} onPress={() => setManaging(true)} accessibilityRole="button">
                <Text style={styles.getMapText}>Download the {onMap.state} map</Text>
              </Pressable>
            </>
          )}
          {onMap.kind === 'region-missing' && (
            <>
              <Text style={styles.sheetText}>
                You&apos;re in {onMap.region.name}. Its detailed map isn&apos;t on this phone, so only main roads are drawn.
              </Text>
              <Pressable style={styles.getMap} onPress={() => setOffer(placeKey(onMap.state, onMap.region.id))} accessibilityRole="button">
                <Text style={styles.getMapText}>Download {onMap.region.name}</Text>
              </Pressable>
            </>
          )}
          {/* Near the edge of what is downloaded (#224): said before the
              detail runs out, with words and a shape, not colour alone. */}
          {onMap.kind === 'edge' && (
            <View style={styles.edge} accessibilityLiveRegion="polite">
              <Text style={styles.edgeTitle}>Your detailed map ends {roughKm(onMap.edge.km)} from here</Text>
              <Text style={styles.edgeText}>
                Past that line, in {onMap.edge.to.name}, the map shows main roads only. Get it while you have signal.
              </Text>
              <Pressable style={styles.edgeButton} onPress={() => setOffer(placeKey(onMap.state, onMap.edge.to.id))} accessibilityRole="button">
                <Text style={styles.edgeButtonText}>Download {onMap.edge.to.name}</Text>
              </Pressable>
            </View>
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
              <Pressable onPress={() => setPicking(true)} hitSlop={10} style={styles.link} accessibilityRole="button">
                <Text style={styles.linkLabel}>Carrier</Text>
                <Text style={styles.linkValue} numberOfLines={1}>
                  {carrier.id === null ? 'Not set' : carrierName(pack, carrier.id) ?? carrier.id}
                  {carrier.source === 'sim' ? ' (SIM)' : ''}
                </Text>
              </Pressable>
            )}
            <Pressable onPress={() => setManaging(true)} hitSlop={10} style={styles.link} accessibilityRole="button">
              <Text style={styles.linkLabel}>Offline maps</Text>
              <Text style={styles.linkValue}>Download or remove</Text>
            </Pressable>
          </View>
          </>)}
          </Animated.View>
        </Animated.View>
      )}

      {managing && (
        <MapDownloads
          here={fix?.state ?? null}
          at={fix}
          onClose={() => setManaging(false)}
          onChanged={() => { setFiles((n) => n + 1); onPacksChanged(); }}
        />
      )}
      {offer !== null && (
        <RegionOffer place={offer} onClose={() => setOffer(null)}
          onInstalled={() => { setFiles((n) => n + 1); onPacksChanged(); }} />
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
  const onMap = useMemo(() => whereOnMap(fix), [fix]);
  const within = fix === null ? '' : `within ${fix.accuracyMeters === null ? '?' : Math.round(fix.accuracyMeters)} m`;
  const caption = coverage !== null ? coverage.advice
    : fix === null ? 'Finding your location…'
    : onMap.kind === 'state-missing' ? `You are here, ${within}. The ${onMap.state} map isn't on this phone yet.`
    : onMap.kind === 'region-missing' ? `You are here, ${within}. The detailed map of ${onMap.region.name} isn't on this phone yet.`
    : `You are here, ${within}.`;
  // Said in the chat too: someone who asked because they're lost may not open the map.
  const edgeNote = onMap.kind === 'edge'
    ? `Your detailed map ends ${roughKm(onMap.edge.km)} from here; past it, the map shows main roads only.` : null;
  return (
    <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel="Open the map">
      <View style={styles.preview} pointerEvents="none">
        <FredMap fix={fix} coverage={coverage} zoom={12} credit={false} />
      </View>
      {/* #77: left out when Fred's reply above has already said it. */}
      {quiet && coverage !== null ? null : <Text style={styles.previewCaption}>{caption}</Text>}
      {edgeNote !== null && <Text style={styles.previewEdge}>{edgeNote}</Text>}
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
    width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center',
    backgroundColor: palette.paper, borderWidth: 1, borderColor: palette.sand,
    boxShadow: `0 3 12 ${palette.shade}`,
  } as const;
  const land = coloursFor(palette).land;
  return StyleSheet.create({
  preview: { height: 190, borderRadius: radius.control, overflow: 'hidden', backgroundColor: land },
  previewCaption: { color: palette.ink, fontSize: 14, lineHeight: 20, marginTop: 10 },
  previewEdge: { color: palette.ink, fontSize: 14, lineHeight: 20, marginTop: 6 },
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
  wherePillText: { color: palette.ink, fontSize: 13, fontWeight: '700' },
  sheetText: { color: palette.ink, fontSize: 15, lineHeight: 22, marginTop: 10 },
  getMap: {
    alignSelf: 'flex-start', marginTop: 12, minHeight: 48, justifyContent: 'center',
    backgroundColor: palette.pine, borderRadius: radius.pill, paddingHorizontal: 20, paddingVertical: 11,
  },
  getMapText: { color: palette.paper, fontSize: 15, fontWeight: '700' },
  // The edge warning: a block with a heading, so it is not carried by colour alone.
  edge: {
    marginTop: 12, padding: 12, borderRadius: radius.control,
    backgroundColor: palette.butter, borderLeftWidth: 4, borderLeftColor: palette.amber,
  },
  edgeTitle: { color: palette.ink, fontSize: 15, fontWeight: '700', lineHeight: 21 },
  edgeText: { color: palette.ink, fontSize: 14, lineHeight: 20, marginTop: 4 },
  edgeButton: {
    alignSelf: 'flex-start', marginTop: 10, minHeight: 48, justifyContent: 'center',
    borderRadius: radius.pill, paddingHorizontal: 18, borderWidth: 1.5, borderColor: palette.pine, backgroundColor: palette.paper,
  },
  edgeButtonText: { color: palette.pine, fontSize: 15, fontWeight: '700' },
  recentre: {
    position: 'absolute', alignSelf: 'center', minHeight: 48, justifyContent: 'center',
    backgroundColor: palette.paper, borderRadius: radius.pill, paddingHorizontal: 22,
    borderWidth: 1.5, borderColor: palette.pine, boxShadow: `0 2 10 ${palette.shade}`,
  },
  recentreText: { color: palette.pine, fontSize: 15, fontWeight: '700' },
  // A region's name tag on the map: tappable, so it looks like a button (ux-ui-review 7a), and 48 dp tall.
  tag: {
    minHeight: 48, justifyContent: 'center', alignItems: 'center',
    backgroundColor: palette.paper, borderRadius: radius.control, borderWidth: 1.5, borderColor: palette.pine,
    paddingHorizontal: 12, paddingVertical: 6, boxShadow: `0 2 8 ${palette.shade}`,
  },
  tagName: { color: palette.ink, fontSize: 14, fontWeight: '700' },
  tagAction: { color: palette.pine, fontSize: 13, fontWeight: '600', marginTop: 1 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 6, marginTop: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  swatch: { width: 14, height: 14, borderRadius: 4, borderWidth: 1.5 },
  legendText: { color: palette.moss, fontSize: 13 },
  links: { flexDirection: 'row', gap: 10, marginTop: 14, borderTopWidth: 1, borderTopColor: palette.sand, paddingTop: 12 },
  link: { flex: 1, backgroundColor: palette.cream, borderRadius: radius.control, paddingHorizontal: 12, paddingVertical: 9 },
  linkLabel: { color: palette.moss, fontSize: 13 },
  linkValue: { color: palette.pine, fontSize: 14, fontWeight: '700', marginTop: 2 },

  picker: {
    position: 'absolute', left: 16, right: 16,
    backgroundColor: palette.paper, borderRadius: radius.card,
    borderWidth: 1, borderColor: palette.sand, padding: 16,
  },
  pickerTitle: { color: palette.ink, fontSize: 16, fontWeight: '700' },
  pickerHint: { color: palette.moss, fontSize: 13, lineHeight: 19, marginTop: 4, marginBottom: 6 },
  pickerRow: { minHeight: 48, justifyContent: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: palette.sand },
  pickerText: { color: palette.ink, fontSize: 15 },
  pickerSub: { color: palette.pine, fontSize: 14, fontWeight: '600' },
  });
};
