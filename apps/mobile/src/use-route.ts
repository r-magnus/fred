/**
 * The route on the map (#223): a dropped pin, and the walking route to it.
 *
 *   none → pin (long-press the map) → planning ("Route here") → ready | failed
 *
 * Dropping a new pin, clearing, or leaving the map cancels a plan in progress;
 * the engine checks the signal every few thousand steps, so a cancel lands in
 * well under a second. Planning starts from the fix at the moment "Route here"
 * is pressed: following the walker as they go is a later step.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { planRoute, type PlanFailure, type PlanStats, type Route } from '@fred/geo/route';
import { openRouteSources } from './route-source.ts';

export type LngLat = readonly [number, number];

/** Why the pin is there: dropped by the hiker, or Fred's suggestion of the nearest signal (#226). */
export type RoutePurpose = 'pin' | 'signal';

export type RouteState =
  | { readonly kind: 'none' }
  | { readonly kind: 'pin'; readonly pin: LngLat; readonly purpose: RoutePurpose }
  | { readonly kind: 'planning'; readonly pin: LngLat; readonly purpose: RoutePurpose }
  | { readonly kind: 'ready'; readonly pin: LngLat; readonly purpose: RoutePurpose; readonly route: Route; readonly stats: PlanStats }
  | { readonly kind: 'failed'; readonly pin: LngLat; readonly purpose: RoutePurpose; readonly reason: PlanFailure };

export interface RouteControls {
  readonly state: RouteState;
  readonly dropPin: (at: LngLat, purpose?: RoutePurpose) => void;
  /** Plans from `from` to the pin. */
  readonly plan: (from: { readonly latitude: number; readonly longitude: number }) => void;
  readonly clear: () => void;
}

export function useRoute(): RouteControls {
  const [state, setState] = useState<RouteState>({ kind: 'none' });
  // The pin as of now, for `plan`: set with the state, so a plan started in
  // the same tick as a drop (the signal suggestion) sees it.
  const pinRef = useRef<{ pin: LngLat; purpose: RoutePurpose } | null>(null);
  const current = useRef<{ aborted: boolean } | null>(null);

  const cancel = useCallback(() => {
    if (current.current !== null) current.current.aborted = true;
    current.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  const dropPin = useCallback((at: LngLat, purpose: RoutePurpose = 'pin') => {
    cancel();
    const s: RouteState = { kind: 'pin', pin: at, purpose };
    pinRef.current = { pin: at, purpose };
    setState(s);
  }, [cancel]);

  const clear = useCallback(() => {
    cancel();
    pinRef.current = null;
    setState({ kind: 'none' });
  }, [cancel]);


  const plan = useCallback((from: { readonly latitude: number; readonly longitude: number }) => {
    if (pinRef.current === null) return;
    const { pin, purpose } = pinRef.current;
    cancel();
    const signal = { aborted: false };
    current.current = signal;
    setState({ kind: 'planning', pin, purpose });
    void (async () => {
      const opened = await openRouteSources();
      if (signal.aborted) { opened?.close(); return; }
      if (opened === null) { setState({ kind: 'failed', pin, purpose, reason: 'no-map' }); return; }
      try {
        const res = await planRoute(opened.sources,
          { lat: from.latitude, lon: from.longitude }, { lat: pin[1], lon: pin[0] }, { signal });
        if (signal.aborted) return;
        // One line per route in the log, for speed checks on real phones (#223).
        console.log('[route]', JSON.stringify({ ok: res.ok, ...(res.ok ? { m: Math.round(res.route.meters) } : { reason: res.reason }), ...res.stats }));
        setState(res.ok ? { kind: 'ready', pin, purpose, route: res.route, stats: res.stats } : { kind: 'failed', pin, purpose, reason: res.reason });
      } catch (e) {
        console.warn('[route] failed', e);
        if (!signal.aborted) setState({ kind: 'failed', pin, purpose, reason: 'no-route' });
      } finally {
        opened.close();
        if (current.current === signal) current.current = null;
      }
    })();
  }, [cancel]);

  return { state, dropPin, plan, clear };
}
