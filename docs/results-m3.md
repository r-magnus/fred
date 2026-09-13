# M3 — The pipeline inside the Android app sandbox

**Device:** Nothing Phone (3), SM8735 (Snapdragon 8s Gen 4), Android 15, 12 GB RAM
**Build:** Expo SDK 57 debug APK, llama.rn 0.12.9, op-sqlite 18.1.4 (FTS5 on)
**Model:** Qwen3-0.6B-Q4_K_M · **Encoder:** gte-small fp16 · **Pack:** 611 chunks

M0 measured `llama-bench` as a native binary under `adb shell`, which is not
subject to Android's per-app limits. This is the same pipeline running inside the
app process, driving the full `rag-core` path: FTS5 Stage 1, INT8 semantic
re-rank, compression, prompt build, generation.

## It fits

| | |
|---|---|
| **TOTAL PSS** | **860 MB** |
| TOTAL RSS | 983 MB |
| Native heap | 518 MB (model weights + KV) |
| Java heap | 27 MB |
| `dalvik.vm.heapgrowthlimit` | 256 MB |
| `dalvik.vm.heapsize` | 512 MB |

**The paper's framing of a "2 GB per-application memory ceiling" (§3.1) conflates
two different limits.** The Dalvik cap on this device is 256 MB, and the app is
nowhere near it (27 MB) — because a GGUF model loaded through JNI is allocated
*natively*, outside the managed heap entirely. Native memory is bounded by device
RAM and the low-memory killer, not by `heapgrowthlimit`.

So the constraint is real but it is not the constraint described. Budgeting
against the Dalvik cap would wrongly conclude a 0.6B model cannot load; budgeting
against total RSS is the meaningful test, and at 983 MB there is substantial room
on a 12 GB device. **A 1B–1.7B model is affordable**, consistent with the vector
index arithmetic in `docs/results-m1.md`.

## Stage timings

| Stage | Time |
|---|---|
| Load pack (611 chunks, SQLite + 230 KB vectors) | **37 ms** |
| Load models (SLM + embedder) | 4,652 ms |
| **Retrieve** (FTS5 + INT8 re-rank + compression) | **159 ms** |
| **TTFT** (1,095-token prompt) | **2,402 ms** |

**Retrieval is not the bottleneck.** The complete hybrid pipeline over 611 chunks
costs 159 ms against 2,402 ms of prefill — about 6%. Every optimization that
matters is on the inference side.

**M0's projection was accurate.** `llama-bench` measured 420 t/s prefill, which
predicts 1095 / 420 ≈ 2.6 s for this prompt. Measured in-app: 2.4 s. The native
benchmark was a sound proxy for speed, which is the thing it was chosen to test.

## Finding: KV cache quantization produces incoherent output

PocketRAG §3.4.3 applies 8-bit KV cache quantization. Configured as the paper
describes — `cache_type_k/v: 'q8_0'` with `flash_attn: true` — llama.rn on this
device produced not degraded answers but **word salad**:

> `inform. URL. '; URAIN. PRORPURINATION. ULONG. FUNCTION. TURRAIN. VURTRUMAN. WARNING.`

Removing KV quantization alone fixed it, and was also **faster**:

| Configuration | TTFT | Output |
|---|---|---|
| `q8_0` KV cache + flash attn | 4,701 ms | incoherent |
| **No KV quantization** | **2,402 ms** | coherent English |

This is a direct reproducibility failure of one of the paper's four headline
optimizations, on current tooling. It is disabled in `device-pack.ts` with the
reason recorded rather than deleted, so M4 can retest against a newer llama.rn.
Whether the fault is the quantized-cache kernel, the flash-attention path, or
their interaction on this SoC is not yet isolated — that is an M4 experiment.

## Finding: llama.rn defaults to 4 threads

The device has 8 cores and M0 measured prefill at 8 threads. llama.rn's default
attaches `n_threads=4`, silently halving throughput and making on-device numbers
incomparable to the baseline. Setting it explicitly cut model load from 18,248 ms
to 4,652 ms.

## Thermal: worse than M0 suggested

| | |
|---|---|
| Idle | 32–35 °C |
| After M0's `llama-bench` (~30 s) | 63–74 °C |
| **After 82 s of sustained generation** | **86–100 °C** |

One core reached **100 °C**. M0's benchmark understated this because it runs in
short bursts; a real answer generates continuously for far longer. For a field
app this is a battery and throttling problem, and it strengthens the case for the
adaptive runtime in §3.5 — which should arguably respond to temperature, not only
to memory pressure. The paper monitors memory alone.

