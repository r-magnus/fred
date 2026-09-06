/**
 * Compare the ONNX embedder against the reference implementation.
 *
 * Run this whenever the tokenizer, pooling, model file or runtime changes. The
 * bug this guards against does not throw: it returns plausible vectors that
 * happen to live in a different space (docs/results-m3.md).
 */
import { loadOnnxEmbedder } from './onnx-embed.ts';

const REFERENCE_HEAD = [-0.0215, -0.0039, 0.0269, -0.0295, 0.0456, 0.0249];

const embedder = await loadOnnxEmbedder(
  `${process.env.HOME}/models/gte-small.onnx`,
  `${process.env.HOME}/models/gte-small-vocab.txt`,
  'Supabase/gte-small',
);

const v = (await embedder.embed(['control severe external bleeding']))[0] as Float32Array;
const head = [...v.slice(0, 6)];

console.log('ours      = ' + head.map((x) => x.toFixed(4)).join(','));
console.log('reference = ' + REFERENCE_HEAD.map((x) => x.toFixed(4)).join(','));

const maxDelta = Math.max(...head.map((x, i) => Math.abs(x - (REFERENCE_HEAD[i] as number))));
console.log(`\ndim=${v.length} cosineFloor=${embedder.spec.cosineFloor.toFixed(4)}`);
console.log(`max component delta vs reference: ${maxDelta.toExponential(2)}`);
console.log(maxDelta < 1e-3 ? 'PARITY OK' : 'PARITY FAILED');

await embedder.dispose();
process.exit(maxDelta < 1e-3 ? 0 : 1);
