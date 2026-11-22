// download.onnxruntime.ai, where the onnxruntime-c pod normally downloads
// from, began serving the wrong TLS certificate on 2026-11-22, and EAS
// builds failed at Install pods. This plugin points onnxruntime-c at
// pods/onnxruntime-c.podspec.json instead. That podspec takes the same
// 1.30.0 iOS xcframework from Microsoft's NuGet package, pinned by sha256.
// Build 14 also used onnxruntime-c 1.30.0.
// Remove this plugin once the official download works again, or when
// upgrading onnxruntime.
const { withPodfile } = require('expo/config-plugins');

const MARK = '# fred: onnxruntime-c from NuGet';
const LINE = `  ${MARK}\n  pod 'onnxruntime-c', :podspec => File.join(__dir__, '..', 'pods', 'onnxruntime-c.podspec.json')\n`;

module.exports = function withOnnxruntimeNuget(config) {
  return withPodfile(config, (cfg) => {
    const src = cfg.modResults.contents;
    if (src.includes(MARK)) return cfg;
    const anchor = /^\s*use_expo_modules!.*$/m;
    if (!anchor.test(src)) {
      throw new Error('with-onnxruntime-nuget: use_expo_modules! not found in the Podfile');
    }
    cfg.modResults.contents = src.replace(anchor, (m) => `${m}\n${LINE}`);
    return cfg;
  });
};
