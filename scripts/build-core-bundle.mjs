/**
 * Assemble the download every phone needs before Fred can answer: the two
 * models and the guides that are the same everywhere (#196).
 *
 * Usage: node scripts/build-core-bundle.mjs [out-root]
 *
 * Like a state bundle (build-state-bundle.mjs) it mirrors the app's Documents
 * directory, so installing it is a copy:
 *
 *   <out-root>/core/
 *     bundle.json
 *     Qwen3-1.7B-Q4_K_M.gguf           writes the answers (apps/mobile/src/engine.ts)
 *     embeddinggemma-300M-Q8_0.gguf    searches the guides (embedderFilesFor)
 *     packs/core-<name>/               every core pack in PACKS_DIR, newest version of each
 *   <out-root>/core-upload/            the same files under their release names
 *   <out-root>/index-core.json         the `core` entry for the maps index
 *
 * The app's setup wizard downloads whatever the index lists under `core`
 * (apps/mobile/src/map-downloads.ts), so publishing is: upload core-upload/ to
 * the maps release, and add index-core.json to index.json as "core".
 *
 * Nothing here publishes anything. Whether these files may be put on a public
 * host is a licensing question first (docs/licensing.md): the packs' own
 * licence entries are copied into bundle.json so it can be answered from one
 * file.
 *
 * PACKS_DIR defaults to packs/, MODELS_DIR to ~/models. Every pack must share
 * one encoder, the one whose file is bundled, or the app refuses to load.
 */
import { createHash } from 'node:crypto';
import { cpSync, createReadStream, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const [outRoot = 'dist'] = process.argv.slice(2);
const ROOT = new URL('..', import.meta.url).pathname;
const PACKS_DIR = process.env.PACKS_DIR ?? join(ROOT, 'packs');
const MODELS_DIR = process.env.MODELS_DIR ?? join(process.env.HOME, 'models');
const GENERATOR = 'Qwen3-1.7B-Q4_K_M.gguf';
// As embedderFilesFor in apps/mobile/src/device-pack.ts.
const ENCODER_FILES = {
  'google/embeddinggemma-300m': ['embeddinggemma-300M-Q8_0.gguf'],
  'Supabase/gte-small': ['gte-small.onnx', 'gte-small-vocab.txt'],
};

// The newest version of each core pack. Directories are "<id>-v<semver>".
const newest = new Map();
for (const d of readdirSync(PACKS_DIR).filter((n) => /^core-.+-v\d/.test(n)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))) {
  const manifest = JSON.parse(readFileSync(join(PACKS_DIR, d, 'manifest.json'), 'utf8'));
  newest.set(manifest.id, { dir: d, manifest });
}
if (newest.size === 0) { console.error(`no core packs in ${PACKS_DIR}`); process.exit(1); }
const encoders = [...new Set([...newest.values()].map((p) => p.manifest.embedding.modelId))];
if (encoders.length !== 1) { console.error(`core packs use different encoders: ${encoders.join(', ')}`); process.exit(1); }
const encoderFiles = ENCODER_FILES[encoders[0]];
if (encoderFiles === undefined) { console.error(`no on-device encoder for ${encoders[0]}`); process.exit(1); }
const models = [GENERATOR, ...encoderFiles];
for (const m of models) {
  if (!existsSync(join(MODELS_DIR, m))) { console.error(`missing model ${join(MODELS_DIR, m)}`); process.exit(1); }
}

const dir = join(outRoot, 'core');
const upload = join(outRoot, 'core-upload');
for (const d of [dir, upload]) rmSync(d, { recursive: true, force: true });
mkdirSync(join(dir, 'packs'), { recursive: true });
mkdirSync(upload, { recursive: true });
// Hard links where the filesystem allows: the models are 1.4 GB.
const place = (src, dest) => { try { linkSync(src, dest); } catch { cpSync(src, dest); } };
for (const m of models) place(join(MODELS_DIR, m), join(dir, m));
// Installed under its id without the version, as the app and stage-phone.sh expect.
// Followed through links: a packs folder may be links to packs built elsewhere.
for (const [id, p] of newest) cpSync(join(PACKS_DIR, p.dir), join(dir, 'packs', id), { recursive: true, dereference: true });

const digest = (algo, path) => new Promise((resolve, reject) => {
  const h = createHash(algo);
  createReadStream(path).on('data', (b) => h.update(b)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
const files = [];
for (const f of walk(dir).sort()) {
  const path = relative(dir, f);
  // Release files have flat names; the state bundles use the same scheme.
  const asset = `core--${path.replaceAll('/', '__')}`;
  place(f, join(upload, asset));
  // The app checks size and MD5 (the phone computes MD5 natively); SHA-256 is for people.
  files.push({ path, asset, bytes: statSync(f).size, sha256: await digest('sha256', f), md5: await digest('md5', f) });
}
const bytes = files.reduce((s, f) => s + f.bytes, 0);

const licences = new Map();
for (const { manifest } of newest.values()) for (const l of manifest.licenses ?? []) licences.set(l.id, l);
const bundle = {
  schemaVersion: 1,
  builtAt: new Date().toISOString(),
  components: {
    generator: { path: GENERATOR },
    encoder: { id: encoders[0], paths: encoderFiles },
    packs: [...newest.values()].map(({ manifest }) => ({ path: `packs/${manifest.id}`, id: manifest.id, version: manifest.version })),
  },
  licenses: [...licences.values()],
  files,
  bytes,
};
writeFileSync(join(dir, 'bundle.json'), JSON.stringify(bundle, null, 2) + '\n');
writeFileSync(join(outRoot, 'index-core.json'), JSON.stringify({ bytes, builtAt: bundle.builtAt, components: bundle.components, missing: [], files }, null, 1) + '\n');
console.log(`core: ${files.length} files, ${(bytes / 1e9).toFixed(2)} GB, ${newest.size} packs, encoder ${encoders[0]}`);
