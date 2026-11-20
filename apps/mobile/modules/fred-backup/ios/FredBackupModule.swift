import ExpoModulesCore
import Foundation

/**
 Keeps what Fred downloads out of the iPhone's iCloud backup (App Store Review
 Guideline 2.23, iOS Data Storage Guidelines). The guides, models and maps are
 about 1.45 GB, can all be downloaded again, and would otherwise fill a free
 5 GB iCloud plan. The JavaScript side chooses what to mark (src/backup.ts).

 The mark is an attribute of the file, so a file that is replaced (a download
 renamed over an old one) loses it; that is why the app marks again at launch
 and after every download. A directory's mark covers everything in it.
 */
public class FredBackupModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FredBackup")

    /** Mark a file or directory as excluded from backup. False if it is missing or the mark failed. */
    Function("exclude") { (path: String) -> Bool in
      var url = URL(fileURLWithPath: path)
      guard FileManager.default.fileExists(atPath: path) else { return false }
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      do {
        try url.setResourceValues(values)
        return true
      } catch {
        return false
      }
    }

    /** Whether a file or directory is marked; nil when it can't be read. For checking on a phone. */
    Function("isExcluded") { (path: String) -> Bool? in
      let url = URL(fileURLWithPath: path)
      return (try? url.resourceValues(forKeys: [.isExcludedFromBackupKey]))?.isExcludedFromBackup
    }
  }
}
