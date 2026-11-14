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
 * Files over PART_MB (default 100) are also cut into pieces, `<asset>.p000`,
 * `.p001`..., listed under the file's `parts` with their own size and MD5, so
 * a phone that loses its connection resumes from the last whole piece (#198).
 * The whole file is still uploaded beside its pieces. RELEASE (default
 * core-YYYY-MM) names the release the files go in; the core entry carries that
 * release's download address, so it can live apart from the maps release.
 *
 * Nothing here publishes anything. Whether these files may be put on a public
 * host is a licensing question first (docs/licensing.md): the packs' own
 * licence entries are copied into bundle.json so it can be answered from one
 * file.
 *
 * PACKS_DIR defaults to packs/, MODELS_DIR to ~/models. Every pack must share
 * one encoder, the one whose file is bundled, or the app refuses to load.
 *
 * COMMERCIAL=1 builds a bundle that may be sold or used commercially: every
 * pack with a nonCommercial licence entry (WHO BEC, docs/licensing.md) is left
 * out and listed. The field cards are the one pack Fred cannot do without; if
 * they are nonCommercial (a card still quotes WHO, #214) the build refuses
 * rather than ship a Fred without them. Without COMMERCIAL the bundle is for a
 * free release, and the nonCommercial packs in it are listed as a reminder.
 */
import { createHash } from 'node:crypto';
import { closeSync, cpSync, createReadStream, existsSync, linkSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
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

// Packs Fred cannot answer well without; a commercial build refuses rather than drop one.
const REQUIRED = ['core-fieldcards'];
const commercial = process.env.COMMERCIAL === '1';
const nonCommercial = [...newest.values()].filter(({ manifest }) => (manifest.licenses ?? []).some((l) => l.nonCommercial === true));
const ncNames = (ps) => ps.map(({ manifest }) => `${manifest.id} (${manifest.licenses.filter((l) => l.nonCommercial === true).map((l) => l.id).join(', ')})`).join('; ');
if (commercial) {
  const blocking = nonCommercial.filter(({ manifest }) => REQUIRED.includes(manifest.id));
  if (blocking.length > 0) {
    console.error(`commercial build refused: ${ncNames(blocking)} ${blocking.length === 1 ? 'is' : 'are'} nonCommercial and required. Re-back the WHO quotes first (#214).`);
    process.exit(1);
  }
  for (const { manifest } of nonCommercial) newest.delete(manifest.id);
  if (nonCommercial.length > 0) console.log(`commercial: left out ${ncNames(nonCommercial)}`);
} else if (nonCommercial.length > 0) {
  console.log(`free release only: ${ncNames(nonCommercial)} ${nonCommercial.length === 1 ? 'is' : 'are'} nonCommercial (COMMERCIAL=1 leaves them out)`);
}
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

// Licence texts and the notice the models' terms require (#198): Gemma's Terms
// of Use 3.1 asks for a copy of the terms and a Notice file with its exact
// sentence; Apache-2.0 (Qwen3) for a copy of the licence. The notice also
// credits every source in the packs, from their licence entries.
mkdirSync(join(dir, 'licenses'), { recursive: true });
for (const n of readdirSync(join(ROOT, 'licenses'))) cpSync(join(ROOT, 'licenses', n), join(dir, 'licenses', n));
const packLicences = new Map();
for (const { manifest } of newest.values()) for (const l of manifest.licenses ?? []) packLicences.set(l.id, l);
writeFileSync(join(dir, 'licenses', 'NOTICE.txt'), [
  'Fred: models and guides',
  '',
  'Gemma is provided under and subject to the Gemma Terms of Use found at ai.google.dev/gemma/terms',
  `  ${encoderFiles.join(', ')}: Google EmbeddingGemma 300M, unmodified. Terms: GEMMA-TERMS-OF-USE.txt.`,
  '  Its use is subject to the Gemma Prohibited Use Policy (GEMMA-PROHIBITED-USE-POLICY.txt), which binds everyone who uses Fred.',
  '',
  `${GENERATOR}: Qwen3-1.7B (Alibaba Qwen team), Apache License 2.0 (APACHE-2.0.txt), unmodified.`,
  '',
  'Guides, with their sources:',
  ...[...packLicences.values()].map((l) => `- ${l.attribution} [${l.license}]${l.nonCommercial ? ' Non-commercial use only.' : ''}`),
  '',
].join('\n'));

const digest = (algo, path) => new Promise((resolve, reject) => {
  const h = createHash(algo);
  createReadStream(path).on('data', (b) => h.update(b)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
const PART_BYTES = Number(process.env.PART_MB ?? 100) * 1024 * 1024;
const now = new Date();
const RELEASE = process.env.RELEASE ?? `core-${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
const BASE_URL = `https://github.com/r-magnus/fred-maps/releases/download/${RELEASE}/`;
/** Cut `src` into PART_BYTES pieces named `<dest>.pNNN`; returns their names in order. */
const cut = (src, dest) => {
  const size = statSync(src).size;
  const names = [];
  const fd = openSync(src, 'r');
  const buf = Buffer.alloc(8 * 1024 * 1024);
  try {
    for (let start = 0, i = 0; start < size; start += PART_BYTES, i++) {
      const name = `${dest}.p${String(i).padStart(3, '0')}`;
      const out = openSync(name, 'w');
      try {
        for (let at = start, end = Math.min(size, start + PART_BYTES); at < end;) {
          const n = readSync(fd, buf, 0, Math.min(buf.length, end - at), at);
          writeSync(out, buf, 0, n);
          at += n;
        }
      } finally { closeSync(out); }
      names.push(name);
    }
  } finally { closeSync(fd); }
  return names;
};
const files = [];
for (const f of walk(dir).sort()) {
  const path = relative(dir, f);
  // Release files have flat names; the state bundles use the same scheme.
  const asset = `core--${path.replaceAll('/', '__')}`;
  place(f, join(upload, asset));
  // The app checks size and MD5 (the phone computes MD5 natively); SHA-256 is for people.
  const entry = { path, asset, bytes: statSync(f).size, sha256: await digest('sha256', f), md5: await digest('md5', f) };
  if (entry.bytes > PART_BYTES) {
    entry.parts = [];
    for (const p of cut(f, join(upload, asset))) entry.parts.push({ asset: relative(upload, p), bytes: statSync(p).size, md5: await digest('md5', p) });
  }
  files.push(entry);
}
const bytes = files.reduce((s, f) => s + f.bytes, 0);

const licences = new Map();
for (const { manifest } of newest.values()) for (const l of manifest.licenses ?? []) licences.set(l.id, l);
const bundle = {
  schemaVersion: 1,
  builtAt: new Date().toISOString(),
  commercial,
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
writeFileSync(join(outRoot, 'index-core.json'), JSON.stringify({ bytes, builtAt: bundle.builtAt, release: RELEASE, baseUrl: BASE_URL, components: bundle.components, missing: [], files }, null, 1) + '\n');
console.log(`core (${RELEASE}): ${files.length} files, ${files.reduce((a, f) => a + (f.parts?.length ?? 0), 0)} pieces, ${(bytes / 1e9).toFixed(2)} GB, ${newest.size} packs, encoder ${encoders[0]}`);
