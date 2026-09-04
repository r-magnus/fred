# M1 — Ingest pipeline and the first pack

**Corpus:** WHO/ICRC *Basic Emergency Care* (2018), 240 pages, CC BY-NC-SA 3.0 IGO
**Encoder:** `thenlper/gte-small`, fp16 GGUF, 384-dim
**Output:** `packs/core-firstaid-v1.0.0`

| Artifact | Size |
|---|---|
| `chunks.sqlite` (FTS5, external content) | 1092 KB |
| `vectors.i8` (825 × 384 INT8) | 309 KB |
| `vectors.scale` | 3 KB |
| **Total** | **1.37 MB for 825 chunks** |

825 chunks: 378 procedure, 447 prose. Layout classification across 240 pages:
199 single-column, 40 multi-column, 1 table.

## Vector index size — the paper's figure is wrong

PocketRAG §3.2.1 reports **120 MB for 8,000 chunks**. Measured here, 825 chunks of
384-dim INT8 occupy **309 KB**, which extrapolates to **~3.0 MB at 8,000 chunks** —
roughly 40× smaller than claimed. Their number appears to include chunk text or is
simply an error.

The practical consequence is real: the §3.1 memory budget has ~117 MB more headroom
than the paper implies, which is why a 1B–1.7B model is affordable where they used
0.6B.

## PDF extraction was the hard part

§3.2.1 covers ingestion in one sentence ("PDF/HTML is normalized to plain text").
In practice it took four distinct fixes, each found by reading actual output:

1. **Multi-column tables fused across cells.** Reading a WHO condition table
   row-wise produced `"Tension Hypotension WITH Any pneumothorax can become a
   tension"` — three unrelated cells welded into a sentence that reads as valid
   English and appears in no source document. Fixed with gutter detection: bands
   wide enough to hold wrapped prose are read top-to-bottom, narrow bands across.
2. **Spanning headers hid the gutters.** A full-width header row bridges every
   gutter, so requiring a gutter to be empty on *all* lines found none. Gutters are
   now defined by the majority of lines (≤12% may bridge).
3. **Navigation tabs polluted sections.** WHO BEC prints `ABCDE` / `TRAUMA` /
   `SHOCK` / `SKILLS` / `GLOSSARY` down the page margin; pdfjs returns them inline.
   The heading heuristic mistook them for section titles, so a wound-packing
   procedure was cited as coming from **"GLOSSARY"**. Citations are user-visible in
   a first-aid app, so this is a defect, not cosmetics.
4. **Contents pages outranked real procedures.** A TOC lists every topic word in
   the manual, so it scores near-perfectly on the lexical stage — `"TABLE OF
   CONTENTS: SKILLS"` was the top hit for *"how do I control severe external
   bleeding"*. Dot-leader lines are now dropped.

Each fix also raised chunk density: 1455 fragmented chunks → 825 fuller ones, closer
to the 300-token target.

**Takeaway for the report:** corpus quality is an underestimated risk in on-device
RAG. Every one of these produced fluent, plausible, wrong retrievals rather than
obvious errors.

## The abstention gate, validated on real data

Measured `cosineFloor` for gte-small: **0.7488** (90th percentile of unrelated-pair
cosine, calibrated at ingest).

| Query | raw cos | rescaled | fused U | Outcome |
|---|---|---|---|---|
| control severe bleeding | 0.884 | 0.537 | 0.642 | answer |
| signs of shock | 0.874 | 0.499 | 0.700 | answer |
| choking, cannot speak | 0.892 | 0.569 | 0.582 | answer |
| **"how do I make sourdough bread rise"** | 0.770 | 0.086 | **0.212** | **abstain** ✅ |

Without floor rescaling the bread query fuses to **0.62** and clears the 0.35 gate —
the system would have answered a baking question from a trauma manual. This is why
`cosineFloor` is a required field rather than an optional tuning knob.

## Compression is weakest where the content matters most

For the bleeding query, all retrieved chunks were `procedure`, so atomicity
(correctly) refused to trim any of them: **0% reduction**. Prose-heavy queries hit
the 20–22% target normally.

First-aid content is disproportionately procedural, so Selective Context Compression
delivers least on exactly the queries the app exists to serve. Combined with M0's
finding that prefill dominates on mid-range hardware, this promotes **prompt prefix
caching** — which the paper does not do — from a secondary optimization to the
primary TTFT lever.

## Deviation from the plan: TypeScript, not Python

`tools/ingest` was planned in Python. It is TypeScript, for three reasons:

1. **Numerical consistency.** Embedding the corpus with sentence-transformers while
   the app embeds queries with llama.cpp GGUF means every cosine compares vectors
   from two different implementations of the same model. It degrades retrieval
   quietly and no test would catch it. One engine, both sides.
2. **No schema drift.** Ingest imports `@fred/pack-format` directly, so writer and
   reader cannot diverge.
3. **Toolchain.** No pip or passwordless sudo on the dev machine, while Node 24
   ships `node:sqlite` *with FTS5 and BM25* — removing the `better-sqlite3` native
   build entirely, which matters given the project already carries an NDK
   cross-compile.
