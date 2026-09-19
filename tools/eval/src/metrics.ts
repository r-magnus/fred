/**
 * Render docs/METRICS.md from docs/metrics.json.
 *
 *   node tools/eval/src/metrics.ts
 *
 * One dashboard, generated rather than hand-maintained, so the numbers in it
 * cannot drift away from the numbers they came from. Update metrics.json after a
 * measurement and re-run this; never edit METRICS.md directly.
 */
import { readFileSync, writeFileSync } from 'node:fs';

interface Kr {
  id: string; name: string; due: string;
  value: number | string | null; unit?: string; target?: number;
  lowerIsBetter?: boolean; bands?: string[]; grade: string; note: string;
}
interface Metrics {
  updated: string;
  config: Record<string, string | number>;
  krs: Kr[];
  akr2History: { label: string; overall: number; model: string }[];
  akr2Breakdown: Record<string, { pass: number; total: number; what: string }>;
  remainingLosses: { n: number; what: string; fix: string }[];
  latency: { mean: number; median: number; p95: number; overTenSeconds: number; ofQueries: number; note: string };
  readability: { clean: number; total: number; defects: { n: number; what: string }[] };
  mcq: { note: string; conditions: { name: string; acc: number }[]; corpusDerived: number; independent: number; reference: string };
  corpora: { pack: string; version: string; chunks: number; source: string }[];
  device?: {
    hardware: string; model: string; packLoadMs: number; modelLoadMs: number;
    retrieveMs: number[]; answers: { q: string; totalMs: number; ttftMs: number }[];
    meanMs: number; peakPssMb: number; peakRssMb: number; idlePssMb: number;
    embedderParity: string; note: string;
  };
  akr2Holdout?: {
    overall: number; correct: number; total: number;
    judgedAcceptable: number; judged: number; nonAnswerCorrect: number;
    tuningComparison: number;
    routingRecall: {
      tuning: { reached: number; answerable: number };
      holdout: { reached: number; answerable: number };
      note: string;
    };
    newSafetyDefects: { id: string; what: string }[];
    note: string;
  };
  location?: {
    implemented: string; stateResolution: string; whyNotReverseGeocode: string;
    stateAccuracy: string; fixStrategy: string; lockMs: number; lockNote: string;
    methodComparison: Record<string, { samples: number[]; median: number; note: string }>;
    samples: { when: string; where: string; state: string; accuracyMeters: number; note: string }[];
    note: string;
  };
}

const m = JSON.parse(readFileSync('docs/metrics.json', 'utf8')) as Metrics;

