package dev.fred.energy

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Handler
import android.os.HandlerThread
import android.os.PowerManager
import android.os.SystemClock
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The phone's own battery readings, for the estimate shown before a question
 * is sent (US-13, #80, docs/plan-battery-estimate.md).
 *
 * Raw readings only: BATTERY_PROPERTY_CURRENT_NOW exactly as the fuel gauge
 * gives it (the unit and sign differ between makers) and the voltage. The
 * arithmetic is in @fred/rag-core (energy.ts), where it is tested.
 */
class FredEnergyModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private var thread: HandlerThread? = null
  private var handler: Handler? = null
  private val lock = Any()
  private var times = ArrayList<Double>()
  private var currents = ArrayList<Double>()
  private var voltages = ArrayList<Double>()

  private fun manager(): BatteryManager = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager

  private fun sticky(): Intent? = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))

  /** Integer.MIN_VALUE or Long.MIN_VALUE means the phone does not report it. */
  private fun property(id: Int): Double? {
    val v = manager().getLongProperty(id)
    return if (v == Long.MIN_VALUE || v == Int.MIN_VALUE.toLong()) null else v.toDouble()
  }

  private fun sample() {
    val current = property(BatteryManager.BATTERY_PROPERTY_CURRENT_NOW) ?: return
    val mv = sticky()?.getIntExtra(BatteryManager.EXTRA_VOLTAGE, -1) ?: -1
    if (mv <= 0) return
    synchronized(lock) {
      times.add(SystemClock.elapsedRealtime().toDouble())
      currents.add(current)
      voltages.add(mv.toDouble())
    }
  }

  override fun definition() = ModuleDefinition {
    Name("FredEnergy")

    /** The battery now. A missing reading is null, never a guess. */
    Function("read") {
      val intent = sticky()
      val level = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
      val scale = intent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
      val plugged = intent?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0
      val mv = intent?.getIntExtra(BatteryManager.EXTRA_VOLTAGE, -1) ?: -1
      val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      mapOf(
        "platform" to "android",
        "level" to if (level >= 0 && scale > 0) level.toDouble() / scale else null,
        "charging" to (plugged != 0),
        "current" to property(BatteryManager.BATTERY_PROPERTY_CURRENT_NOW),
        "voltageMv" to if (mv > 0) mv.toDouble() else null,
        "chargeMicroAh" to property(BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER),
        "counterJoules" to null,
        "model" to android.os.Build.MODEL,
        "lowPower" to power.isPowerSaveMode,
        "thermal" to if (android.os.Build.VERSION.SDK_INT >= 29) power.currentThermalStatus else null
      )
    }

    /** Start reading current and voltage every `intervalMs` on a thread of its own. */
    Function("start") { intervalMs: Int ->
      synchronized(lock) {
        times = ArrayList(); currents = ArrayList(); voltages = ArrayList()
      }
      thread?.quitSafely()
      val t = HandlerThread("fred-energy").also { it.start() }
      val h = Handler(t.looper)
      thread = t
      handler = h
      val every = intervalMs.coerceIn(50, 5000).toLong()
      h.post(object : Runnable {
        override fun run() {
          sample()
          h.postDelayed(this, every)
        }
      })
    }

    /** Stop, and hand back what was read: times in ms, raw current, millivolts. */
    Function("stop") {
      thread?.quitSafely()
      thread = null
      handler = null
      sample()
      synchronized(lock) {
        mapOf("t" to times.toList(), "current" to currents.toList(), "voltageMv" to voltages.toList(), "counterJoules" to null)
      }
    }

    OnDestroy {
      thread?.quitSafely()
    }
  }
}
