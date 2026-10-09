import Darwin
import ExpoModulesCore
import UIKit

/**
 The iPhone's own energy readings, for the estimate shown before a question is
 sent (US-13, #80, docs/plan-battery-estimate.md).

 NOT YET RUN ON A DEVICE: built and read in the simulator on 2026-10-09, where
 the counter is the Mac's. To be tested when Fred runs on a real iPhone (#28).

 An iPhone app cannot read battery current. What it can read is the kernel's
 energy counter for its own processor work: task_info(TASK_POWER_INFO_V2),
 field task_energy, in nanojoules on Apple chips. It is in the public part of
 the kernel's headers but undocumented; Apple's developer support says only to
 compare runs on the same hardware. A reading of zero, or a failed call, is
 reported as nil and the app falls back to time (energy.ts).
 */
public class FredEnergyModule: Module {
  private var startedEnergy: UInt64?

  /** TASK_POWER_INFO_V2 (mach/task_info.h). Swift does not import the flavor or the struct. */
  private static let flavor: task_flavor_t = 26

  /** struct task_power_info_v2, field by field: 6 + 4 + 3 fields of 64 bits. */
  private struct PowerInfoV2 {
    var totalUser: UInt64 = 0
    var totalSystem: UInt64 = 0
    var interruptWakeups: UInt64 = 0
    var platformIdleWakeups: UInt64 = 0
    var timerWakeupsBin1: UInt64 = 0
    var timerWakeupsBin2: UInt64 = 0
    var gpuUtilisation: UInt64 = 0
    var gpuReserved0: UInt64 = 0
    var gpuReserved1: UInt64 = 0
    var gpuReserved2: UInt64 = 0
    var taskEnergy: UInt64 = 0
    var taskPtime: UInt64 = 0
    var taskPsetSwitches: UInt64 = 0
  }

  /** The app's own processor energy so far, in nanojoules; nil when the kernel gives none. */
  private static func taskEnergy() -> UInt64? {
    var info = PowerInfoV2()
    var count = mach_msg_type_number_t(MemoryLayout<PowerInfoV2>.size / MemoryLayout<natural_t>.size)
    let kr = withUnsafeMutablePointer(to: &info) { p in
      p.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
        task_info(mach_task_self_, flavor, $0, &count)
      }
    }
    return kr == KERN_SUCCESS && info.taskEnergy > 0 ? info.taskEnergy : nil
  }

  /** "iPhone17,3": the key of the battery-size table (energy.ts). */
  private static func machine() -> String {
    var size = 0
    sysctlbyname("hw.machine", nil, &size, nil, 0)
    var bytes = [CChar](repeating: 0, count: max(size, 1))
    sysctlbyname("hw.machine", &bytes, &size, nil, 0)
    return String(cString: bytes)
  }

  public func definition() -> ModuleDefinition {
    Name("FredEnergy")

    OnCreate {
      DispatchQueue.main.async { UIDevice.current.isBatteryMonitoringEnabled = true }
    }

    /** The battery now. The level comes in steps of 0.05 since iOS 17; -1 means unknown. */
    Function("read") { () -> [String: Any?] in
      let level = UIDevice.current.batteryLevel
      let state = UIDevice.current.batteryState
      let energy = Self.taskEnergy()
      return [
        "platform": "ios",
        "level": level >= 0 ? Double(level) : nil,
        "charging": state == .charging || state == .full,
        "current": nil,
        "voltageMv": nil,
        "chargeMicroAh": nil,
        "counterJoules": energy.map { Double($0) / 1e9 },
        "model": Self.machine(),
        "lowPower": ProcessInfo.processInfo.isLowPowerModeEnabled,
        "thermal": ProcessInfo.processInfo.thermalState.rawValue
      ]
    }

    /** Note the counter. The interval is Android's; nothing is sampled here. */
    Function("start") { (_: Int) in
      self.startedEnergy = Self.taskEnergy()
    }

    /** The counter's rise since start, in joules; nil when either reading failed. */
    Function("stop") { () -> [String: Any?] in
      let end = Self.taskEnergy()
      var joules: Double?
      if let a = self.startedEnergy, let b = end, b >= a { joules = Double(b - a) / 1e9 }
      self.startedEnergy = nil
      return ["t": [Double](), "current": [Double](), "voltageMv": [Double](), "counterJoules": joules]
    }
  }
}
