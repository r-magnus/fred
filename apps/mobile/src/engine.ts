/**
 * The engine: packs and models, loaded once and kept resident.
 *
 * Split out of App.tsx, which loaded everything, asked four fixed questions and
 * then released the backend. That is the right shape for a measurement spike and
 * the wrong one for an app — model load is the single most expensive thing Fred
 * does (1.8 s on device) and must not happen per question.
 *
 * Deliberately free of React. The UI layer subscribes to load progress and calls
 * ask(); nothing here knows about components, which keeps the pipeline testable
 * from the eval harness and the app alike.
 */
import { Directory, Paths } from 'expo-file-system';
import type { PackManifest } from '@fred/pack-format';
import { ask, verifyEmbedderParity, type AskResult, type RoutablePack } from '@fred/rag-core';
import { DevicePackStore, createDeviceBackend } from './device-pack.ts';

const BASE = Paths.document;
const BASE_PATH = BASE.uri.replace(/^file:\/\//, '').replace(/\/$/, '');

/** Filenames staged into internal storage. See tools/eval/measure-app.sh. */
const MODEL_FILE = 'Qwen3-1.7B-Q4_K_M.gguf';
const EMBED_MODEL_FILE = 'gte-small.onnx';
const EMBED_VOCAB_FILE = 'gte-small-vocab.txt';

export type LoadPhase =
  | { readonly phase: 'idle' }
  | { readonly phase: 'packs' }
  | { readonly phase: 'models' }
  | { readonly phase: 'verifying' }
  | { readonly phase: 'ready'; readonly packs: number; readonly chunks: number }
  | { readonly phase: 'failed'; readonly message: string };

export interface Engine {
  /** `signal` aborts generation; see US-07. */
  ask(question: string, state: string | null, signal?: AbortSignal): Promise<AskResult>;
  /** States with a flora-fauna pack installed, for the location picker. */
  availableStates(): readonly string[];
  release(): Promise<void>;
}

/**
 * Parity is checked at load, not skipped for speed.
 *
 * Two runtimes can load the same encoder, agree on every piece of metadata, and
 * still produce different vectors — which returns the wrong chunks with entirely
 * plausible scores and throws nothing. That cost this project days once
 * (docs/results-m3.md), so a mismatch fails the load loudly instead of letting
 * the app run subtly wrong.
 */
export async function loadEngine(onPhase: (p: LoadPhase) => void): Promise<Engine> {
  try {
    onPhase({ phase: 'packs' });
    const store = new DevicePackStore();
    const manifests: PackManifest[] = [];
    // A fresh install has no packs/ at all, and list() throws on a missing
    // directory — which would bury the message below under an UnexpectedException.
    const packsDir = new Directory(BASE, 'packs');
    for (const entry of packsDir.exists ? packsDir.list() : []) {
      if (entry instanceof Directory) manifests.push(await store.load(entry, 'chunks.sqlite'));
    }
    if (manifests.length === 0) {
      throw new Error('No knowledge packs installed. Stage them with tools/eval/measure-app.sh.');
    }

    onPhase({ phase: 'models' });
    const backend = await createDeviceBackend({
      modelPath: `${BASE_PATH}/${MODEL_FILE}`,
      embedModelPath: `${BASE_PATH}/${EMBED_MODEL_FILE}`,
      embedVocabPath: `${BASE_PATH}/${EMBED_VOCAB_FILE}`,
      spec: manifests[0]!.embedding,
    });

    onPhase({ phase: 'verifying' });
    for (const m of manifests) {
      const parity = await verifyEmbedderParity(m.embedding, backend);
      if (!parity.ok) {
        await backend.release();
        throw new Error(
          `Pack "${m.id}" was built with a different encoder (cos ${parity.cosine.toFixed(4)}). ` +
          'Re-stage the packs and the ONNX model together.',
        );
      }
    }

    const packs: RoutablePack[] = manifests.map((m) => ({ id: m.id, domains: m.domains, scope: m.scope }));
    const states = manifests
      .filter((m) => m.scope.kind === 'us-state')
      .map((m) => (m.scope as { state: string }).state)
      .sort();

    onPhase({
      phase: 'ready',
      packs: manifests.length,
      chunks: manifests.reduce((n, m) => n + m.chunkCount, 0),
    });

    return {
      ask: (question, state, signal) =>
        ask(question, { backend, store, packs }, signal ? { state, signal } : { state }),
      availableStates: () => states,
      release: () => backend.release(),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    onPhase({ phase: 'failed', message });
    throw e;
  }
}

/** Human-readable label for the loading screen. */
export function describePhase(p: LoadPhase): string {
  switch (p.phase) {
    case 'idle': return 'Starting…';
    case 'packs': return 'Opening knowledge packs…';
    case 'models': return 'Loading the model…';
    case 'verifying': return 'Checking the packs match the model…';
    case 'ready': return `${p.packs} packs, ${p.chunks.toLocaleString()} passages`;
    case 'failed': return p.message;
  }
}
