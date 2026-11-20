/**
 * Keep Fred's downloads out of the iPhone's iCloud backup (App Store Review
 * Guideline 2.23). The guides, models and maps are about 1.45 GB and can all
 * be downloaded again; chats and settings still back up. Which is which:
 * src/backup-list.ts.
 *
 * A file loses its mark when it is replaced, so this runs at every launch and
 * after each file a download finishes. It is cheap: one listing of the
 * document directory, and packs/ is marked as a whole. Off the iPhone the
 * native module is absent and this does nothing.
 */
import { Paths } from 'expo-file-system';
import Backup from '../modules/fred-backup';
import { notBackedUp } from './backup-list.ts';

const path = (uri: string): string => decodeURIComponent(uri.replace(/^file:\/\//, '')).replace(/\/$/, '');

/** Mark every download in the document directory. Returns how many were marked; never throws. */
export function keepDownloadsOutOfBackup(): number {
  if (Backup === null) return 0;
  try {
    const entries = Paths.document.list();
    const out = new Set(notBackedUp(entries.map((e) => e.name)));
    let marked = 0;
    for (const e of entries) if (out.has(e.name) && Backup.exclude(path(e.uri))) marked++;
    return marked;
  } catch {
    return 0; // Marked next launch; a backup that is too big is the worst outcome.
  }
}
