import { getLlama } from 'node-llama-cpp';
import { extractKeywords } from '@fred/rag-core';
const llama = await getLlama();
const model = await llama.loadModel({ modelPath: `${process.env.HOME}/models/gte-small_fp16.gguf` });
const ctx = await model.createEmbeddingContext();
// retrieve() embeds the joined keyword terms, not the raw question.
const text = extractKeywords('How do I control severe external bleeding?').map((k) => k.term).join(' ');
const v = Float32Array.from((await ctx.getEmbeddingFor(text)).vector);
let n = 0; for (const x of v) n += x * x;
console.log(`DESKTOP embed text="${text}"`);
console.log(`  dim=${v.length} norm=${Math.sqrt(n).toFixed(4)} head=${[...v.slice(0,6)].map(x=>x.toFixed(4)).join(',')}`);
