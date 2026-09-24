/**
 * Free-form answer quality on the real pipeline.
 *
 * M2 scores multiple choice, which constrains output to one token and therefore
 * cannot see whether the model produces usable prose. This runs the actual
 * rag-core path end to end and prints what a user would read.
 */
import { NodePackStore, createNodeBackend } from './node-pack.ts';
import { ask, SYSTEM_PREFIX } from '@fred/rag-core';

const store = new NodePackStore();
const manifest = store.load('packs/core-firstaid-v1.0.0');
const backend = await createNodeBackend({
  embedModelId: manifest.embedding.modelId,
  cosineFloor: manifest.embedding.cosineFloor,
  probe: manifest.embedding.probe,
  queryTemplate: manifest.embedding.queryTemplate,
  genModelPath: process.env.GEN_MODEL ?? `${process.env.HOME}/models/Qwen3-1.7B-Q4_K_M.gguf`,
});
const packs = [{ id: manifest.id, domains: manifest.domains, scope: manifest.scope }];

console.log(`system prompt: ${SYSTEM_PREFIX.length} chars, ${SYSTEM_PREFIX.split('\n').length} lines\n`);

for (const q of [
  'How do I control severe external bleeding?',
  'What are the signs of shock?',
]) {
  const res = await ask(q, { backend, store, packs }, { state: null });
  console.log(`Q: ${q}`);
  if (res.kind !== 'answer') { console.log(`   -> ${res.kind}\n`); continue; }
  console.log(`   context: ${res.diagnostics.tokensAfter} tokens, ${res.citations.length} citations`);
  let out = '';
  for await (const t of res.stream) out += t;
  console.log('   ---\n' + out.trim().split('\n').map((l) => '   ' + l).join('\n') + '\n');
}
await backend.dispose();
store.close();
