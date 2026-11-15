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

export type RouteState =
  | { readonly kind: 'none' }
  | { readonly kind: 'pin'; readonly pin: LngLat }
  | { readonly kind: 'planning'; readonly pin: LngLat }
  | { readonly kind: 'ready'; readonly pin: LngLat; readonly route: Route; readonly stats: PlanStats }
  | { readonly kind: 'failed'; readonly pin: LngLat; readonly reason: PlanFailure };

export interface RouteControls {
  readonly state: RouteState;
  readonly dropPin: (at: LngLat) => void;
  /** Plans from `from` to the pin. */
  readonly plan: (from: { readonly latitude: number; readonly longitude: number }) => void;
  readonly clear: () => void;
}

export function useRoute(): RouteControls {
  const [state, setState] = useState<RouteState>({ kind: 'none' });
  const current = useRef<{ aborted: boolean } | null>(null);

  const cancel = useCallback(() => {
    if (current.current !== null) current.current.aborted = true;
    current.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  const dropPin = useCallback((at: LngLat) => {
    cancel();
    setState({ kind: 'pin', pin: at });
  }, [cancel]);

  const clear = useCallback(() => {
    cancel();
    setState({ kind: 'none' });
  }, [cancel]);

  // The pin as of now, for `plan`; state updates are not the place to start work.
  const pinRef = useRef<LngLat | null>(null);
  pinRef.current = state.kind === 'none' ? null : state.pin;

  const plan = useCallback((from: { readonly latitude: number; readonly longitude: number }) => {
    const pin = pinRef.current;
    if (pin === null) return;
    cancel();
    const signal = { aborted: false };
    current.current = signal;
    setState({ kind: 'planning', pin });
    void (async () => {
      const opened = await openRouteSources();
      if (signal.aborted) { opened?.close(); return; }
      if (opened === null) { setState({ kind: 'failed', pin, reason: 'no-map' }); return; }
      try {
        const res = await planRoute(opened.sources,
          { lat: from.latitude, lon: from.longitude }, { lat: pin[1], lon: pin[0] }, { signal });
        if (signal.aborted) return;
        // One line per route in the log, for speed checks on real phones (#223).
        console.log('[route]', JSON.stringify({ ok: res.ok, ...(res.ok ? { m: Math.round(res.route.meters) } : { reason: res.reason }), ...res.stats }));
        setState(res.ok ? { kind: 'ready', pin, route: res.route, stats: res.stats } : { kind: 'failed', pin, reason: res.reason });
      } catch (e) {
        console.warn('[route] failed', e);
        if (!signal.aborted) setState({ kind: 'failed', pin, reason: 'no-route' });
      } finally {
        opened.close();
        if (current.current === signal) current.current = null;
      }
    })();
  }, [cancel]);

  return { state, dropPin, plan, clear };
}
