/**
 * On-device pipeline harness.
 *
 * Began as the M3 memory spike. It now runs the full rag-core path over every
 * installed pack and a fixed set of questions, one per domain, logging route,
 * top citation and timings for each. It is driven from the host over adb
 * (logcat), so it runs on mount rather than waiting for a tap.
 *
 * Packs and models live in internal app storage. Android 15 scoped storage
 * denies the app read access to files adb places in its external directory
 * (they are owned by shell), so files are staged in /data/local/tmp and copied
 * in as the app user:
 *
 *   adb push packs/<id>-v<version>/. /data/local/tmp/fred/packs/<id>/
 *   adb shell run-as dev.fred.app sh -c 'mkdir -p files/packs && cp -r /data/local/tmp/fred/packs/. files/packs/'
 *   adb shell run-as dev.fred.app cp /data/local/tmp/fred/<model file> files/
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Directory, Paths } from 'expo-file-system';
import type { PackManifest } from '@fred/pack-format';
import { ask, verifyEmbedderParity } from '@fred/rag-core';
import { DevicePackStore, createDeviceBackend } from './src/device-pack.ts';

const BASE = Paths.document;
const BASE_PATH = BASE.uri.replace(/^file:\/\//, '').replace(/\/$/, '');
const BUILD_MARKER = 'fred-multipack';
console.log(`[fred] bundle ${BUILD_MARKER} loaded`);

/** One question per installed domain, worded the way the proposal's stories are. */
const QUESTIONS: readonly { readonly q: string; readonly state: string | null }[] = [
  { q: 'How do I control severe external bleeding?', state: null },
  { q: 'How do I build a shelter?', state: null },
  { q: 'A rattlesnake bit my leg, what do I do?', state: null },
  // State-scoped: needs a location, and a flora-fauna pack for that state.
  { q: 'What does poison oak look like?', state: 'CA' },
];

type Stage = { label: string; ms: number; note?: string };

export default function App() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [answer, setAnswer] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const log = (label: string, ms: number, note?: string): void => {
    console.log(`[fred] ${label}: ${ms}ms${note ? ` (${note})` : ''}`);
    setStages((s) => [...s, note === undefined ? { label, ms } : { label, ms, note }]);
  };

  const run = useCallback(async () => {
    setStages([]); setAnswer(''); setError(null); setRunning(true);
    try {
      let t = Date.now();
      const store = new DevicePackStore();
      const manifests: PackManifest[] = [];
      for (const entry of new Directory(BASE, 'packs').list()) {
        if (entry instanceof Directory) manifests.push(await store.load(entry, 'chunks.sqlite'));
      }
      if (manifests.length === 0) throw new Error('no packs under files/packs');
      log('load packs', Date.now() - t, manifests.map((m) => `${m.id}:${m.chunkCount}`).join(' '));

      t = Date.now();
      const backend = await createDeviceBackend({
        modelPath: `${BASE_PATH}/Qwen3-1.7B-Q4_K_M.gguf`,
        embedModelPath: `${BASE_PATH}/gte-small.onnx`,
        embedVocabPath: `${BASE_PATH}/gte-small-vocab.txt`,
        spec: manifests[0]!.embedding,
      });
      log('load models', Date.now() - t, 'SLM + embedder resident');
      console.log(`[fred] gen context ${JSON.stringify(backend.genInfo)}`);

      // Every pack carries its own probe. Matching metadata is not enough: two
      // runtimes can load the same model and still embed differently, which
      // silently returns the wrong chunks with plausible scores.
      for (const m of manifests) {
        t = Date.now();
        const parity = await verifyEmbedderParity(m.embedding, backend);
        log(`parity ${m.id}`, Date.now() - t, `${parity.ok ? 'OK' : 'MISMATCH'} cos=${parity.cosine.toFixed(4)}`);
      }

      const packs = manifests.map((m) => ({ id: m.id, domains: m.domains, scope: m.scope }));
      for (const { q, state } of QUESTIONS) {
        t = Date.now();
        const result = await ask(q, { backend, store, packs }, { state });
        const retrieveMs = Date.now() - t;
        const route = result.diagnostics.route.packIds.join(',') || '-';
        if (result.kind !== 'answer') {
          log(`Q "${q}"`, retrieveMs, `${result.kind}, route ${route}`);
          continue;
        }
        const top = result.diagnostics.candidates[0]?.chunk;
        console.log(`[fred] Q "${q}" state=${state} route=${route} top=${top?.packId} p.${top?.page} ${top?.section}`);
        t = Date.now();
        let first = -1;
        let out = '';
        for await (const tok of result.stream) {
          if (first < 0) first = Date.now() - t;
          out += tok;
          setAnswer(`${q}\n\n${out}`);
        }
        log(`answer "${q}"`, Date.now() - t, `retrieve ${retrieveMs}ms, TTFT ${first}ms`);
        console.log(`[fred] ANSWER(${out.length} chars): ${out.slice(0, 400).replace(/\n/g, ' | ')}`);
      }
      console.log('[fred] RUN DONE');
      await backend.release();
    } catch (e) {
      console.log(`[fred] ERROR ${e instanceof Error ? e.message : String(e)}`);
      console.log(`[fred] STACK ${e instanceof Error ? (e.stack ?? '') : ''}`);
      setError(e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e));
    } finally {
      setRunning(false);
    }
  }, []);

  // Run once on mount. The run is driven and read from the host over adb, and
  // synthetic taps do not reliably reach a Fabric view.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  return (
    <SafeAreaView style={styles.root}>
      <Text style={styles.title}>Fred — pipeline harness</Text>
      <TouchableOpacity style={[styles.button, running && styles.buttonBusy]} onPress={run} disabled={running}>
        <Text style={styles.buttonText}>{running ? 'running…' : 'Run pipeline'}</Text>
      </TouchableOpacity>
      <ScrollView style={styles.body}>
        {stages.map((s, i) => (
          <View key={i} style={styles.row}>
            <Text style={styles.label}>{s.label}</Text>
            <Text style={styles.ms}>{s.ms} ms{s.note ? `  ·  ${s.note}` : ''}</Text>
          </View>
        ))}
        {error !== null && <Text style={styles.error}>{error}</Text>}
        {answer !== '' && <Text style={styles.answer}>{answer}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111', paddingHorizontal: 16, paddingTop: 48 },
  title: { color: '#eee', fontSize: 20, fontWeight: '600', marginBottom: 16 },
  button: { backgroundColor: '#2a6', borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  buttonBusy: { backgroundColor: '#444' },
  buttonText: { color: '#fff', fontWeight: '600' },
  body: { flex: 1, marginTop: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  label: { color: '#9cf', fontFamily: 'monospace', flexShrink: 1 },
  ms: { color: '#ccc', fontFamily: 'monospace' },
  error: { color: '#f77', marginTop: 12, fontFamily: 'monospace', fontSize: 11 },
  answer: { color: '#eee', marginTop: 16, lineHeight: 20 },
});
