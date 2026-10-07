/**
 * Train the scope scorer (packages/rag-core/src/scope.ts, docs/results-scope-scorer.md).
 *
 *   PACKS_DIR=~/fred-packs-g-all node tools/eval/src/train-scope.ts [out.json]
 *
 * Reads tools/eval/data/scope-train.tsv (label, tab, message; labels answer |
 * out | chat), turns each message into its search vector exactly as a query
 * is, and fits one weight per dimension: "answer" against the other two.
 * The threshold is the score that 5% of the training messages that need no
 * answer exceed when each is scored by a model that never saw it (10 folds),
 * so no test set has a say in it.
 *
 * The training messages were written for this and share no wording with any
 * eval set: the leak check below fails the run on a near copy.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { applyQueryTemplate, type ScopeModel } from '@fred/rag-core';
import { openHarness } from './harness.ts';

const SCALE = 4;
const rows = readFileSync('tools/eval/data/scope-train.tsv', 'utf8').trim().split('\n').map((l) => {
  const [label, text] = l.split('\t') as [string, string];
  if (!['answer', 'out', 'chat'].includes(label) || text === undefined) throw new Error(`bad line: ${l}`);
  return { label, text };
});

// Leak check: no training message may be a near copy of an eval message.
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
for (const r of rows) {
  const a = words(r.text);
  evalWords.forEach((b, i) => {
    let n = 0;
    for (const w of a) if (b.has(w)) n++;
    if (n / (a.size + b.size - n) >= 0.7) throw new Error(`training message "${r.text}" is a near copy of eval message "${evalTexts[i]}"`);
  });
}

const h = await openHarness();
const X: number[][] = [];
for (const r of rows) {
  const v = await h.backend.embed(applyQueryTemplate(h.backend.embeddingSpec().queryTemplate, r.text));
  const norm = Math.hypot(...v);
  X.push(Array.from(v, (x) => (x / norm) * SCALE));
}
await h.close();
const y = rows.map((r) => (r.label === 'answer' ? 1 : 0));

/** Logistic regression by plain gradient descent, classes weighted equally. Deterministic. */
function train(X: number[][], y: number[], l2 = 1e-2, epochs = 500, lr = 0.5): { w: number[]; b: number } {
  const d = X[0]!.length;
  const w = new Float64Array(d);
  let b = 0;
  const np = y.filter((v) => v === 1).length;
  const wp = y.length / (2 * np), wn = y.length / (2 * (y.length - np));
  for (let e = 0; e < epochs; e++) {
    const g = new Float64Array(d);
    let gb = 0;
    for (let i = 0; i < X.length; i++) {
      const x = X[i]!;
      let z = b;
      for (let j = 0; j < d; j++) z += w[j]! * x[j]!;
      const err = (1 / (1 + Math.exp(-z)) - y[i]!) * (y[i] === 1 ? wp : wn);
      for (let j = 0; j < d; j++) g[j]! += err * x[j]!;
      gb += err;
    }
    for (let j = 0; j < d; j++) w[j]! -= lr * (g[j]! / X.length + l2 * w[j]!);
    b -= (lr * gb) / X.length;
  }
  return { w: Array.from(w), b };
}
const score = (m: { w: number[]; b: number }, x: number[]): number => x.reduce((z, v, j) => z + m.w[j]! * v, m.b);

const K = 10;
const heldOut: { pos: boolean; z: number }[] = [];
for (let k = 0; k < K; k++) {
  const m = train(X.filter((_, i) => i % K !== k), y.filter((_, i) => i % K !== k));
  X.forEach((x, i) => { if (i % K === k) heldOut.push({ pos: y[i] === 1, z: score(m, x) }); });
}
const neg = heldOut.filter((r) => !r.pos).map((r) => r.z).sort((a, b) => b - a);
const threshold = Math.round(neg[Math.floor(neg.length * 0.05)]! * 100) / 100;
const pos = heldOut.filter((r) => r.pos);
console.log(`${rows.length} messages (${pos.length} need an answer); threshold ${threshold}: ${pos.filter((r) => r.z >= threshold).length}/${pos.length} of those at or above it, 5% of the rest`);

const m = train(X, y);
const model: ScopeModel = { w: m.w.map((x) => Math.round(x * 1e5) / 1e5), b: m.b, scale: SCALE, threshold };
const out = process.argv[2] ?? 'tools/eval/data/scope-model.json';
writeFileSync(out, JSON.stringify(model) + '\n');
// The app reads the weights from a module, so no file has to be shipped beside the bundle.
if (process.argv[2] === undefined) {
  writeFileSync('packages/rag-core/src/scope-model.ts', `/**
 * The scope scorer's weights (scope.ts), written by tools/eval/src/train-scope.ts
 * from tools/eval/data/scope-train.tsv. Do not edit by hand.
 */
import type { ScopeModel } from './scope.ts';

export const SCOPE_MODEL: ScopeModel = ${JSON.stringify(model)};
`);
}
console.log(`wrote ${out}`);
