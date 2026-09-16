/**
 * Patch onnxruntime-react-native so React Native autolinking finds it.
 *
 * Without this, the app fails at startup with:
 *
 *   [runtime not ready]: TypeError: Cannot read property 'install' of null
 *
 * That error is a JavaScript null, not a native failure. lib/binding.ts does
 * `NativeModules.Onnxruntime.install()`, and NativeModules.Onnxruntime is null
 * because OnnxruntimePackage is never registered: 1.24.3 ships no
 * react-native.config.js, and autolinking skips it because — unlike llama.rn and
 * op-sqlite — it has no codegenConfig, so it is not detected as a native module.
 * `expo-modules-autolinking react-native-config --platform android` lists
 * op-sqlite, expo and llama.rn, and no onnxruntime, which is the direct check.
 *
 * Upstream fixed this in microsoft/onnxruntime#28266, merged 2026-04-30, by
 * adding exactly this file. It has never been released: the newest published
 * version is 1.24.3, from 2026-03-05. This patch is that fix, applied locally
 * until a release carries it.
 *
 * This was previously misdiagnosed in docs/results-m3.md as bridgeless mode
 * removing RCTBridge. That is wrong. ReactContext declares getJSCallInvokerHolder
 * directly and BridgelessReactContext implements it, and RN keeps
 * BridgelessCatalystInstance.getJSCallInvokerHolder specifically for backward
 * compatibility, so the module's JSI install path is fine under the New
 * Architecture. It was never reached, because the module was never registered.
 *
 * Runs from postinstall and is idempotent, so it survives `npm install` rather
 * than living as an untracked edit inside node_modules.
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';

const PKG_DIR = new URL('../node_modules/onnxruntime-react-native/', import.meta.url);
const FILE = new URL('react-native.config.js', PKG_DIR);
const MARKER = 'scripts/patch-onnx-autolink.mjs';
const AUTOLINK_CACHE = new URL('../apps/mobile/android/build/generated/autolinking/', import.meta.url);

const CONTENTS = `// Patched: added locally. See ${MARKER}
// Upstream equivalent: microsoft/onnxruntime#28266 (merged 2026-04-30, unreleased).
module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: './android',
        packageImportPath: 'import ai.onnxruntime.reactnative.OnnxruntimePackage;',
        packageInstance: 'new OnnxruntimePackage()',
      },
    },
  },
};
`;

if (!existsSync(PKG_DIR)) {
  console.log('[patch-onnx-autolink] package not installed; nothing to do');
  process.exit(0);
}

if (existsSync(FILE)) {
  const current = readFileSync(FILE, 'utf8');
  if (current.includes(MARKER)) {
    console.log('[patch-onnx-autolink] already patched');
  } else {
    // A release finally shipped it. Upstream's own file wins; drop this patch.
    console.log('[patch-onnx-autolink] upstream now ships react-native.config.js — leaving it alone; this patch can be retired');
  }
} else {
  writeFileSync(FILE, CONTENTS);
  console.log('[patch-onnx-autolink] wrote react-native.config.js so autolinking registers OnnxruntimePackage');
}

// The Android build caches autolinking output in build/generated/autolinking and
// regenerates it only when package.json or the lockfile changes. Adding
// react-native.config.js inside node_modules changes neither, so a project built
// before this patch keeps a PackageList without OnnxruntimePackage and fails with
// the identical "install of null" error. That is exactly what happened: the first
// APK rebuilt after the patch still shipped libonnxruntime.so but never
// registered the module. A cache that predates the patch is deleted here.
const cacheFile = new URL('autolinking.json', AUTOLINK_CACHE);
if (existsSync(cacheFile) && !readFileSync(cacheFile, 'utf8').includes('"onnxruntime-react-native"')) {
  rmSync(AUTOLINK_CACHE, { recursive: true, force: true });
  console.log('[patch-onnx-autolink] removed stale Android autolinking cache; the next build regenerates PackageList');
}
