/**
 * Ground-truth embedding, via transformers.js: the reference ONNX weights and the
 * real HuggingFace tokenizer.
 *
 * Exists because two llama.cpp wrappers disagreed and "the answers look better"
 * is not evidence. Comparing both against this settled it in one run:
 *
 *   reference (transformers.js) -0.0215,-0.0039, 0.0269,-0.0295, 0.0456, 0.0249
 *   node-llama-cpp (ingest)     -0.0215,-0.0040, 0.0269,-0.0296, 0.0457, 0.0250  match
 *   llama.rn (device)           -0.0361,-0.0032, 0.0317,-0.0053, 0.0299, 0.0116  differs
 *
 * So the index is built correctly and the device runtime is the broken side.
 * Run this whenever an embedding backend is added or upgraded.
 *
 *   node tools/eval/src/reference-embedding.mjs
 */
import { pipeline } from '@huggingface/transformers';
const extractor = await pipeline('feature-extraction', 'Supabase/gte-small', { dtype: 'fp32' });
const TEXT = 'control severe external bleeding';
const out = await extractor(TEXT, { pooling: 'mean', normalize: true });
const v = Array.from(out.data).slice(0, 6);
console.log('REFERENCE (transformers.js, mean pooling, L2 normalized)');
console.log('  head=' + v.map((x) => x.toFixed(4)).join(','));
console.log('  dim=' + out.data.length);
console.log('');
console.log('  harness (node-llama-cpp, normalized) = -0.0215,-0.0040,0.0269,-0.0296,0.0457,0.0250');
console.log('  device  (llama.rn, mean)             = -0.0361,-0.0032,0.0317,-0.0053,0.0299,0.0116');
