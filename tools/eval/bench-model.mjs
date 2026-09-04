/**
 * Desktop inference baseline.
 *
 * Measures load time, TTFT, and decode throughput for a GGUF model using the same
 * llama.cpp build that tools/eval will use for the accuracy ablations. Desktop
 * numbers are NOT a substitute for on-device numbers — they exist to validate the
 * model file, chat template, and prompt format before the phone is involved, and
 * to give a fast iteration loop.
 *
 *   node tools/eval/bench-model.mjs <path-to.gguf> [contextSize]
 */
import { getLlama, LlamaChatSession } from 'node-llama-cpp';

const modelPath = process.argv[2] ?? `${process.env.HOME}/models/Qwen3-0.6B-Q4_K_M.gguf`;
const contextSize = Number(process.argv[3] ?? 2048);

const PROMPT = 'In three short numbered steps, how do you control severe external bleeding?';

const tLoad = Date.now();
const llama = await getLlama();
const model = await llama.loadModel({ modelPath });
const ctx = await model.createContext({ contextSize });
const loadMs = Date.now() - tLoad;

const session = new LlamaChatSession({ contextSequence: ctx.getSequence() });

let ttftMs = null;
let chunks = 0;
const tGen = Date.now();
const answer = await session.prompt(PROMPT, {
  maxTokens: 120,
  onTextChunk: () => {
    chunks++;
    if (ttftMs === null) ttftMs = Date.now() - tGen;
  },
});
const totalMs = Date.now() - tGen;

console.log(JSON.stringify({
  model: modelPath.split('/').pop(),
  contextSize,
  loadMs,
  ttftMs,
  totalMs,
  chunks,
  chunksPerSec: +(chunks / (totalMs / 1000)).toFixed(1),
}, null, 2));
console.log('--- output ---');
console.log(answer.trim().slice(0, 500));
