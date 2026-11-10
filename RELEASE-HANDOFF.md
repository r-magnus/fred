# Release handoff — 2026-11-09

Three pieces of work stand between Fred and a stranger being able to set him up
from a download link. They are listed in dependency order: the licensing work
decides **what** goes in the core download, the host decides **where** it goes,
and partitioning (tentative) decides **in what shape**.

Nothing here has been started. Background: `docs/licensing.md`, issues #33,
#214, #198, #29, and the licensing research page from 2026-11-04
(https://claude.ai/artifact/YSnah8532BeYQU7FVnuKvr, linked from #214).

> **Before anything: the shipped pack set is not on this Mac.** `packs/` here is
> stale (field cards 0.5.0, no health, hazards, wildlife-safety or tips packs).
> The A-KR2 figure of 73.8% was measured on `~/fred-packs-g-all` on the Linux
> machine, and the phone's packs match that folder byte for byte (2026-10-07).
> Every measurement and every bundle build below must use that folder
> (`PACKS_DIR=~/fred-packs-g-all`), or rebuild it here first. A run on `packs/`
> gave 71.3% on 2026-10-06 and is **not** the shipped pipeline.

---

## 1 · Licensing: replace the WHO sources, and measure the cost

**Why:** WHO *Basic Emergency Care* (`who-bec`, 667 passages, pack
`core-firstaid`) and *Psychological First Aid* (`who-pfa`) are CC BY-NC-SA 3.0
IGO. A free release is allowed. A paid one, or anything else commercial, is not
allowed without WHO's permission. Everything else Fred ships is public domain or
allows commercial use with attribution (Wikivoyage CC BY-SA, OSM ODbL).

**Open decision for Ryan, which changes the scope:** is the first public release
free? If it is, WHO can ship in the core bundle with attribution and share-alike
honoured, and this whole section becomes the path to a commercial release rather
than a blocker for publishing. Record the decision in `docs/licensing.md`
either way.

### Steps

1. **#33 — measure without WHO.** Run the held-out set (40 questions, four-part
   rubric, graded blind like the 2026-10-06 run) with `core-firstaid` removed
   from a copy of `~/fred-packs-g-all`. Also run the 57-question breadth set.
   Write `docs/results-no-who.md`, and add the number to `docs/metrics.json`
   and then run `npm run metrics`.
   - Baseline to compare against: 73.8% held out, 67.5% breadth, 0 safety
     failures.
   - The field cards still quote WHO, so this measures the **pack** only.
     Say so in the results file.
2. **#33, second half — respect the flag.** `nonCommercial` already exists on
   licence entries (`packages/pack-format/src/index.ts:129`, set in
   `tools/ingest/src/licenses.ts`). Nothing reads it yet. Add a build-time
   switch (in `scripts/build-core-bundle.mjs`) that refuses or drops
   non-commercial packs for a commercial build, with a test.
3. **#214 — re-back the 11 field cards** that quote WHO
   (`corpora/cards/cards.json`), starting with the five that rest mostly on it:
   seizure (8/8 quotes), low blood sugar (6/7), heart attack and stroke (6/7),
   pelvis (10/12), spinal (11/16). Look for public-domain quotes in this order:
   ATP 4-02.11 (already a pack), then the Navy *Hospital Corpsman* NAVEDTRA
   14295, then *The Ship's Medicine Chest and Medical Aid at Sea* (USPHS 2003).
   The card quote check catches a quote that doesn't match its named source.
   Each changed card follows Ryan's standing rule: a self-review in
   `corpora/cards/self-reviews.json`, then the review page.
