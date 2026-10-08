/**
 * Keeps Android's swipe-from-the-edge "back" gesture off a patch of the
 * screen, so the side tab can be pulled (src/side-drawer.tsx). Android only;
 * absent (an old build, the iPhone) it does nothing.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

interface FredEdgeNative {
  /** A patch in window pixels; all zeros hands the edge back. */
  keepFromBackGesture(left: number, top: number, right: number, bottom: number): void;
}

export default requireOptionalNativeModule<FredEdgeNative>('FredEdge');
