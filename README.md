# Fred

An offline, on-device assistant for the backcountry: first aid, wilderness survival,
and location-scoped plant and wildlife information. No network required — the model,
the knowledge corpus, and the maps all live on the phone.

Built on the approach in `pocketrag.pdf` (Kang et al., *PocketRAG: On-Device RAG for
First Aid Guidance in Offline Mobile Environments*), extended with multi-domain
retrieval, offline location awareness, offline maps, and an abstention gate.

## Layout

```
packages/rag-core/     Platform-agnostic retrieval pipeline (TypeScript)
packages/pack-format/  Pack manifest schema + shared types
apps/mobile/           React Native app (Expo dev build)
tools/ingest/          Python: corpus -> chunks -> embeddings -> INT8 -> pack
tools/eval/            Node: ablation harness over MCQ eval sets
docs/                  Design notes, licensing register, results
```

**`rag-core` is deliberately platform-agnostic.** It talks to the world through two
interfaces, `InferenceBackend` and `PackStore` (`packages/rag-core/src/backends.ts`).
The mobile app implements them with `llama.rn` + `op-sqlite`; the eval harness with
`node-llama-cpp` + `better-sqlite3`. The same pipeline code runs in both, so the
evaluation measures the system that actually ships rather than a reimplementation.

## Develop

Requires Node 22+ (uses native TypeScript execution — no build step for the core).

```bash
npm install
npm test        # 28 tests, no model or device needed
npm run typecheck
```

## Docs

- [`docs/optimizations.md`](docs/optimizations.md) — paper technique → implementation,
  and three deliberate deviations
- [`docs/licensing.md`](docs/licensing.md) — source licenses; note the WHO
  NonCommercial constraint
