/**
 * M3 memory spike.
 *
 * The question this answers is narrow and specific: does the model, the pack,
 * the embedder and the RN runtime fit inside Android's per-app memory ceiling?
 * M0 measured llama-bench as a native binary under adb shell, which is NOT
 * subject to that ceiling, so PocketRAG §3.1's central constraint is still
 * unvalidated. This is the smallest app that can answer it.
 *
 * Memory is read from outside with `adb shell dumpsys meminfo dev.fred.app`
 * rather than from a native module, so the spike needs no extra native code.
 *
 * Model and pack are pushed to the app's external files directory rather than
 * bundled, keeping the APK small during iteration:
 *   adb push <pack>  /sdcard/Android/data/dev.fred.app/files/pack/
 *   adb push <model> /sdcard/Android/data/dev.fred.app/files/
 */
import { useCallback, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Directory } from 'expo-file-system';
import { ask, type AskResult } from '@fred/rag-core';
import { DevicePackStore, createDeviceBackend } from './src/device-pack.ts';

/**
 * The app-specific external directory, which adb can write to and the app can
 * read without any runtime permission. Internal storage (Paths.document) is not
 * reachable from `adb push`, and copying a 380 MB model in from Downloads on
 * first launch would add minutes to every iteration of this spike.
 *
 *   adb push <pack>  /sdcard/Android/data/dev.fred.app/files/pack/
 *   adb push <model> /sdcard/Android/data/dev.fred.app/files/
 */
const EXTERNAL_FILES = '/storage/emulated/0/Android/data/dev.fred.app/files';
const BASE = new Directory(`file://${EXTERNAL_FILES}`);
const QUESTION = 'How do I control severe external bleeding?';

type Stage = { label: string; ms: number; note?: string };

export default function App() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [answer, setAnswer] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const log = (label: string, ms: number, note?: string): void =>
    setStages((s) => [...s, note === undefined ? { label, ms } : { label, ms, note }]);

  const run = useCallback(async () => {
    setStages([]); setAnswer(''); setError(null); setRunning(true);
    try {
      const packDir = new Directory(BASE, 'pack');
      let t = Date.now();

      const store = new DevicePackStore();
      const manifest = await store.load(packDir, 'chunks.sqlite');
      log('load pack', Date.now() - t, `${manifest.chunkCount} chunks`);

      t = Date.now();
      const backend = await createDeviceBackend({
        modelPath: `${EXTERNAL_FILES}/Qwen3-0.6B-Q4_K_M.gguf`,
        embedModelPath: `${EXTERNAL_FILES}/gte-small_fp16.gguf`,
        spec: manifest.embedding,
      });
      log('load models', Date.now() - t, 'SLM + embedder resident');

      t = Date.now();
      const result: AskResult = await ask(
        QUESTION,
        { backend, store, packs: [{ id: manifest.id, domains: manifest.domains, scope: manifest.scope }] },
        { state: null },
      );
      log('retrieve', Date.now() - t, result.kind);

      if (result.kind === 'answer') {
        t = Date.now();
        let first = -1;
        let out = '';
        for await (const tok of result.stream) {
          if (first < 0) { first = Date.now() - t; log('TTFT', first); }
          out += tok;
          setAnswer(out);
        }
        log('generate total', Date.now() - t, `${result.citations.length} citations`);
      } else {
        setAnswer(`(${result.kind})`);
      }
    } catch (e) {
      setError(e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e));
    } finally {
      setRunning(false);
    }
  }, []);

  return (
    <SafeAreaView style={styles.root}>
      <Text style={styles.title}>Fred — memory spike</Text>
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
  label: { color: '#9cf', fontFamily: 'monospace' },
  ms: { color: '#ccc', fontFamily: 'monospace' },
  error: { color: '#f77', marginTop: 12, fontFamily: 'monospace', fontSize: 11 },
  answer: { color: '#eee', marginTop: 16, lineHeight: 20 },
});