## Open issue: generation quality

Output is coherent but wrong and repetitive:

> "If a woman is conscious and can perform CPR, then perform CPR. If a woman is
> unconscious and cannot perform CPR, then give the man."

`rag-core` builds a raw prompt string and the device backend passes it to
`completion()` as a plain prompt, so no chat template is applied and the model
has no reliable stopping signal — it ran to roughly 1,000 tokens. The eval
harness does not hit this because MCQ scoring constrains output to a single
token, which is precisely the kind of gap a benchmark-only evaluation hides.

Fixing it means using the chat template, which re-introduces Qwen3's thinking
mode (`docs/optimizations.md`) and so must disable it explicitly. That is the
first M4 task, and it is also why generation currently takes 82 s: it is
generating roughly ten times more tokens than the answer needs.

---

## The serious finding: the two runtimes do not embed alike

The device answered the bleeding question with material about oxygen therapy and
AEDs. Desktop, same model and same prompt, returned wound-packing procedures.
Tracing it back through the pipeline:

| | Device (llama.rn) | Harness (node-llama-cpp) |
|---|---|---|
| Retrieved pages | 231, 27, 31, 213 | **170, 169, 31** |
| raw cosine | 0.806–0.828 | **0.848–0.884** |
| Keywords extracted | identical | identical |

Embedding the same string with the same GGUF on both sides:

```
harness:  norm=9.0042  head=-0.1932,-0.0359, 0.2422,-0.2663, 0.4111, 0.2249
device:   norm=1.0000  head=-0.0361,-0.0032, 0.0317,-0.0053, 0.0299, 0.0116
```

Normalized for comparison, the harness vector is
`-0.0215, -0.0040, 0.0269, -0.0296, 0.0457, 0.0250`. The **directions differ**,
so this is not a scaling artifact. Measured cosine between the two runtimes'
embeddings of identical text: **0.8313**, where it should be 1.0.

Setting `pooling_type` to `mean`, `cls`, `last` and `none` changed the device
vector only slightly and none matched, so pooling is not the whole explanation
and the parameter appears to be largely inert at `initLlama`. The root cause is
not yet isolated.

### Why this matters more than the wrong answer

`docs/results-m1.md` argued for writing ingest in TypeScript precisely to avoid
this: *"Embedding the corpus with one implementation and queries with another
introduces a numerical mismatch that degrades retrieval in a way no test would
catch."* That reasoning was right and the fix was incomplete. Eliminating the
sentence-transformers/llama.cpp mismatch introduced a
node-llama-cpp/llama.rn mismatch — the same class of bug between a different
pair of runtimes.

It also breaks the project's central architectural claim. `rag-core` is shared so
that the eval harness measures the code that ships, but **retrieval quality does
not transfer**: M2's accuracy numbers were produced with harness embeddings and
the device does not reproduce them. The shared-pipeline guarantee holds for
logic and not for numerics.

Nothing failed. Retrieval returned plausible chunks with plausible scores; only
the choice of chunks was wrong.

### What was done about it

`EmbeddingSpec` now carries a **probe**: a canonical string and the normalized
vector the ingesting encoder produced for it. `verifyEmbedderParity()` re-embeds
that string at load and compares. The app now reports:

```
embedder parity: 19ms (MISMATCH cos=0.8313)
```

That converts a silent wrong-answer failure into a measured one at startup.
Matching `modelId` and `dim` was never sufficient — two runtimes can load the
same file, agree on all metadata, and still embed differently. Only comparing an
actual vector catches it.

### Options for resolving it

1. **Isolate the divergence** — tokenization (BOS/EOS handling) is the next
   suspect now that pooling is largely ruled out.
2. **Build the index with the device's own encoder**, so llama.rn is the single
   source of embeddings.
3. **Use one engine on both sides that is not llama.cpp** — ONNX Runtime has
   desktop and mobile builds and would make parity structural.

Until one of these lands, on-device retrieval quality is **not** the quality M2
measured, and the numbers should not be quoted as device numbers.

### Resolved: the harness is correct, the device runtime is not

The section above did not say which side was wrong, and an initial reading of the
tokenizers pointed the wrong way. node-llama-cpp's public `tokenize()` returns
`2491 5729 6327 9524` for the probe string while llama.rn tokenizes it as
`101 2491 5729 6327 9524 102` — with BERT's `[CLS]` and `[SEP]`. Since BERT
encoders are trained with those markers, that appeared to make the device right
and the index wrong.

