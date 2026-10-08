package dev.fred.edge

import android.graphics.Rect
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Keeps Android's swipe-from-the-edge "back" gesture off one patch of the
 * screen: the side tab, which sits on the left edge and can be pulled out
 * (src/side-drawer.tsx). Without this a pull that starts on the tab is taken
 * by the system as "back" and closes the app.
 *
 * Android allows an app up to 200 dp of each edge; the tab uses about 75.
 * Android 10 and later; older phones have no edge gesture to keep away.
 */
class FredEdgeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FredEdge")

    /** The patch in window pixels; all zeros gives the whole edge back to the system. */
    Function("keepFromBackGesture") { left: Int, top: Int, right: Int, bottom: Int ->
      val activity = appContext.currentActivity ?: return@Function
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return@Function
      activity.runOnUiThread {
        val view = activity.window.decorView
        view.systemGestureExclusionRects =
          if (right > left && bottom > top) listOf(Rect(left, top, right, bottom)) else emptyList()
      }
    }
  }
}
