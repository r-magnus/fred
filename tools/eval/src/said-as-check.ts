/**
 * Check the cards' example phrasings (corpora/cards/said-as.tsv) against
 * themselves, with no test set (#152).
 *
 *   PACKS_DIR=~/fred-packs-g-all node tools/eval/src/said-as-check.ts [messages.txt]
 *
 * Each example is matched to the others as a hiker's message would be: its
 * nearest example of every label, by the search vector. Prints how often the
 * nearest one has the same label, the confusions, and what each threshold
 * would accept. Fails on an example that is a near copy of an eval message.
 * With a file of messages (one per line), prints the match for each.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { applyQueryTemplate } from '@fred/rag-core';
import { openHarness } from './harness.ts';

const rows = readFileSync('corpora/cards/said-as.tsv', 'utf8').trim().split('\n').map((l) => {
  const [label, text] = l.split('\t') as [string, string];
  if (text === undefined) throw new Error(`bad line: ${l}`);
  return { label, text };
});

// Leak check, as train-scope.ts: no example may be a near copy of an eval message.
const words = (s: string): Set<string> => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean));
const evalTexts: string[] = [];
const collect = (v: unknown): void => {
  if (Array.isArray(v)) v.forEach(collect);
  else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
    if (typeof x === 'string' && (k === 'question' || k === 'q' || k === 'text')) evalTexts.push(x);
    else if (k === 'variant' && Array.isArray(x)) evalTexts.push(...(x as string[]));
    else collect(x);
  }
};
for (const f of readdirSync('tools/eval/data').filter((f) => f.endsWith('.json') && !f.startsWith('scope-') && !f.startsWith('bec-'))) {
  collect(JSON.parse(readFileSync(`tools/eval/data/${f}`, 'utf8')));
}
const evalWords = evalTexts.map(words);
const leaks: string[] = [];
for (const r of rows) {
  const a = words(r.text);
  evalWords.forEach((b, i) => {
    let n = 0;
    for (const w of a) if (b.has(w)) n++;
    if (n / (a.size + b.size - n) >= 0.7) leaks.push(`"${r.text}" is a near copy of eval message "${evalTexts[i]}"`);
  });
}
if (leaks.length > 0) throw new Error(`near copies of eval messages:\n${leaks.join('\n')}`);

const h = await openHarness();
const tpl = h.backend.embeddingSpec().queryTemplate;
const embed = async (t: string): Promise<Float32Array> => {
  const v = await h.backend.embed(applyQueryTemplate(tpl, t));
  const n = Math.hypot(...v);
  return Float32Array.from(v, (x) => x / n);
};
const cos = (a: Float32Array, b: Float32Array): number => { let d = 0; for (let i = 0; i < a.length; i++) d += a[i]! * b[i]!; return d; };
const vecs: Float32Array[] = [];
for (const r of rows) vecs.push(await embed(r.text));

/** The nearest example of each label, leaving out example `skip`. */
function match(v: Float32Array, skip = -1): { label: string; s: number; text: string }[] {
  const best = new Map<string, { s: number; text: string }>();
  rows.forEach((r, i) => {
    if (i === skip) return;
    const s = cos(v, vecs[i]!);
    if (s > (best.get(r.label)?.s ?? -1)) best.set(r.label, { s, text: r.text });
  });
  return [...best].map(([label, x]) => ({ label, ...x })).sort((a, b) => b.s - a.s);
}

const messages = process.argv[2] === undefined ? undefined
  : readFileSync(process.argv[2], 'utf8').split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#')).flatMap((l) => l.split(' / '));
if (messages !== undefined) {
  for (const m of messages) {
    const top = match(await embed(m)).slice(0, 3);
    console.log(`\n"${m}"`);
    for (const t of top) console.log(`   ${t.s.toFixed(3)} ${t.label.padEnd(18)} <- ${t.text}`);
  }
} else {
  const loo = rows.map((r, i) => ({ r, top: match(vecs[i]!, i) }));
  const right = loo.filter((x) => x.top[0]!.label === x.r.label);
  console.log(`${rows.length} examples, ${new Set(rows.map((r) => r.label)).size} labels; nearest other example has the same label: ${right.length} (${(100 * right.length / rows.length).toFixed(1)}%)`);
  console.log('\nconfusions (example -> nearest):');
  for (const x of loo.filter((x) => x.top[0]!.label !== x.r.label)) {
    console.log(`  [${x.r.label}] ${x.r.text}  ->  ${x.top[0]!.s.toFixed(3)} [${x.top[0]!.label}] ${x.top[0]!.text}`);
  }
  // A card is accepted when its nearest example scores at least t and leads
  // every other label by at least m.
  console.log('\n   t     m   accepted  right  wrong-card  none-as-card');
  const isCard = (l: string): boolean => !l.startsWith('none:');
  for (const t of [0.55, 0.6, 0.65, 0.7, 0.75, 0.8]) for (const m of [0, 0.03, 0.05, 0.08]) {
    let acc = 0, ok = 0, wrongCard = 0, noneAsCard = 0;
    for (const x of loo) {
      const [a, b] = x.top as [typeof x.top[0] & {}, typeof x.top[0]];
      if (!isCard(a.label) || a.s < t || a.s - (b?.s ?? 0) < m) continue;
      acc++;
      if (a.label === x.r.label) ok++;
      else if (isCard(x.r.label)) wrongCard++;
      else noneAsCard++;
    }
    console.log(`  ${t.toFixed(2)}  ${m.toFixed(2)}  ${String(acc).padStart(7)}  ${String(ok).padStart(5)}  ${String(wrongCard).padStart(9)}  ${String(noneAsCard).padStart(11)}`);
  }
}
await h.close();
