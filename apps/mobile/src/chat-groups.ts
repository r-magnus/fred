/**
 * Past chats in the drawer, grouped by when they were last added to (#211):
 * Today, Yesterday, This week, Earlier. Each row then says only what its
 * heading does not: the time for today's chats, the day or date for older ones.
 *
 * Pure, so it is tested without the app (test/chat-groups.test.ts).
 */
export type ChatGroup = 'Today' | 'Yesterday' | 'This week' | 'Earlier';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Whole calendar days between `ms` and `now`, by the phone's own midnight. */
function daysAgo(ms: number, now: number): number {
  const midnight = (t: number): number => new Date(t).setHours(0, 0, 0, 0);
  return Math.round((midnight(now) - midnight(ms)) / 86_400_000);
}

export function chatGroup(ms: number, now = Date.now()): ChatGroup {
  const days = daysAgo(ms, now);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'This week';
  return 'Earlier';
}

/** The part of "when" a row shows under its group's heading: "9:55 am", "", "Thu", "Nov 3". */
export function whenInGroup(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  switch (chatGroup(ms, now)) {
    case 'Today': {
      const h = d.getHours();
      return `${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
    }
    case 'Yesterday': return '';
    case 'This week': return DAYS[d.getDay()]!;
    case 'Earlier': return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  }
}

/**
 * Chats (newest first) cut into their groups, in order, leaving out empty
 * ones. The list is already newest first, so the groups come out in order too.
 */
export function groupChats<C extends { readonly updatedAt: number }>(
  chats: readonly C[], now = Date.now(),
): { readonly group: ChatGroup; readonly chats: readonly C[] }[] {
  const out: { group: ChatGroup; chats: C[] }[] = [];
  for (const c of chats) {
    const g = chatGroup(c.updatedAt, now);
    const last = out.at(-1);
    if (last !== undefined && last.group === g) last.chats.push(c);
    else out.push({ group: g, chats: [c] });
  }
  return out;
}

/** A question as a title: its first letter capitalised, the rest as typed. */
export function chatTitle(question: string): string {
  const t = question.trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
