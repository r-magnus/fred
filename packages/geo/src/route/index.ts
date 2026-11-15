/**
 * Offline walking routes from the state map archives (#223). Imported as
 * '@fred/geo/route', not re-exported from the package root, so the app only
 * bundles it where the map uses it.
 */
export { planRoute } from './plan.ts';
export type {
  LonLat, PlanFailure, PlanOptions, PlanResult, PlanStats, Route, RouteNote, RouteSources, RouteStretch, TileReader,
} from './plan.ts';
export { lonLatToWorld, worldToLonLat, metersPerUnit } from './tiles.ts';
