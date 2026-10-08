/**
 * Train the matcher that says which field card a message is about
 * (packages/rag-core/src/said-as.ts, docs/results-said-as.md).
 *
 *   PACKS_DIR=~/fred-packs-g-all node tools/eval/src/train-said-as.ts [out.json]
 *
 * Reads corpora/cards/said-as.tsv (label, tab, message; a label is a card id
 * or none:<kind>), turns each message into its search vector exactly as a
 * query is, and fits one row of weights per label. The two thresholds come
 * from scoring every example with a model that never saw it (10 folds): no
 * test set has a say in them.
 *
 * The examples were written for this, or are the scope scorer's training
 * messages given a label, and share no wording with any eval set: the leak
 * check fails the run on a near copy.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { applyQueryTemplate, saidAs, type SaidAsModel } from '@fred/rag-core';
import { openHarness } from './harness.ts';

const SCALE = 4;
/** Card calls at or above `sure` are right this often on examples the model never saw. */
const SURE_PRECISION = 0.97;
const LEANS_PRECISION = 0.9;

const titles = new Map((JSON.parse(readFileSync('corpora/cards/cards.json', 'utf8')) as { id: string; title: string }[]).map((c) => [c.id, c.title]));
const rows = readFileSync('corpora/cards/said-as.tsv', 'utf8').trim().split('\n').map((l) => {
  const [id, text] = l.split('\t') as [string, string];
  const label = id.startsWith('none:') ? id : titles.get(id);
  if (label === undefined || text === undefined) throw new Error(`bad line: ${l}`);
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
const X: Float64Array[] = [];
for (const r of rows) {
  const v = await h.backend.embed(applyQueryTemplate(h.backend.embeddingSpec().queryTemplate, r.text));
  const norm = Math.hypot(...v);
  X.push(Float64Array.from(v, (x) => (x / norm) * SCALE));
}
await h.close();
const labels = [...new Set(rows.map((r) => r.label))];
const D = X[0]!.length;
const Y = rows.map((r) => labels.indexOf(r.label));

/** Softmax regression by plain gradient descent, labels weighted equally. Deterministic. */
function train(keep: (i: number) => boolean, l2 = 1e-3, epochs = 300, lr = 2): { W: Float64Array[]; B: Float64Array } {
  const K = labels.length;
  const W = Array.from({ length: K }, () => new Float64Array(D));
  const B = new Float64Array(K);
  const idx = rows.map((_, i) => i).filter(keep);
  const count = new Array<number>(K).fill(0);
  for (const i of idx) count[Y[i]!]!++;
  for (let e = 0; e < epochs; e++) {
    const G = Array.from({ length: K }, () => new Float64Array(D));
    const GB = new Float64Array(K);
    for (const i of idx) {
      const x = X[i]!;
      const z = W.map((w, k) => { let s = B[k]!; for (let j = 0; j < D; j++) s += w[j]! * x[j]!; return s; });
      const max = Math.max(...z);
      const ex = z.map((q) => Math.exp(q - max));
      const sum = ex.reduce((a, b) => a + b, 0);
      const cw = idx.length / (K * count[Y[i]!]!);
      for (let k = 0; k < K; k++) {
        const err = (ex[k]! / sum - (Y[i] === k ? 1 : 0)) * cw;
        if (Math.abs(err) < 1e-6) continue;
        const g = G[k]!;
        for (let j = 0; j < D; j++) g[j]! += err * x[j]!;
        GB[k]! += err;
      }
    }
    for (let k = 0; k < K; k++) {
      const w = W[k]!, g = G[k]!;
      for (let j = 0; j < D; j++) w[j]! -= lr * (g[j]! / idx.length + l2 * w[j]!);
      B[k]! -= (lr * GB[k]!) / idx.length;
    }
  }
  return { W, B };
}
function top(m: { W: Float64Array[]; B: Float64Array }, x: Float64Array): { k: number; p: number } {
  const z = m.W.map((w, k) => { let s = m.B[k]!; for (let j = 0; j < D; j++) s += w[j]! * x[j]!; return s; });
  const max = Math.max(...z);
  const ex = z.map((q) => Math.exp(q - max));
  const sum = ex.reduce((a, b) => a + b, 0);
  const k = z.indexOf(max);
  return { k, p: ex[k]! / sum };
}

const FOLDS = 10;
const held: { right: boolean; card: boolean; p: number; i: number; k: number }[] = [];
for (let f = 0; f < FOLDS; f++) {
  const m = train((i) => i % FOLDS !== f);
  rows.forEach((_, i) => {
    if (i % FOLDS !== f) return;
    const t = top(m, X[i]!);
    held.push({ right: t.k === Y[i], card: !labels[t.k]!.startsWith('none:'), p: t.p, i, k: t.k });
  });
}
const isCard = (l: string): boolean => !l.startsWith('none:');
const cardCalls = held.filter((r) => r.card).sort((a, b) => b.p - a.p);
/** The lowest share at which the card calls at or above it are right at least this often. */
function thresholdFor(precision: number): number {
  let best = 1;
  let right = 0;
  cardCalls.forEach((r, n) => {
    if (r.right) right++;
    if (right / (n + 1) >= precision) best = r.p;
  });
  return Math.ceil(best * 100) / 100;
}
const sure = thresholdFor(SURE_PRECISION);
const leans = thresholdFor(LEANS_PRECISION);
const cards = rows.filter((r) => isCard(r.label)).length;
console.log(`${rows.length} examples, ${labels.length} labels (${cards} examples of ${labels.filter(isCard).length} cards)`);
console.log(`scored by a model that never saw them: top label right for ${held.filter((r) => r.right).length} of ${rows.length}`);
for (const [name, t] of [['sure', sure], ['leans', leans]] as const) {
  const at = cardCalls.filter((r) => r.p >= t);
  console.log(`${name} ${t}: ${at.length} card calls, ${at.filter((r) => r.right).length} right, ` +
    `${at.filter((r) => !r.right && isCard(rows[r.i]!.label)).length} the wrong card, ${at.filter((r) => !isCard(rows[r.i]!.label)).length} no card's; ` +
    `${at.filter((r) => r.right).length} of ${cards} card examples reached`);
}
if (process.env.VERBOSE === '1') {
  for (const r of held.filter((r) => !r.right && r.p >= leans)) console.log(`  [${rows[r.i]!.label}] ${rows[r.i]!.text} -> ${r.p.toFixed(2)} ${labels[r.k]}`);
}

const m = train(() => true);
// Each row as int8 with its own scale: 51 rows of 768 weights are 39 KB.
const bytes = new Int8Array(labels.length * D);
const scales = m.W.map((w, k) => {
  const max = w.reduce((a, x) => Math.max(a, Math.abs(x)), 0) || 1;
  for (let j = 0; j < D; j++) bytes[k * D + j] = Math.round((w[j]! / max) * 127);
  return max / 127;
});
const model: SaidAsModel = {
  labels, dim: D, w: Buffer.from(bytes.buffer).toString('base64'), scales: scales.map((s) => Number(s.toPrecision(6))),
  b: Array.from(m.B, (x) => Math.round(x * 1e4) / 1e4), scale: SCALE, sure, leans,
};
// The rounding must not change what the model says.
let moved = 0;
X.forEach((x, i) => {
  const a = top(m, x);
  const b = saidAs(model, Float32Array.from(x))[0]!;
  if (labels[a.k] !== b.label || Math.abs(a.p - b.p) > 0.02) moved++;
  void i;
});
console.log(`int8 weights: ${moved} of ${rows.length} examples change label or move more than 0.02`);

const out = process.argv[2] ?? 'tools/eval/data/said-as-model.json';
writeFileSync(out, JSON.stringify(model) + '\n');
// The app reads the weights from a module, so no file has to be shipped beside the bundle.
if (process.argv[2] === undefined) {
  writeFileSync('packages/rag-core/src/said-as-model.ts', `/**
 * The card matcher's weights (said-as.ts), written by tools/eval/src/train-said-as.ts
 * from corpora/cards/said-as.tsv. Do not edit by hand.
 */
import type { SaidAsModel } from './said-as.ts';

export const SAID_AS_MODEL: SaidAsModel = ${JSON.stringify(model)};
`);
}
console.log(`wrote ${out}`);
