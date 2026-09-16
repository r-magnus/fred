/**
 * Pack writer — produces the on-disk artifact described by @fred/pack-format.
 *
 * Uses Node's built-in node:sqlite, which ships FTS5 with BM25. That removes the
 * better-sqlite3 native build from the toolchain entirely, which matters because
 * this project already carries an NDK cross-compile.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  DomainTag, EmbeddingSpec, LicenseEntry, PackFileEntry, PackManifest, PackScope,
} from '@fred/pack-format';
import { SCHEMA_VERSION } from '@fred/pack-format';
import { quantizeInt8 } from '@fred/rag-core';
import type { DraftChunk } from './chunk.ts';

// 0.2.0: chunkPages carries a list's governing header across window boundaries.
// Packs built before this can contain negated lists stripped of their "Do not -",
// which inverts every item (docs/results-alpha.md). Bumped so a pack's provenance
// records whether it has the fix.
export const INGEST_VERSION = '0.2.0';

export interface PackInput {
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly description: string;
  readonly domains: readonly DomainTag[];
  readonly scope: PackScope;
  readonly source: string;
  readonly licenseId: string;
  readonly licenses: readonly LicenseEntry[];
  readonly embedding: EmbeddingSpec;
}

async function sha256(path: string): Promise<{ sha256: string; bytes: number }> {
  const buf = await readFile(path);
  return { sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.byteLength };
}

function writeChunkDb(dbPath: string, packId: string, chunks: readonly DraftChunk[], input: PackInput): void {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;');
  // ordinal is the rowid, so it doubles as the row index into vectors.i8.
  db.exec(`
    CREATE TABLE chunks (
      ordinal    INTEGER PRIMARY KEY,
      id         TEXT NOT NULL UNIQUE,
      pack_id    TEXT NOT NULL,
      text       TEXT NOT NULL,
      section    TEXT NOT NULL,
      source     TEXT NOT NULL,
      page       INTEGER,
      domain     TEXT NOT NULL,
      license_id TEXT NOT NULL,
      block_kind TEXT NOT NULL
    );
    -- External-content FTS5: the index references chunks rather than copying
    -- the text, which keeps the pack roughly half the size on device.
    CREATE VIRTUAL TABLE chunks_fts USING fts5(
      text, content='chunks', content_rowid='ordinal', tokenize='porter unicode61'
    );
  `);
  const insert = db.prepare(`
    INSERT INTO chunks (ordinal, id, pack_id, text, section, source, page, domain, license_id, block_kind)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  db.exec('BEGIN');
  chunks.forEach((c, i) => {
    insert.run(i, `${packId}:${i}`, packId, c.text, c.section, input.source, c.page, c.domain, input.licenseId, c.blockKind);
  });
  db.exec('COMMIT');
  db.exec("INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')");
  db.exec('VACUUM');
  db.close();
}

export interface WrittenPack {
  readonly dir: string;
  readonly manifest: PackManifest;
}

export async function writePack(
  outDir: string,
  input: PackInput,
  chunks: readonly DraftChunk[],
  vectors: readonly Float32Array[],
): Promise<WrittenPack> {
  if (chunks.length !== vectors.length) {
    throw new Error(`${chunks.length} chunks but ${vectors.length} vectors`);
  }
  const dir = join(outDir, `${input.id}-v${input.version}`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  writeChunkDb(join(dir, 'chunks.sqlite'), input.id, chunks, input);

  const dim = input.embedding.dim;
  const quantized = Buffer.alloc(chunks.length * dim);
  const scales = Buffer.alloc(chunks.length * 4); // fp32 scales; 4 bytes is noise at this size
  vectors.forEach((v, i) => {
    if (v.length !== dim) throw new Error(`vector ${i} has dim ${v.length}, expected ${dim}`);
    const { vec, scale } = quantizeInt8(v);
    Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength).copy(quantized, i * dim);
    scales.writeFloatLE(scale, i * 4);
  });
  await writeFile(join(dir, 'vectors.i8'), quantized);
  await writeFile(join(dir, 'vectors.scale'), scales);

  const files: PackFileEntry[] = [];
  for (const name of ['chunks.sqlite', 'vectors.i8', 'vectors.scale']) {
    files.push({ path: name, ...(await sha256(join(dir, name))) });
  }

  const manifest: PackManifest = {
    schemaVersion: SCHEMA_VERSION,
    id: input.id,
    version: input.version,
    displayName: input.displayName,
    description: input.description,
    domains: input.domains,
    scope: input.scope,
    embedding: input.embedding,
    chunkCount: chunks.length,
    files,
    licenses: input.licenses,
    builtAt: new Date().toISOString(),
    ingestVersion: INGEST_VERSION,
  };
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { dir, manifest };
}
