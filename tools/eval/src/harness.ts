/**
 * Open the real pipeline for an eval run: packs, embedder, generator, and the
 * parity check. Shared by run-graded.ts and run-conversations.ts, so a single
 * question and a conversation are answered by exactly the same setup.
 *
 * Settings come from the environment (PACKS_DIR, GEN_MODEL, and the retrieval
 * switches in retrieval-env.ts) and are printed, because a results file that
 * does not say how it was produced is not evidence.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { verifyEmbedderParity, type PipelineDeps } from '@fred/rag-core';
import { NodePackStore, createNodeBackend } from './node-pack.ts';
import { compressionFromEnv, describeRetrieval, retrievalFromEnv } from './retrieval-env.ts';

export async function openHarness(): Promise<PipelineDeps & { close(): Promise<void> }> {
  const PACKS = process.env.PACKS_DIR ?? 'packs';
  const genModelPath = process.env.GEN_MODEL ?? `${process.env.HOME}/models/Qwen3-1.7B-Q4_K_M.gguf`;
  const compression = compressionFromEnv();
  console.log(`${describeRetrieval(retrievalFromEnv())} compress=${compression === undefined ? 'off' : 'on'}  model=${genModelPath.split('/').pop()}  packs=${PACKS}`);

  const store = new NodePackStore();
  const manifests = readdirSync(PACKS)
    .map((d) => join(PACKS, d))
    .filter((d) => existsSync(join(d, 'manifest.json')))
    .map((d) => store.load(d));
  if (manifests.length === 0) throw new Error('no packs under packs/; run tools/ingest first');
  const base = manifests[0]!;

  const backend = await createNodeBackend({
    embedModelId: base.embedding.modelId,
    cosineFloor: base.embedding.cosineFloor,
    probe: base.embedding.probe,
    queryTemplate: base.embedding.queryTemplate,
    genModelPath,
  });

  // A parity failure invalidates every number below it, so check before spending
  // an hour of generation rather than discovering it in the results.
  for (const m of manifests) {
    const parity = await verifyEmbedderParity(m.embedding, backend);
    if (!parity.ok) {
      throw new Error(`pack ${m.id}: embedder parity ${parity.cosine.toFixed(4)}, refusing to run`);
    }
  }
  console.log(`${manifests.length} packs, embedder parity OK\n`);

  return {
    backend,
    store,
    packs: manifests.map((m) => ({ id: m.id, domains: m.domains, scope: m.scope })),
    async close() { await backend.dispose(); store.close(); },
  };
}
