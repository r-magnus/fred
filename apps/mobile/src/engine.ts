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
import { DevicePackStore, createDeviceBackend, embedderFilesFor } from './device-pack.ts';

const BASE = Paths.document;
const BASE_PATH = BASE.uri.replace(/^file:\/\//, '').replace(/\/$/, '');

/** Filenames staged into internal storage. See tools/eval/measure-app.sh. */
const MODEL_FILE = 'Qwen3-1.7B-Q4_K_M.gguf';

export type LoadPhase =
  | { readonly phase: 'idle' }
  | { readonly phase: 'packs' }
  | { readonly phase: 'models' }
  | { readonly phase: 'verifying' }
  | { readonly phase: 'ready'; readonly packs: number; readonly chunks: number }
  | { readonly phase: 'failed'; readonly message: string };

export interface Engine {
  /**
   * `signal` aborts generation; see US-07. `previous` is the question just
   * answered and its search score, for a follow-up (docs/plan-memory.md).
   */
  ask(
    question: string,
    state: string | null,
    signal?: AbortSignal,
    previous?: { readonly question: string; readonly topScore: number },
  ): Promise<AskResult>;
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
export async function loadEngine(onPhaseUi: (p: LoadPhase) => void): Promise<Engine> {
  // Every phase is logged as well as shown, so a failed load can be read with
  // `adb logcat -s ReactNativeJS` even when the screen is locked.
  const onPhase = (p: LoadPhase): void => {
    console.log(`[fred] load ${p.phase}${p.phase === 'failed' ? `: ${p.message}` : p.phase === 'ready' ? `: ${p.packs} packs, ${p.chunks} passages` : ''}`);
    onPhaseUi(p);
  };
  const t0 = Date.now();
  try {
    onPhase({ phase: 'packs' });
    const store = new DevicePackStore();
    const manifests: PackManifest[] = [];
    // `.list()` throws when the directory is absent, and a clean install has no
    // packs directory at all — on Android it only ever existed because `adb
    // push` created it as a side effect. Without this check the first thing a
    // user sees is a raw ExpoModulesCore exception about a file called "packs",
    // instead of the sentence below. Found on iOS (docs/results-ios-build.md),
    // but a fresh Android install behaves identically.
    const packsDir = new Directory(BASE, 'packs');
    if (packsDir.exists) {
      for (const entry of packsDir.list()) {
        if (entry instanceof Directory) manifests.push(await store.load(entry, 'chunks.sqlite'));
      }
    }
    if (manifests.length === 0) {
      throw new Error('No knowledge packs installed. Stage them with tools/eval/measure-app.sh.');
    }

    onPhase({ phase: 'models' });
    // The packs say which encoder they were built with; the app follows.
    const files = embedderFilesFor(manifests[0]!.embedding.modelId);
    const backend = await createDeviceBackend({
      modelPath: `${BASE_PATH}/${MODEL_FILE}`,
      embedder: files.kind === 'onnx'
        ? { kind: 'onnx', modelPath: `${BASE_PATH}/${files.model}`, vocabPath: `${BASE_PATH}/${files.vocab}` }
        : { kind: 'gguf', modelPath: `${BASE_PATH}/${files.model}` },
      spec: manifests[0]!.embedding,
    });

    onPhase({ phase: 'verifying' });
    // Every pack carries the same probe sentence, so embed it once, not once
    // per pack: each embedding costs a fresh llama.rn context (device-pack.ts).
    const probes = new Map<string, Promise<Float32Array>>();
    const probeBackend = {
      ...backend,
      embed: (text: string): Promise<Float32Array> => {
        let v = probes.get(text);
        if (v === undefined) { v = backend.embed(text); probes.set(text, v); }
        return v;
      },
    };
    for (const m of manifests) {
      const parity = await verifyEmbedderParity(m.embedding, probeBackend);
      console.log(`[fred] parity ${m.id} cos=${parity.cosine.toFixed(4)} ${parity.ok ? 'ok' : 'FAIL'}`);
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

    console.log(`[fred] engine ready in ${Date.now() - t0}ms, encoder ${manifests[0]!.embedding.modelId}`);
    onPhase({
      phase: 'ready',
      packs: manifests.length,
      chunks: manifests.reduce((n, m) => n + m.chunkCount, 0),
    });

    return {
      ask: async (question, state, signal, previous) => {
        const t0 = Date.now();
        const res = await ask(question, { backend, store, packs }, {
          state,
          // Decide what the hiker wants, not just the topic: casual emergencies
          // open their card, small talk gets a reply (docs/results-intent-probe.md).
          intent: true,
          ...(signal === undefined ? {} : { signal }),
          ...(previous === undefined ? {} : { previous }),
        });
        return timed(res, t0);
      },
      availableStates: () => states,
      release: () => backend.release(),
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    onPhase({ phase: 'failed', message });
    throw e;
  }
}

/**
 * One log line per question, read with `adb logcat -s ReactNativeJS`: time to
 * the retrieval decision, to the first token, and to the last, plus the top
 * sources. This is how on-device latency and retrieval are measured without
 * driving the UI from a harness.
 */
let verbose = false;
/**
 * Also log which passages were used and the answer text. Off by default: a
 * user's questions and answers do not belong in the system log. The app turns
 * it on only in its development mode (the `devhooks` file, App.tsx).
 */
export function setVerboseLogging(on: boolean): void { verbose = on; }

function timed(res: AskResult, t0: number): AskResult {
  const retrievalMs = Date.now() - t0;
  const top = verbose ? res.diagnostics.candidates.slice(0, 4).map((c) => c.chunk.section).join(' | ') : '-';
  // Whether this message was treated as a follow-up, and on what scores.
  const f = res.diagnostics.followUp;
  const mem = f === undefined ? '' : ` followUp=${f.used ? 'yes' : 'no'}(${f.standaloneTopScore.toFixed(3)}/${f.joinedTopScore.toFixed(3)})`;
  // What intent decided, and the card offered folded beside a decline or chat.
  const intent = res.diagnostics.intent === undefined ? '' : ` intent=${res.diagnostics.intent}`;
  const offered = (res.kind === 'abstain' || res.kind === 'chat') && res.offer != null ? ` offer=${JSON.stringify(res.offer.title)}` : '';
  if (res.kind !== 'answer') {
    console.log(`[fred] ${res.kind} retrieval=${retrievalMs}ms U=${res.diagnostics.topScore.toFixed(3)}${mem}${intent}${offered} top=${top}`);
    return res;
  }
  const inner = res.stream;
  async function* stream(): AsyncGenerator<string> {
    let first = 0;
    let chars = 0;
    let text = '';
    for await (const tok of inner) {
      if (first === 0) first = Date.now();
      chars += tok.length;
      if (verbose) text += tok;
      yield tok;
    }
    const end = Date.now();
    if (verbose) console.log(`[fred] text ${JSON.stringify(text.trim())}`);
    console.log(`[fred] answer retrieval=${retrievalMs}ms first=${first === 0 ? -1 : first - t0}ms total=${end - t0}ms chars=${chars} U=${res.diagnostics.topScore.toFixed(3)}${mem} tokens=${res.diagnostics.tokensAfter}${intent} top=${top}`);
  }
  return { ...res, stream: stream() };
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
