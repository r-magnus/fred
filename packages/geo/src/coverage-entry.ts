/**
 * '@fred/geo/coverage' — B-KR3, kept off the app's import path.
 *
 * Separate from index.ts because that barrel is what apps/mobile imports for
 * stateForCoords and the fix-selection rule, and coverage depends on h3-js.
 * Re-exporting it from the barrel put h3-js into the phone's JS bundle and the
 * app stopped launching — no crash log, just an immediate exit.
 */
export {
  COVERAGE_RES, toCoverageIndex, nearestCoverage, describeBearing,
  type CoverageIndex, type NearestCoverage,
} from './coverage.ts';
export { encodeCells, decodeCells } from './coverage-codec.ts';
