/** Whether the phone's "remove animations" setting is on: moving things then stand still. */
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReduceMotion(): boolean {
  const [still, setStill] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => { if (live) setStill(on); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setStill);
    return () => { live = false; sub.remove(); };
  }, []);
  return still;
}
