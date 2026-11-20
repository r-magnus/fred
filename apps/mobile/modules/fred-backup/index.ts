/**
 * Keep Fred's downloads out of the iPhone's iCloud backup (src/backup.ts).
 * iPhone only: Android's backup rules are set in the manifest, and the web
 * has none. Absent, nothing is marked.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

interface FredBackupNative {
  /** A plain path, not a file:// URI. */
  exclude(path: string): boolean;
  isExcluded(path: string): boolean | null;
}

export default requireOptionalNativeModule<FredBackupNative>('FredBackup');
