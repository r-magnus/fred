/**
 * End-to-end smoke test over a real pack: retrieval only, no generation.
 * Verifies the pack round-trips and that ordinals align chunks with vectors.
 */
import { NodePackStore, createNodeBackend } from './node-pack.ts';
import { extractKeywords, retrieve, route, compressContext, DEFAULT_COMPRESSION } from '@fred/rag-core';

const store = new NodePackStore();
const manifest = store.load('packs/core-firstaid-v1.0.0');
console.log(`pack ${manifest.id} v${manifest.version}: ${manifest.chunkCount} chunks, ` +
  `encoder ${manifest.embedding.modelId} dim ${manifest.embedding.dim} floor ${manifest.embedding.cosineFloor.toFixed(4)}\n`);

const backend = await createNodeBackend({
  embedModelPath: `${process.env.HOME}/models/gte-small_fp16.gguf`,
  embedModelId: manifest.embedding.modelId,
  cosineFloor: manifest.embedding.cosineFloor,
});

const packs = [{ id: manifest.id, domains: manifest.domains, scope: manifest.scope }];

const QUERIES = [
  'How do I control severe external bleeding?',
  'What are the signs of shock?',
  'Someone is choking and cannot speak, what do I do?',
  'How do I make sourdough bread rise properly?',
];

for (const q of QUERIES) {
  const kws = extractKeywords(q);
  const routed = route(kws, packs, { state: null });
  const hits = await retrieve(kws, routed.packIds, store, backend);
  console.log(`Q: ${q}`);
  if (hits.length === 0) { console.log('   (no candidates)\n'); continue; }
  for (const h of hits.slice(0, 3)) {
    console.log(`   U=${h.score.toFixed(3)} cos=${h.cosine.toFixed(3)} (raw ${h.cosineRaw.toFixed(3)}) ` +
      `lex=${h.sLex.toFixed(2)} p.${h.chunk.page} [${h.chunk.blockKind}] ${h.chunk.section.slice(0, 40)}`);
    console.log(`      ${h.chunk.text.replace(/\n/g, ' ').slice(0, 110)}...`);
  }
  const comp = await compressContext(hits.map(h => h.chunk), kws,
    { ...DEFAULT_COMPRESSION, countTokens: (texts) => backend.countTokens(texts) });
  console.log(`   compression: ${comp.tokensBefore} -> ${comp.tokensAfter} tokens (${(comp.reduction*100).toFixed(0)}% cut)\n`);
}

await backend.dispose();
store.close();
