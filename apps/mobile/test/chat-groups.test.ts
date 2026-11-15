import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatGroup, chatTitle, groupChats, whenInGroup } from '../src/chat-groups.ts';

// Sunday 15 November 2026, 2 pm local time.
const NOW = new Date(2026, 10, 15, 14, 0).getTime();
const at = (day: number, h: number, m = 0): number => new Date(2026, 10, day, h, m).getTime();

test('groups by calendar day, not by 24-hour spans', () => {
  assert.equal(chatGroup(at(15, 0, 5), NOW), 'Today');
  assert.equal(chatGroup(at(14, 23, 59), NOW), 'Yesterday');
  assert.equal(chatGroup(at(9, 12), NOW), 'This week');
  assert.equal(chatGroup(at(8, 12), NOW), 'Earlier');
});

test('a row says only what its heading does not', () => {
  assert.equal(whenInGroup(at(15, 9, 55), NOW), '9:55 am');
  assert.equal(whenInGroup(at(15, 0, 5), NOW), '12:05 am');
  assert.equal(whenInGroup(at(14, 18), NOW), '');
  assert.equal(whenInGroup(at(12, 8), NOW), 'Thu');
  assert.equal(whenInGroup(at(3, 8), NOW), 'Nov 3');
});

test('newest-first chats come out in their groups, empty groups left out', () => {
  const chats = [at(15, 13), at(15, 9), at(12, 8), at(1, 8)].map((updatedAt) => ({ updatedAt }));
  const groups = groupChats(chats, NOW);
  assert.deepEqual(groups.map((g) => [g.group, g.chats.length]), [['Today', 2], ['This week', 1], ['Earlier', 1]]);
  assert.deepEqual(groupChats([], NOW), []);
});

test('a question becomes a title with a capital first letter', () => {
  assert.equal(chatTitle('how do I purify water'), 'How do I purify water');
  assert.equal(chatTitle('  is poison oak common'), 'Is poison oak common');
  assert.equal(chatTitle('My friend hit his head'), 'My friend hit his head');
  assert.equal(chatTitle(''), '');
});
