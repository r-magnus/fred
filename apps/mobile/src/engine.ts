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
import { Directory, File, Paths } from 'expo-file-system';
import type { PackManifest } from '@fred/pack-format';
import { ask, predictCost, verifyEmbedderParity, warmUp, SAID_AS_MODEL, SCOPE_MODEL, type AskResult, type ReplyCost, type RoutablePack } from '@fred/rag-core';
import { DevicePackStore, createDeviceBackend, embedderFilesFor } from './device-pack.ts';

const BASE = Paths.document;
const BASE_PATH = BASE.uri.replace(/^file:\/\//, '').replace(/\/$/, '');

/** Filenames staged into internal storage. See tools/eval/measure-app.sh. */
export const MODEL_FILE = 'Qwen3-1.7B-Q4_K_M.gguf';

export type LoadPhase =
  | { readonly phase: 'idle' }
  | { readonly phase: 'packs' }
  | { readonly phase: 'models' }
  | { readonly phase: 'verifying' }
  | { readonly phase: 'ready'; readonly packs: number; readonly chunks: number }
  | { readonly phase: 'failed'; readonly message: string };

export interface Engine {
  /** #172: Fred's side of the conversation is on (voice.ts). */
  readonly voice: boolean;
  /**
   * `signal` aborts generation; see US-07. `previous` is the question just
   * answered and its search score, for a follow-up (docs/plan-memory.md).
   * `history` is the hiker's earlier messages, answered or not, oldest first,
   * for the understanding step (#98). `lastCard` is the field card Fred just
   * showed, by title (#101).
   */
  ask(
    question: string,
    state: string | null,
    signal?: AbortSignal,
    previous?: { readonly question: string; readonly topScore: number; readonly chat?: boolean },
    history?: readonly string[],
    lastCard?: string,
  ): Promise<AskResult>;
  /**
   * US-13: whether this message will likely get a written answer or a quick
   * reply, from the search alone, for the battery estimate. Its search vector
   * is kept, so sending the same words does not make it again.
   */
  predict(question: string, state: string | null): Promise<ReplyCost>;
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
      throw new Error('Fred\u2019s guides aren\u2019t on this phone yet.');
    }

    onPhase({ phase: 'models' });
    // The packs say which encoder they were built with; the app follows.
    const files = embedderFilesFor(manifests[0]!.embedding.modelId);
    const backend = await createDeviceBackend({
      modelPath: `${BASE_PATH}/${MODEL_FILE}`,
      sessionDir: BASE_PATH,
      embedder: files.kind === 'onnx'
        ? { kind: 'onnx', modelPath: `${BASE_PATH}/${files.model}`, vocabPath: `${BASE_PATH}/${files.vocab}` }
        : { kind: 'gguf', modelPath: `${BASE_PATH}/${files.model}` },
      spec: manifests[0]!.embedding,
      // Field test only: a `devhooks-gpu` file beside `devhooks` (written by
      // adb run-as on a debuggable build) offloads the generator to the GPU,
      // to re-test the offload results-m3.md turned off.
      ...(new File(Paths.document, 'devhooks').exists && new File(Paths.document, 'devhooks-gpu').exists ? { gpuLayers: 99 } : {}),
    });
    console.log(`[fred] generator ${JSON.stringify(backend.genInfo)}`);

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
    // #133: the first time, read the intent and understanding prompts now, in
    // the background, so the first question (an emergency, perhaps) doesn't
    // pay for it; a question asked meanwhile waits its turn. Once their
    // prompts are saved (device-pack.ts), later launches have nothing to warm.
    const saved = BASE.list().map((f) => f.name);
    const warm = ['intent', 'understand'].every((lane) => saved.some((n) => n.startsWith(`lane-${lane}-`)));
    const tw = Date.now();
    if (warm) console.log('[fred] warm-up not needed: lane prompts saved');
    else void warmUp(backend).then(
      () => console.log(`[fred] warm-up done in ${Date.now() - tw}ms`),
      (e: unknown) => console.log(`[fred] warm-up failed: ${e instanceof Error ? e.message : String(e)}`),
    );
    onPhase({
      phase: 'ready',
      packs: manifests.length,
      chunks: manifests.reduce((n, m) => n + m.chunkCount, 0),
    });

    // #152: the message the card matcher last took as a pet's, so a follow-up
    // that only says "its bleeding" is still about the dog.
    let petMessage: string | undefined;
    // US-13: the estimate searches while the hiker is still typing; the vector
    // it made is kept for the send that follows (an embedding costs ~0.7 s).
    const vectors = new Map<string, Promise<Float32Array>>();
    const remembering = {
      ...backend,
      embed: (text: string): Promise<Float32Array> => {
        let v = vectors.get(text);
        if (v === undefined) {
          v = backend.embed(text);
          vectors.set(text, v);
          v.catch(() => vectors.delete(text));
          if (vectors.size > 4) vectors.delete(vectors.keys().next().value!);
        }
        return v;
      },
    };
    // #172: Fred's side of the conversation (voice.ts). Field test: a
    // `devhooks-no-voice` file beside `devhooks` turns it off.
    const voice = !(new File(Paths.document, 'devhooks').exists && new File(Paths.document, 'devhooks-no-voice').exists);
    return {
      predict: (question, state) => predictCost(question, { backend: remembering, store, packs }, { state, saidAs: SAID_AS_MODEL }),
      voice,
      ask: async (question, state, signal, previous, history, lastCard) => {
        const t0 = Date.now();
        const previousWasPet = petMessage !== undefined && history?.at(-1) === petMessage;
        const res = await ask(question, { backend: remembering, store, packs }, {
          state,
          // Decide what the hiker wants, not just the topic: casual emergencies
          // open their card, small talk gets a reply (docs/results-intent-probe.md).
          intent: true,
          // A friendly opening line before a model-written answer (#130).
          // Field test: a `devhooks-no-opener` file beside `devhooks` turns it
          // off, to time answers with and without it.
          opener: !(new File(Paths.document, 'devhooks').exists && new File(Paths.document, 'devhooks-no-opener').exists),
          voice,
          // A last chance for a message about to be called small talk or
          // declined (#149, docs/results-scope-scorer.md). Field test: a
          // `devhooks-no-scope` file beside `devhooks` turns it off.
          ...(new File(Paths.document, 'devhooks').exists && new File(Paths.document, 'devhooks-no-scope').exists ? {} : { scope: SCOPE_MODEL }),
          // Which card a message is about, by example (#152,
          // docs/results-said-as.md). Field test: a `devhooks-no-said` file
          // beside `devhooks` turns it off.
          ...(new File(Paths.document, 'devhooks').exists && new File(Paths.document, 'devhooks-no-said').exists ? {} : { saidAs: SAID_AS_MODEL }),
          ...(previousWasPet ? { previousWasPet } : {}),
          ...(signal === undefined ? {} : { signal }),
          ...(previous === undefined ? {} : { previous }),
          ...(history === undefined || history.length === 0 ? {} : { history }),
          ...(lastCard === undefined ? {} : { lastCard }),
        });
        petMessage = res.diagnostics.said?.pet === true ? question : undefined;
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
  // The understanding step (#98): whether it ran, and whether its search was kept.
  const u = res.diagnostics.understood;
  const understood = u === undefined ? '' : ` understood=${u.used ? 'used' : 'unused'}${verbose ? `(${JSON.stringify(u.request)})` : ''}`;
  const reason = res.kind === 'abstain' ? ` reason=${res.reason}` : '';
  // Round 2 of #98: conditions in the conversation, a card held back, two searches agreeing.
  const d = res.diagnostics;
  const guards = `${d.scope === undefined || d.scope.used.length === 0 ? '' : ` scope=${d.scope.used.join('+')}`}${d.said === undefined || (d.said.used.length === 0 && !d.said.pet) ? '' : ` said=${[...d.said.used, ...(d.said.pet ? ['pet'] : [])].join('+')}`}${d.everyday === undefined ? '' : ' everyday'}${d.conditions === undefined ? '' : ` conditions=${d.conditions.join(',')}`}${d.blocked === undefined ? '' : ` blocked=${JSON.stringify(d.blocked.card)}`}${d.agreedCard === undefined ? '' : ` agreed=${JSON.stringify(d.agreedCard)}`}`;
  const tm = res.diagnostics.timing;
  const timing = tm === undefined ? '' : ` model=${tm.modelMs}ms embed=${tm.embedMs}ms`;
  if (res.kind !== 'answer') {
    // #172: what Fred says, for the phone check of the conversation lines.
    const said = res.kind === 'chat' ? res.reply : res.kind === 'abstain' ? [res.lead, res.decline?.text, res.decline?.hint].filter((x) => x !== undefined).join(' / ') : '';
    if (verbose && said !== '') console.log(`[fred] text ${JSON.stringify(said)}`);
    console.log(`[fred] ${res.kind} retrieval=${retrievalMs}ms U=${res.diagnostics.topScore.toFixed(3)}${mem}${intent}${understood}${guards}${reason}${offered}${timing} top=${top}`);
    return res;
  }
  const inner = res.stream;
  const opener = res.opener;
  async function* stream(): AsyncGenerator<string> {
    let first = 0;
    let chars = 0;
    let text = '';
    // #130: with an opening line, the answer's own first words come after it.
    let answerFirst = 0;
    let seen = 0;
    for await (const tok of inner) {
      if (first === 0) first = Date.now();
      else if (answerFirst === 0 && opener?.text != null && seen === 1) answerFirst = Date.now();
      seen++;
      chars += tok.length;
      if (verbose) text += tok;
      yield tok;
    }
    const end = Date.now();
    if (verbose) console.log(`[fred] text ${JSON.stringify(text.trim())}`);
    console.log(`[fred] answer retrieval=${retrievalMs}ms first=${first === 0 ? -1 : first - t0}ms total=${end - t0}ms${opener === undefined ? '' : opener.text == null ? ' opener=none' : ` opener=yes answerFirst=${answerFirst === 0 ? -1 : answerFirst - t0}ms`} chars=${chars} U=${res.diagnostics.topScore.toFixed(3)}${mem} tokens=${res.diagnostics.tokensAfter}${intent}${understood}${guards}${timing} top=${top}`);
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
