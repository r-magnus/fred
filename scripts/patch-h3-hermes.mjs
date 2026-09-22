/**
 * Stop h3-js killing the app on Hermes.
 *
 * h3-js is Emscripten-compiled, and its runtime preamble opens with:
 *
 *   var UTF16Decoder = typeof TextDecoder !== "undefined"
 *     ? new TextDecoder("utf-16le") : undefined;
 *
 * Hermes ships TextDecoder but does not support the utf-16le encoding, so the
 * constructor throws RangeError while the module is still loading — before any
 * application code runs. The app starts and dies in under a second with no
 * JavaScript error surfaced, no Java stack and no crash log; the only evidence
 * is a SIGABRT tombstone carrying the JS stack in its abort message. That cost
 * most of a morning to find, which is why this comment is long.
 *
 * The decoder is safe to remove: it is assigned once in the whole bundle and
 * never read. H3 returns cell ids as UTF-8 strings, so nothing reaches the
 * UTF-16 path. This patch asserts that before touching anything, and refuses
 * if a future h3-js starts using it.
 *
 * Runs from postinstall and is idempotent, following patch-onnx-gradle.mjs.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIST = new URL('../node_modules/h3-js/dist/', import.meta.url);
const MARK = '/*hermes-patched*/';
// Match the expression, not a whole line: h3-js ships minified and unminified
// builds whose spacing differs, and one names the variable differently. An
// exact-line match silently skipped two files and left the crash in place.
const EXPR = /new TextDecoder\("utf-16le"\)/g;

if (!existsSync(DIST)) {
  console.log('[patch-h3-hermes] h3-js not installed; nothing to do');
  process.exit(0);
}

/**
 * Every build under dist/, because which one the bundler picks is not obvious:
 * h3-js declares main, module and a `browser` field remapping both entries.
 *
 * Replacing the expression with undefined is safe because Emscripten always
 * guards its UTF-16 path with `if (UTF16Decoder)` and falls back to a manual
 * loop. H3 returns cell ids as UTF-8, so that path is not reached anyway.
 */
const files = [];
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.endsWith('.js')) files.push(full);
  }
};
walk(new URL(DIST).pathname);

let patched = 0, clean = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  if (!EXPR.test(src)) { if (src.includes(MARK)) clean++; continue; }
  EXPR.lastIndex = 0;
  writeFileSync(f, src.replace(EXPR, `undefined${MARK}`), 'utf8');
  patched++;
}
console.log(`[patch-h3-hermes] patched ${patched} file(s), ${clean} already done`);
