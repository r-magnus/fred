/**
 * Add a sentence index to a built pack (#126, docs/plan-grounded-answers.md).
 *
 *   node tools/ingest/src/add-sentences.ts <out-root> <pack-dir>...
 *
 * Writes a new pack beside the old one with the patch version raised, the
 * passages, vectors and everything else copied unchanged, plus
 * `sentences.i8` (one row per quotable sentence, rag-core quotableSentences,
 * first SENTENCE_DIM dimensions re-normalised) and `sentences.idx` (each
 * passage's first row, then the total, as little-endian uint32). Retrieval
 * reads none of it, so it cannot move.
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { PackFileEntry, PackManifest } from '@fred/pack-format';
import { quantizeInt8, quotableSentences, SENTENCE_DIM, truncateVector } from '@fred/rag-core';
import { documentText, EMBEDDING_GEMMA, loadGgufEmbedder } from './gguf-embed.ts';
import { sha256 } from './pack.ts';

const [outRoot, ...dirs] = process.argv.slice(2);
if (outRoot === undefined || dirs.length === 0) throw new Error('usage: add-sentences.ts <out-root> <pack-dir>...');

const embedder = await loadGgufEmbedder(EMBEDDING_GEMMA);
for (const dir of dirs) {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as PackManifest;
  const db = new DatabaseSync(join(dir, 'chunks.sqlite'), { readOnly: true });
  const rows = db.prepare('SELECT ordinal, section, text FROM chunks ORDER BY ordinal').all() as { ordinal: number; section: string; text: string }[];
  db.close();
  const starts = new Uint32Array(rows.length + 1);
  const inputs: string[] = [];
  rows.forEach((r, i) => {
    if (r.ordinal !== i) throw new Error(`${manifest.id}: ordinal ${r.ordinal} at row ${i}`);
    starts[i] = inputs.length;
    for (const s of quotableSentences(r.text)) inputs.push(documentText(EMBEDDING_GEMMA, r.section, s));
  });
  starts[rows.length] = inputs.length;
  const vecs = await embedder.embed(inputs);
  const out = Buffer.alloc(inputs.length * SENTENCE_DIM);
  vecs.forEach((v, i) => {
    const { vec } = quantizeInt8(truncateVector(v, SENTENCE_DIM));
    Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength).copy(out, i * SENTENCE_DIM);
  });

  const [maj, min, patch] = manifest.version.split('.').map(Number);
  const version = `${maj}.${min}.${patch! + 1}`;
  const target = join(outRoot, `${manifest.id}-v${version}`);
  mkdirSync(target, { recursive: true });
  for (const f of readdirSync(dir)) if (f !== 'manifest.json' && !f.startsWith('sentences.')) copyFileSync(join(dir, f), join(target, f));
  writeFileSync(join(target, 'sentences.i8'), out);
  writeFileSync(join(target, 'sentences.idx'), Buffer.from(starts.buffer));
  const files: PackFileEntry[] = [...manifest.files.filter((f) => !f.path.startsWith('sentences.'))];
  for (const name of ['sentences.i8', 'sentences.idx']) files.push({ path: name, ...(await sha256(join(target, name))) });
  const next: PackManifest = { ...manifest, version, files, sentences: { dim: SENTENCE_DIM, rows: inputs.length } };
  writeFileSync(join(target, 'manifest.json'), JSON.stringify(next, null, 2));
  console.log(`${basename(dir)} -> ${basename(target)}: ${inputs.length} sentences, ${(out.byteLength / 1048576).toFixed(2)} MB`);
}
await embedder.dispose();
