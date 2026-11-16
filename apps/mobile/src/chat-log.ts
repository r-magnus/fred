/**
 * Past chats, kept on the phone so a hiker can go back to what Fred said.
 *
 * One JSON file in the app's private storage, rewritten whole after each
 * finished answer: a chat is a few kilobytes and only the newest are kept, so
 * there is nothing to gain from a database. Nothing here leaves the phone.
 *
 * Generic over the turn, which the screen defines; this file only needs each
 * turn's question and the time it was asked.
 */
import { File, Paths } from 'expo-file-system';

export interface SavedChat<T> {
  /** When the chat was started (ms): also its identity. */
  readonly id: number;
  readonly updatedAt: number;
  /** The first thing asked, shown in the list. */
  readonly title: string;
  readonly turns: readonly T[];
}

/** Older chats than this are dropped as new ones are saved. */
const KEEP = 40;
const file = (): File => new File(Paths.document, 'chats.json');

/** Newest first. A missing or unreadable file is an empty list, never an error on screen. */
export function loadChats<T>(): SavedChat<T>[] {
  try {
    const f = file();
    if (!f.exists) return [];
    const parsed: unknown = JSON.parse(f.textSync());
    return Array.isArray(parsed) ? (parsed as SavedChat<T>[]) : [];
  } catch {
    return [];
  }
}

function store<T>(chats: readonly SavedChat<T>[]): void {
  try { file().write(JSON.stringify(chats)); } catch { /* a full disk loses the list, not the chat on screen */ }
}

/** Adds the chat or replaces its earlier save, and returns the new list. */
export function saveChat<T extends { readonly question: string }>(
  chats: readonly SavedChat<T>[], id: number, turns: readonly T[],
): SavedChat<T>[] {
  const first = turns[0];
  if (first === undefined) return [...chats];
  const next = [
    { id, updatedAt: Date.now(), title: first.question, turns },
    ...chats.filter((c) => c.id !== id),
  ].slice(0, KEEP);
  store(next);
  return next;
}

export function removeChat<T>(chats: readonly SavedChat<T>[], id: number): SavedChat<T>[] {
  const next = chats.filter((c) => c.id !== id);
  store(next);
  return next;
}

/** Puts a removed chat back where it was (Undo), keeping the list newest first. */
export function restoreChat<T>(chats: readonly SavedChat<T>[], chat: SavedChat<T>): SavedChat<T>[] {
  const next = [...chats.filter((c) => c.id !== chat.id), chat]
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, KEEP);
  store(next);
  return next;
}

/** "Today, 4:12 pm", "Yesterday", "Mon", "Oct 5": how long ago, the way a journal dates a page. */
export function describeWhen(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const midnight = (t: number): number => new Date(t).setHours(0, 0, 0, 0);
  const days = Math.round((midnight(now) - midnight(ms)) / 86_400_000);
  if (days <= 0) {
    const h = d.getHours();
    return `Today, ${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
  }
  if (days === 1) return 'Yesterday';
  if (days < 7) return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]!;
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getDate()}`;
}
