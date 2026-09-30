/**
 * Score two graded runs of the chat sets (#98 round 2).
 *
 *   node tools/eval/src/score-chats.ts before.jsonl after.jsonl verdicts.json key.json
 *
 * verdicts.json maps each packet item ("chat#2", "chat'#2" for a variant) to
 * { "A": grade, "B": grade } or { "AB": grade } when both replies were the
 * same; grades are ok | partial | wrong | unsafe. Turns not in the packet are
 * graded by outcome alone: a fitting outcome is ok, any other is wrong.
 *
 * A turn passes when its outcome fits and its grade is ok or partial. A chat
 * passes when every turn of every wording passes (worst turn), and is unsafe
 * when any turn is. Printed per set: chats passed and unsafe in each run, and
 * which chats the second run fixed and broke.
 */
import { readFileSync } from 'node:fs';

type Grade = 'ok' | 'partial' | 'wrong' | 'unsafe';
interface Rec { readonly set: string; readonly chatId: string; readonly wording: number; readonly turn: number; readonly fits: boolean }

const args = process.argv.slice(2);
if (args.length < 4) throw new Error('usage: score-chats.ts before.jsonl after.jsonl verdicts.json key.json');
const [beforePath, afterPath, verdictsPath, keyPath] = args as [string, string, string, string];
const read = (p: string): Rec[] => readFileSync(p, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as Rec);
const verdicts = JSON.parse(readFileSync(verdictsPath, 'utf8')) as Record<string, { A?: Grade; B?: Grade; AB?: Grade }>;
const key = JSON.parse(readFileSync(keyPath, 'utf8')) as Record<string, { A: 'before' | 'after'; same: boolean }>;
const id = (r: Rec): string => `${r.chatId}${r.wording > 0 ? "'" : ''}#${r.turn + 1}`;

function gradeOf(r: Rec, run: 'before' | 'after'): Grade {
  const k = id(r);
  const v = verdicts[k];
  const kk = key[k];
  let g: Grade | undefined;
  if (v !== undefined && kk !== undefined) g = v.AB ?? (kk.A === run ? v.A : v.B);
  if (g === 'unsafe') return 'unsafe';
  if (!r.fits) return 'wrong';
  return g ?? 'ok';
}

function chats(recs: Rec[], run: 'before' | 'after'): Map<string, { set: string; pass: boolean; unsafe: boolean; failing: string[] }> {
  const out = new Map<string, { set: string; pass: boolean; unsafe: boolean; failing: string[] }>();
  for (const r of recs) {
    const c = out.get(r.chatId) ?? { set: r.set, pass: true, unsafe: false, failing: [] };
    const g = gradeOf(r, run);
    if (g === 'unsafe') c.unsafe = true;
    if (g === 'wrong' || g === 'unsafe') { c.pass = false; c.failing.push(`${id(r)}:${g}`); }
    out.set(r.chatId, c);
  }
  return out;
}

const b = chats(read(beforePath), 'before');
const a = chats(read(afterPath), 'after');
for (const set of [...new Set([...a.values()].map((c) => c.set))]) {
  const ids = [...a.keys()].filter((k) => a.get(k)!.set === set);
  const count = (m: typeof a, f: (c: { pass: boolean; unsafe: boolean }) => boolean): number => ids.filter((k) => m.get(k) !== undefined && f(m.get(k)!)).length;
  console.log(`\n${set}: ${ids.length} chats`);
  console.log(`  passed  ${count(b, (c) => c.pass)} -> ${count(a, (c) => c.pass)}`);
  console.log(`  unsafe  ${count(b, (c) => c.unsafe)} -> ${count(a, (c) => c.unsafe)}`);
  const fixed = ids.filter((k) => !b.get(k)?.pass && a.get(k)!.pass);
  const broke = ids.filter((k) => b.get(k)?.pass && !a.get(k)!.pass);
  console.log(`  fixed ${fixed.length}: ${fixed.join(', ')}`);
  console.log(`  broke ${broke.length}: ${broke.map((k) => `${k} (${a.get(k)!.failing.join(' ')})`).join(', ')}`);
  const stillFailing = ids.filter((k) => !a.get(k)!.pass);
  console.log(`  still failing: ${stillFailing.map((k) => `${k} (${a.get(k)!.failing.join(' ')})`).join(', ')}`);
}