4. **#214 — replace Psychological First Aid** with CDC *Coping with a Disaster
   or Traumatic Event* (public domain on CDC Stacks) and SAMHSA tip sheets
   (check each PDF's notice). New licence entries go in `docs/licensing.md`.
5. **Re-measure** held-out and breadth with the WHO-free packs and cards. This
   is #214's "done when": accuracy is no worse than with WHO, or the drop is
   written down and accepted by Ryan.
6. **Optional, in parallel:** ask for commercial permission through WHO's
   permissions form. Expect it to be slow.

**Don't:** use the US PFA Field Operations Guide, the NASEMSO EMS guidelines,
the MedlinePlus A.D.A.M. encyclopedia, or Red Cross, AHA or NOLS material. None
of them are free (see the research page).

**Also owed (none of them blocks a release):** pass Google's Gemma use
restrictions on in Fred's terms (EmbeddingGemma); keep the Wikivoyage and OSM
credits visible; decide whether to keep the eight NPS articles written with
the Leave No Trace Center.

---

## 2 · Host the core download

**Where things stand.** The host already exists for maps. State bundles are
GitHub Release assets on the public repo `r-magnus/fred-maps` (release
`maps-2026-09`, 52 entries). The app reads
`https://raw.githubusercontent.com/r-magnus/fred-maps/main/index.json`
(`apps/mobile/src/map-downloads.ts:20`). The index format already has an
optional `core` entry, and the setup wizard downloads whatever is listed there
(#196). It is absent, so the wizard's guides page has nothing to fetch, and a
phone can only be set up by cable.

`scripts/build-core-bundle.mjs` builds it: about 1.45 GB, made of
`Qwen3-1.7B-Q4_K_M.gguf` (1.11 GB), `embeddinggemma-300M-Q8_0.gguf` (334 MB)
and the newest version of each `core-*` pack. It writes `dist/core-upload/` and
`dist/index-core.json`. It publishes nothing by design: the licence entries are
copied into `bundle.json` so the go/no-go can be read from one file.

### Steps

1. **Get Ryan's yes on what the bundle contains** (#198, item 1). That means
   section 1's decision on WHO, plus redistributing the two models: Qwen3 is
   Apache-2.0, and EmbeddingGemma falls under Google's Gemma terms, which
   require passing on the use restrictions.
2. **Build from the shipped packs:**
   `PACKS_DIR=~/fred-packs-g-all node scripts/build-core-bundle.mjs dist`.
   Check `bundle.json`'s licence list against `docs/licensing.md`.
3. **Pick the host. Recommendation: keep GitHub Releases on `fred-maps`.** It's
   free, it's already in use, and the app already trusts it. The asset limit is
   2 GiB per file, and the largest file (the generator model, 1.11 GB) fits.
   Two things to note in the decision:
   - The repo is named for maps. Decide whether a `core-*` release belongs
     there or in a sibling repo (`baseUrl` is per index, so either works).
   - A public repo means a public download. That's fine under the licences
     only if the WHO decision in section 1 is recorded first.
   Revisit the host (Cloudflare R2, Hugging Face) only if GitHub's bandwidth or
   reliability becomes a real problem.
4. **Publish:** upload `core-upload/` to the release, then merge
   `index-core.json` into `index.json` as `"core"`. Fetch it back and check the
   sizes and MD5s.
5. **Resume dropped downloads** (#198, item 2). Today `downloadBundle`
   (`map-downloads.ts`, around line 101) deletes `.partial` and starts the file
   over, which hurts on a 1.1 GB file over trailhead Wi-Fi. Either:
   - keep the partial and resume from its size with a `Range` request (check
     whether `File.createDownloadTask` in expo-file-system supports
     resumption; GitHub's release CDN honours `Range`), or
   - split the file into parts (section 3), so a drop only costs one part.

   Done when a download cut halfway through the model resumes. Prove it with a
   test and a check on the phone.
6. **Phone check** (#198, item 3): a fresh install on the Nothing Phone (3)
   gets the guides through the wizard. Also check the offline and "not
   published" messages, and the location prompt on a phone that never granted
   it.

---

## 3 · Partition packs into smaller pieces *(tentative: decide before building)*

**What is big today**, from `index.json`:

- The core bundle is about 1.45 GB, and most of it is one file (the 1.11 GB
  model).
- State bundles: CA is 791 MB, and its z14 basemap alone is 641 MB. AK is
  1.27 GB.
- Flora and fauna packs are small (CA is about 13 MB). The size is in the
  basemap, the contours and the models, not in the RAG packs.

So "smaller pieces" can mean three different things. Choose before building.

| Option | What it fixes | Cost |
|---|---|---|
| **A. Split large files into fixed parts** (e.g. 64–128 MB each, one index entry per part, joined on the phone) | Resume for free: a drop costs one part. No dependence on Range support. | Index schema bump (`SCHEMA = 1` refuses newer indexes, so old builds need an update message). The phone needs a join step and a hash of the whole file. |
| **B. Split state basemaps by region** (a state-wide low-zoom layer, plus z14 per region or county group) | Smaller first download. A hiker gets only the area they need. | Real work in `build-state-map.mjs` and the map screen. Changes the setup flow. |
| **C. Make some core packs optional** (e.g. tips, wildlife safety as add-ons) | Barely anything: the core packs are a few MB. | Not worth it on its own. |

**Recommendation:** do A only if Range resume (section 2, step 5) turns out to be
unreliable on the phone. It's the cheaper fix for the same problem. Treat B as
a product decision for after RC testers report how the 600–1,300 MB state
downloads actually go (RC-KR1 measures setup completion). Skip C.

---

## 4 · A "think harder" mode on the same model *(exploratory, not release work)*

**The idea:** an opt-in mode where the same Qwen3-1.7B takes more time to give a
more careful answer. There's room for it in the app. But the obvious version has
already been measured and lost, so it needs a different method.

**Already measured and rejected:** Qwen3's thinking mode
(`docs/results-thinking.md`, 2026-09-26, 104 tuning questions). Time per answer
went from 5.7 s to 12.9 s on desktop. Of the 24 answers that changed, the net
score was about −3.5, with one new unsafe answer ("campfire smoke can be used
for water purification"). The pattern:

- First-aid procedures got better: the seizure and sucking chest wound answers
  went from partial to full.
- Plant and animal facts got worse: the model drifted from the passages and
  added things they don't say.
- A clean refusal on a dose question became a non-answer.

The `THINKING` switch is still in the harness, off by default. Also rejected,
but not same-model: Qwen3.5-2B (`docs/results-qwen35-2b.md`) and the NLI
checking model (`docs/results-verifier-test.md`). A 4B model doesn't fit the
memory budget (`docs/results-strategy-research.md`).

**Untried, same model only, in order of promise:**

1. **Answer several times and keep the answer the runs agree on.** Generate 3–5
   answers with sampling, and keep the one that overlaps most with the other
   answers and with the retrieved passages. Made-up details tend to vary from
   run to run while sourced ones repeat, so this targets the failure thinking
   mode caused. Cost is 3–5× generation, roughly 40–70 s on the phone.
2. **Thinking for first-aid procedure questions only,** the one area where it
   helped. Fred's intent routing already tells question types apart. The
   evidence is two tuning answers, so this needs a held-out run before anyone
   trusts it.
3. **More passages** (8 instead of 4). Expect little: the September notes say
   retrieval isn't where answers fail.

**Caveats:**

- Field-card answers and declines skip the model. Only 17 of 40 held-out
  replies are written by it, so the mode can only move those.
- A-KR3 grades the default mode, but 40–70 s is a different experience for
  someone who's hurt. Label the wait honestly in the app.

**Recommendation:** test option 1 on the tuning set first. It passes only with
**zero new unsafe answers** and a clear net gain; only then does it get a
held-out run. If it doesn't clearly beat the normal answers, drop the mode
rather than ship a button that sounds more careful than it is.

---

## Done looks like

- [ ] WHO decision recorded in `docs/licensing.md` (free first release, or WHO replaced)
- [ ] `docs/results-no-who.md` with held-out and breadth numbers (#33)
- [ ] `nonCommercial` flag read at bundle build time, with a test (#33)
- [ ] 11 WHO-quoting field cards re-backed, PFA replaced, re-measured (#214) — only if commercial
- [ ] Core bundle built from the shipped packs and published; `index.json` has `core` (#198)
- [ ] Interrupted download resumes, proven by a test and a check on the phone (#198)
- [ ] Fresh Nothing Phone install sets itself up through the wizard (#198)
- [ ] Partitioning decision recorded (A / B / not now)
- [ ] *(Exploratory)* "Answer several times" tested on the tuning set; go or no-go recorded
