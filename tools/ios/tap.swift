// Tap the iOS simulator from the command line: one left click at a point on
// the Mac's screen, in points from the top left.
//
//   swiftc -O tools/ios/tap.swift -o /tmp/tap && /tmp/tap 859 286
//
// simctl has no touch input, and System Events' `click at` reaches the Device
// Hub window but not the app inside it. A posted mouse event does. The terminal
// running this needs Accessibility permission, and Device Hub must be in front:
//   osascript -e 'tell application "DeviceHub" to activate'
//
// To find the point: the window's origin and size come from
//   osascript -e 'tell application "System Events" to get {position, size} of window 1 of process "DeviceHub"'
// and the device's place inside it from one look at the window. Check each tap
// with `xcrun simctl io <udid> screenshot`, which needs no permission;
// `screencapture` of the window asks for Screen Recording, and its prompt then
// sits over the simulator and swallows the taps.
import CoreGraphics
import Foundation

let args = CommandLine.arguments
guard args.count == 3, let x = Double(args[1]), let y = Double(args[2]) else {
  FileHandle.standardError.write("usage: tap <x> <y>\n".data(using: .utf8)!)
  exit(2)
}
let point = CGPoint(x: x, y: y)
let source = CGEventSource(stateID: .hidSystemState)
func post(_ type: CGEventType) {
  CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: .left)!.post(tap: .cghidEventTap)
}
post(.mouseMoved)
usleep(150_000)
post(.leftMouseDown)
usleep(120_000)
post(.leftMouseUp)