It does not. `tokenize()` is a public API, not the embedding path, and comparing
both runtimes against a genuine reference settles it. transformers.js runs the
reference ONNX weights with the real HuggingFace tokenizer:

```
reference (transformers.js)  -0.0215,-0.0039, 0.0269,-0.0295, 0.0456, 0.0249
node-llama-cpp (ingest)      -0.0215,-0.0040, 0.0269,-0.0296, 0.0457, 0.0250
llama.rn (device)            -0.0361,-0.0032, 0.0317,-0.0053, 0.0299, 0.0116
```

**node-llama-cpp reproduces the reference to four decimals. llama.rn does not.**

Consequences:

- **The pack index is built correctly.** No re-ingest is required.
- **M2's accuracy numbers are valid**, because the harness embeds correctly on
  both sides of its own comparison. The earlier warning that they "should not be
  quoted as device numbers" stands only in the sense that the *device* does not
  currently reproduce them — the fault is the device runtime, not the benchmark.
- The defect is confined to llama.rn's embedding path, which is where the fix
  belongs.

`tools/eval/src/reference-embedding.mjs` keeps this check runnable. Any new or
upgraded embedding backend should be compared against it before use, because
"the answers look better" is how this was misdiagnosed twice.

### Generation findings are confounded until parity is fixed

Isolating flash attention from KV quantization gave:

| Configuration | Output |
|---|---|
| `flash_attn` + `q8_0` KV cache | word salad |
| `flash_attn` alone | coherent, but drifted into French/Portuguese |
| neither | coherent English |

That is suggestive, but **not trustworthy yet**. Retrieval parity is broken, so
the model is being handed irrelevant context in every one of those runs, and
context quality is a plausible cause of drift on a 0.6B model. Both flags are
disabled with that reasoning recorded; they should be re-isolated only after
`verifyEmbedderParity` passes.

The narrow claim that survives: **the paper's §3.4.3 configuration produced
unusable output on this stack**, which is enough to say it does not transfer
unmodified. Attributing it to KV quantization specifically requires the retest.

## Next step

Make embedding parity structural rather than detected, by running the same ONNX
model on both sides — transformers.js at ingest and ONNX Runtime on device. That
removes the class of bug instead of instrumenting it, and the reference above is
already the ingest-side implementation.

---

## Parity, part two: ingest fixed, device blocked by a library conflict

### Ingest now reproduces the reference exactly

`rag-core` owns the embedding pipeline end to end:

- `tokenizer.ts` — BERT WordPiece, mirroring HuggingFace's BertNormalizer +
  BertPreTokenizer + WordPiece + TemplateProcessing. 54 tests, including eight
  fixtures captured from `AutoTokenizer.from_pretrained('Supabase/gte-small')`
  covering accents, punctuation splitting, `##` continuation, over-long words and
  whitespace collapsing. These must match exactly: embedding depends on token
  ids, and a tokenizer that is merely close yields vectors that are merely close.
- `pooling.ts` — mean pooling over the attention mask, then L2 normalization.

`tools/ingest/src/onnx-embed.ts` runs the reference ONNX graph fed by that code:

```
ours      = -0.0215,-0.0039,0.0269,-0.0295,0.0456,0.0249
reference = -0.0215,-0.0039,0.0269,-0.0295,0.0456,0.0249
max component delta: 2.87e-5   PARITY OK
```

The pack is rebuilt on these embeddings (667 chunks, `cosineFloor` 0.7492).
`tools/ingest/src/verify-embedder.ts` keeps the check runnable.

Sharing the model file was never going to be sufficient. Three things must match
— tokenization, weights, pooling — and pooling differences change vector
*direction*, which cosine cannot forgive.

### The device half is blocked

`onnxruntime-react-native` 1.24.3 fails at startup:

```
[runtime not ready]: TypeError: Cannot read property 'install' of null
```

Its JSI binding obtains the call invoker from `RCTBridge`, which **does not exist
in bridgeless mode**. React Native's New Architecture removed it; a library
needing it must be reimplemented as a C++ TurboModule.

That collides with a hard requirement in the other direction: **llama.rn v0.10+
requires the New Architecture.** So on this stack the LLM runtime and the ONNX
runtime cannot both load. Patching `onnxruntime-react-native`'s use of Gradle 9's
removed `VersionNumber` API (`scripts/patch-onnx-gradle.mjs`) gets it to *build*,
but not to run.

This is a library incompatibility rather than a flaw in the approach: ONNX is
still the only runtime that spans Node and React Native with identical numerics.

