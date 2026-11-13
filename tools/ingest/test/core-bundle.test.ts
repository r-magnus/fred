import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// scripts/build-core-bundle.mjs with COMMERCIAL=1 leaves nonCommercial packs
// out, and refuses when one of them is the field cards (#33, #214).
const SCRIPT = new URL('../../../scripts/build-core-bundle.mjs', import.meta.url).pathname;
const ENCODER = { modelId: 'google/embeddinggemma-300m' };

function fixture(cardsNonCommercial: boolean): { root: string; packs: string; models: string } {
  const root = mkdtempSync(join(tmpdir(), 'core-bundle-'));
  const packs = join(root, 'packs');
  const models = join(root, 'models');
  mkdirSync(models, { recursive: true });
  for (const m of ['Qwen3-1.7B-Q4_K_M.gguf', 'embeddinggemma-300M-Q8_0.gguf']) writeFileSync(join(models, m), 'model');
  const pack = (id: string, nonCommercial: boolean): void => {
    const dir = join(packs, `${id}-v1.0.0`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ id, version: '1.0.0', embedding: ENCODER, licenses: [{ id: `${id}-src`, nonCommercial }] }));
    writeFileSync(join(dir, 'chunks.sqlite'), id);
  };
  pack('core-firstaid', true);
  pack('core-firstaid-army', false);
  pack('core-fieldcards', cardsNonCommercial);
  return { root, packs, models };
}

function build(f: { root: string; packs: string; models: string }, commercial: boolean) {
  const out = join(f.root, 'dist');
  const r = spawnSync(process.execPath, [SCRIPT, out], {
    env: { ...process.env, PACKS_DIR: f.packs, MODELS_DIR: f.models, COMMERCIAL: commercial ? '1' : '' }, encoding: 'utf8',
  });
  const bundle = r.status === 0 ? JSON.parse(readFileSync(join(out, 'core', 'bundle.json'), 'utf8')) : null;
  return { status: r.status, output: r.stdout + r.stderr, ids: bundle?.components.packs.map((p: { id: string }) => p.id).sort() as string[] | undefined, bundle };
}

test('a free build keeps nonCommercial packs and names them', () => {
  const f = fixture(true);
  try {
    const r = build(f, false);
    assert.equal(r.status, 0, r.output);
    assert.deepEqual(r.ids, ['core-fieldcards', 'core-firstaid', 'core-firstaid-army']);
    assert.equal(r.bundle.commercial, false);
    assert.match(r.output, /free release only: .*core-firstaid/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('a commercial build refuses while the field cards are nonCommercial', () => {
  const f = fixture(true);
  try {
    const r = build(f, true);
    assert.equal(r.status, 1);
    assert.match(r.output, /commercial build refused: core-fieldcards/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('a commercial build leaves nonCommercial packs out and keeps the rest', () => {
  const f = fixture(false);
  try {
    const r = build(f, true);
    assert.equal(r.status, 0, r.output);
    assert.deepEqual(r.ids, ['core-fieldcards', 'core-firstaid-army']);
    assert.equal(r.bundle.commercial, true);
    assert.ok(r.bundle.licenses.every((l: { nonCommercial: boolean }) => l.nonCommercial !== true));
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