/** Proportional bar. Full blocks then light shade, so it reads at a glance. */
function bar(pct: number, width = 28): string {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

const GRADE_MARK: Record<string, string> = {
  A: '🟢 A', B: '🟡 B', C: '🟠 C', D: '🔴 D', F: '🔴 F', '—': '⚪ not started',
};

const out: string[] = [];
const p = (s = ''): number => out.push(s);

p('# Fred — metrics at a glance');
p();
p(`*Generated from \`docs/metrics.json\` — do not edit by hand. Last updated **${m.updated}**.*`);
p();
p('```');
for (const [k, v] of Object.entries(m.config)) p(`${k.padEnd(18)} ${v}`);
p('```');
p();

p('## Milestone scorecard');
p();
p('| KR | What | Due | Now | Grade |');
p('|---|---|---|---|---|');
for (const k of m.krs) {
  const val = k.value === null ? '—'
    : typeof k.value === 'number' ? `**${k.value}${k.unit ?? ''}**${k.target !== undefined ? ` / ${k.target}${k.unit ?? ''}` : ''}`
    : `**${k.value}**`;
  p(`| \`${k.id}\` | ${k.name} | ${k.due} | ${val} | ${GRADE_MARK[k.grade] ?? k.grade} |`);
}
p();
for (const k of m.krs) if (k.note) p(`- \`${k.id}\` — ${k.note}`);
p();

p('## A-KR2 — answer accuracy over time');
p();
p('```');
const wLab = Math.max(...m.akr2History.map((h) => h.label.length));
for (const h of m.akr2History) {
  p(`${h.label.padEnd(wLab)}  ${bar(h.overall)}  ${h.overall.toFixed(1).padStart(5)}%   ${h.model}`);
}
p(`${'TARGET'.padEnd(wLab)}  ${bar(90)}  ${'90.0'.padStart(5)}%`);
p('```');
p();
const first = m.akr2History[0]!, last = m.akr2History[m.akr2History.length - 1]!;
p(`**${first.overall}% → ${last.overall}%** (+${(last.overall - first.overall).toFixed(1)} points). Target is 90%.`);
p();
p('The score has two halves:');
p();
p('| Half | Score | What it measures |');
p('|---|---|---|');
for (const [name, b] of Object.entries(m.akr2Breakdown)) {
  p(`| ${name} | **${b.pass}/${b.total}** — ${((b.pass / b.total) * 100).toFixed(1)}% | ${b.what} |`);
}
p();

p('### Where the remaining points are');
p();
p('| Lost | Why | What would fix it |');
p('|---:|---|---|');
for (const l of m.remainingLosses) p(`| ${l.n} | ${l.what} | ${l.fix} |`);
p();

p('## A-KR3 — response time');
p();
p('```');
p('(longer bar = slower; the target is to stay left of the 10s mark)');
p('');
const sec = (v: number): string => `${v.toFixed(1).padStart(5)} s   ${bar(Math.min(100, (v / 20) * 100))}`;
p(`target  ${sec(10)}  <-- 10s`);
p(`mean    ${sec(m.latency.mean)}`);
p(`median  ${sec(m.latency.median)}`);
p(`p95     ${sec(m.latency.p95)}`);
p('```');
p();
p(`**${m.latency.overTenSeconds} of ${m.latency.ofQueries}** queries exceed ten seconds. ${m.latency.note}`);
p();

if (m.device) {
  const d = m.device;
  p('## On the actual phone');
  p();
  p(`\`${d.hardware}\`  ·  ${d.model}`);
  p();
  p('| | |');
  p('|---|---|');
  p(`| Pack load | ${d.packLoadMs} ms (four packs) |`);
  p(`| Model load | ${(d.modelLoadMs / 1000).toFixed(1)} s |`);
  p(`| Retrieval | ${Math.min(...d.retrieveMs)}-${Math.max(...d.retrieveMs)} ms |`);
  p(`| Answer, mean | **${(d.meanMs / 1000).toFixed(1)} s** |`);
  p(`| Peak memory | **${(d.peakPssMb / 1024).toFixed(2)} GB PSS** / ${(d.peakRssMb / 1024).toFixed(2)} GB RSS |`);
  p(`| Idle after run | ${d.idlePssMb} MB PSS |`);
  p(`| Embedder parity | ${d.embedderParity} |`);
  p();
  p('```');
  const wq = Math.max(...d.answers.map((a) => a.q.length));
  for (const a of d.answers) {
    p(`${a.q.padEnd(wq)}  ${bar(Math.min(100, (a.totalMs / 25000) * 100))}  ${(a.totalMs / 1000).toFixed(1).padStart(5)} s   (TTFT ${(a.ttftMs / 1000).toFixed(1)}s)`);
  }
  p(`${'10s target'.padEnd(wq)}  ${bar(40)}`);
  p('```');
  p();
  p(`> ${d.note}`);
  p();
}

p('## Readability of the answers Fred gives');
p();
const rp = (m.readability.clean / m.readability.total) * 100;
p('```');
p(`clean   ${bar(rp)}  ${rp.toFixed(0)}%  (${m.readability.clean}/${m.readability.total})`);
p('```');
p();
p('| Count | Defect |');
p('|---:|---|');
for (const d of m.readability.defects) p(`| ${d.n} | ${d.what} |`);
p();
p('> Correct and readable are different things. When Fred is wrong he is *also* fluent,');
p('> which is why US-03 (showing sources) carries more weight than its Stretch label suggests.');
p();

p('## Multiple choice — the other benchmark');
p();
p(`> ${m.mcq.note}`);
p();
p('```');
const wC = Math.max(...m.mcq.conditions.map((c) => c.name.length));
for (const c of m.mcq.conditions) p(`${c.name.padEnd(wC)}  ${bar(c.acc)}  ${c.acc.toFixed(1).padStart(5)}%`);
p('```');
p();
p(`Split by question origin: **corpus-derived ${m.mcq.corpusDerived}%**, independent ${m.mcq.independent}%.`);
p();
p(`${m.mcq.reference} That is the same measurement as the corpus-derived number above.`);
p();

p('## Corpora');
p();
p('| Pack | Version | Chunks | Source |');
p('|---|---|---:|---|');
for (const c of m.corpora) p(`| \`${c.pack}\` | ${c.version} | ${c.chunks.toLocaleString()} | ${c.source} |`);
p();
const totalChunks = m.corpora.reduce((s, c) => s + c.chunks, 0);
p(`**${totalChunks.toLocaleString()} chunks** across ${m.corpora.length} pack types.`);

if (m.akr2Holdout !== undefined) {
  const h = m.akr2Holdout;
  p();
  p('---');
  p();
  p('## A-KR2 on held-out questions');
  p();
  p(`**${h.overall.toFixed(1)}%** (${h.correct}/${h.total}) against **${h.tuningComparison}%** on the set everything was tuned on.`);
  p();
  p('The gap is routing, not generation:');
  p();
  p('| Set | Answerable questions that reached the model |');
  p('|---|---|');
  const rt = h.routingRecall.tuning, rh = h.routingRecall.holdout;
  p(`| tuning (lexicon built from it) | ${rt.reached}/${rt.answerable} — ${((rt.reached / rt.answerable) * 100).toFixed(0)}% |`);
  p(`| held out | ${rh.reached}/${rh.answerable} — ${((rh.reached / rh.answerable) * 100).toFixed(0)}% |`);
  p();
  p(h.routingRecall.note);
  if (h.newSafetyDefects.length > 0) {
    p();
    p('**Safety defects this surfaced:**');
    for (const d of h.newSafetyDefects) p(`- \`${d.id}\` — ${d.what}`);
  }
  p();
  p(`⚠️ ${h.note}`);
}

if (m.location !== undefined) {
  const l = m.location;
  p();
  p('---');
  p();
  p('## Location (B-KR1)');
  p();
  p(`Implemented ${l.implemented}.`);
  p();
  p('| Fix | Where | State | Accuracy |');
  p('|---|---|---|---:|');
  for (const s of l.samples) {
    p(`| ${s.when} | ${s.where} | ${s.state} | ±${s.accuracyMeters} m |`);
  }
  p();
  p(`**Getting the fix** — ${l.fixStrategy}`);
  p();
  p('| Method | Indoor samples (m) | Median |');
  p('|---|---|---:|');
  for (const [name, c] of Object.entries(l.methodComparison)) {
    p(`| ${name} | ${c.samples.join(', ')} | **${c.median} m** |`);
  }
  p();
  p(`Lock time is ${(l.lockMs / 1000).toFixed(0)} s. ${l.lockNote}`);
  p();
  p(`**State resolution** — ${l.stateResolution}. ${l.whyNotReverseGeocode}`);
  p();
  p(`**State accuracy** — ${l.stateAccuracy}. This is separate from the fix accuracy above: it bounds *which guide* Fred opens, not where it thinks you are.`);
  p();
  p(`⚠️ ${l.note}`);
}

p();
p('---');
p();
p('*To refresh: re-measure, update `docs/metrics.json`, run `node tools/eval/src/metrics.ts`.*');

writeFileSync('docs/METRICS.md', out.join('\n') + '\n');
console.log(`wrote docs/METRICS.md (${out.length} lines)`);