### Options

1. **react-native-executorch** — one New-Architecture-native runtime for both the
   LLM and the embedder, with `@react-native-rag/executorch` already pairing
   them. Replaces llama.rn. ExecuTorch does not run under Node, so harness/device
   numeric parity would still need a separate argument.
2. **Build the vector index on device.** Ship packs with chunks and no vectors,
   and have the app embed them once at install using whatever encoder it has.
   Parity becomes trivially guaranteed because there is no cross-runtime
   comparison at all. Costs a one-time indexing pass (~667 chunks) and gives up
   the property that the harness measures the device's exact retrieval.
3. **Make ingest match llama.rn.** Treat the device encoder as ground truth and
   reproduce it at ingest. Attempted via `pooling_type` and `embd_normalize`
   without success; would need llama.rn source-level investigation.

Option 2 is the smallest change and the only one that makes the device
*correct* today. Option 1 is the better end state if harness/device parity is
worth a runtime migration.

Until one lands, on-device retrieval remains unfixed and `verifyEmbedderParity`
reports the mismatch at startup rather than letting it pass silently.

---

## Correction: the blocker was autolinking, not the New Architecture

The section above concluded that `onnxruntime-react-native` and `llama.rn` cannot
coexist, because the former needs `RCTBridge` and bridgeless mode removed it. That
diagnosis is wrong, and the three options it framed were answers to a problem that
does not exist.

**The error is a JavaScript null, not a native failure.** `lib/binding.ts` is:

```ts
export const Module = NativeModules.Onnxruntime;
if (typeof globalThis.OrtApi === 'undefined') {
  Module.install();
}
```

`NativeModules.Onnxruntime` is `null`, so reading `.install` off it throws
`Cannot read property 'install' of null`. The JSI binding is never reached.

**The module is null because it is never registered.** `MainApplication.kt` builds
its package list from `PackageList(this).packages`, which is autolinking output.
Running the autolinker directly is the one-command check:

```
$ expo-modules-autolinking react-native-config --platform android
dependencies: { '@op-engineering/op-sqlite': …, expo: …, 'llama.rn': … }
```

Three entries, no onnxruntime. It is absent because 1.24.3 ships no
`react-native.config.js` and, unlike `llama.rn` and `op-sqlite`, has no
`codegenConfig`, so nothing marks it as a native module to link. Its
`app.plugin.js` would have patched Gradle and the Podfile, but it was never listed
in `app.json`'s `plugins`, so it never ran either — which is also why
`android/app/build.gradle` contains no reference to it.

**Bridgeless mode was never the problem.** `ReactContext` declares
`getJSCallInvokerHolder()` as an abstract method and `BridgelessReactContext`
implements it (`reactHost.jsCallInvokerHolder`), and RN deliberately keeps
`BridgelessCatalystInstance.getJSCallInvokerHolder` — the source comments it
"needed to keep backward compatibility". `getJavaScriptContextHolder()` works
bridgeless too. The install path the module actually uses is intact under the New
Architecture.

**Upstream fixed this and never shipped it.** microsoft/onnxruntime#28266 adds
exactly this `react-native.config.js`, merged 2026-04-30. The newest published
version is 1.24.3, from 2026-03-05, so no release contains it. Note that issue
\#19510 — the one matching this error — is closed by that PR, which makes it look
resolved from the outside while every published artifact still has the bug.

`scripts/patch-onnx-autolink.mjs` applies it from postinstall, alongside the
existing Gradle 9 patch, and steps aside if a release ever ships the file. After
it, the autolinker reports the package with the correct
`packageImportPath`/`packageInstance`.

### Status and what is still unverified

Autolinking discovery is **verified locally**. The device half is **not**: no
Android device was attached to this session, so the APK has not been rebuilt and
`install()` has not been observed succeeding. What remains to confirm on hardware:

1. `libonnxruntimejsi.so` is packaged and `System.loadLibrary` succeeds.
2. The legacy-bridge module's `isBlockingSynchronousMethod` `install()` works
   through the New Architecture's interop layer. This is the residual risk: it is
   a legacy `ReactPackage` module, not a TurboModule.
3. `verifyEmbedderParity` reports OK rather than `MISMATCH cos=0.8313`, which is
   the actual goal — ONNX on both sides, parity structural rather than detected.

If all three hold, options 1–3 above are moot: no executorch migration, no
on-device indexing pass, no reproducing llama.rn's embedder. The committed design
was correct and was blocked by a packaging bug.
