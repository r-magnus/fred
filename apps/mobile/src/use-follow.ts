/**
 * Live position while walking a route (#226): a GPS watch that runs only
 * between Start and End, and keeps the screen on meanwhile, as a navigation
 * app does. Outside it the map keeps its one-off fixes, which is what spares
 * the battery the rest of the time (B-KR3).
 */

import { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

export interface LivePosition {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMeters: number | null;
}

const AWAKE = 'route';

export function useFollow(active: boolean): LivePosition | null {
  const [pos, setPos] = useState<LivePosition | null>(null);
  useEffect(() => {
    if (!active) { setPos(null); return; }
    let live = true;
    let sub: Location.LocationSubscription | null = null;
    void activateKeepAwakeAsync(AWAKE).catch(() => {});
    void Location.watchPositionAsync(
      // Every second or 3 m: smooth enough to follow on foot.
      { accuracy: Location.Accuracy.Highest, timeInterval: 1000, distanceInterval: 3 },
      (loc) => {
        if (!live) return;
        setPos({ latitude: loc.coords.latitude, longitude: loc.coords.longitude, accuracyMeters: loc.coords.accuracy ?? null });
      },
    ).then((s) => { if (live) sub = s; else s.remove(); }, () => undefined);
    return () => {
      live = false;
      sub?.remove();
      void deactivateKeepAwake(AWAKE).catch(() => {});
    };
  }, [active]);
  return pos;
}
