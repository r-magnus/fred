/**
 * Patch onnxruntime-react-native for Gradle 9.
 *
 * Its android/build.gradle calls org.gradle.util.VersionNumber, an internal API
 * Gradle removed in 9.x, and Expo SDK 57 ships Gradle 9.3.1. The build fails at
 * configuration time with:
 *
 *   Could not get unknown property 'VersionNumber'
 *
 * The call sites only distinguish React Native older than 0.71, to add fbjni
 * headers. This project is on 0.86, so the branch is dead either way; the patch
 * replaces the version parse with a plain minor-version comparison.
 *
 * Runs from postinstall and is idempotent, so it survives `npm install` rather
 * than living as an untracked edit inside node_modules.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const FILE = new URL('../node_modules/onnxruntime-react-native/android/build.gradle', import.meta.url);
const NEEDLE = 'if (VersionNumber.parse(REACT_NATIVE_VERSION) < VersionNumber.parse("0.71")) {';
const REPLACEMENT = [
  '// Patched: Gradle 9 removed VersionNumber. See scripts/patch-onnx-gradle.mjs',
  '  def rnMinorMatch = (REACT_NATIVE_VERSION =~ /^\\d+\\.(\\d+)/)',
  '  def rnMinor = rnMinorMatch ? (rnMinorMatch[0][1] as int) : 99',
  '  if (rnMinor < 71) {',
].join('\n  ');

if (!existsSync(FILE)) {
  console.log('[patch-onnx-gradle] package not installed; nothing to do');
  process.exit(0);
}
const src = readFileSync(FILE, 'utf8');
if (!src.includes(NEEDLE)) {
  console.log(
    src.includes('scripts/patch-onnx-gradle.mjs')
      ? '[patch-onnx-gradle] already patched'
      : '[patch-onnx-gradle] pattern not found — upstream may have fixed it; verify the build',
  );
  process.exit(0);
}
writeFileSync(FILE, src.replace(NEEDLE, REPLACEMENT));
console.log('[patch-onnx-gradle] applied Gradle 9 compatibility patch');
