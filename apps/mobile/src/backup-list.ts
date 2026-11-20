/**
 * Which of Fred's files may go into the iPhone's iCloud backup (src/backup.ts).
 *
 * Only what the hiker made or chose: their chats, ratings not yet sent, and
 * small settings. Everything else in the document directory is a download
 * (models, guides under packs/, maps, coverage, region lists, and the
 * .partial and .part files of a download under way) and can be fetched again,
 * so it is kept out. Listing what stays, not what goes, means a new kind of
 * download is kept out without anyone remembering to add it.
 */
export const BACKED_UP: ReadonlySet<string> = new Set([
  'chats.json',
  'feedback-outbox.json',
  'setup.json',
  'agreement.json',
  'theme.json',
  'carrier.json',
  'energy.json',
]);

/** The names in the document directory to mark excluded from backup. */
export function notBackedUp(names: readonly string[]): string[] {
  // devhooks* are the desktop test-run switches (App.tsx, setup.ts): tiny, and never on a tester's phone.
  return names.filter((n) => !BACKED_UP.has(n) && !n.startsWith('devhooks'));
}
