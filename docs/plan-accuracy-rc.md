# Plan: better everyday answers before the Release Candidate

Written 2026-11-20. RC is due 2026-12-09. **Deep thinking is dropped**
(Ryan, 2026-11-20: "an obscure stretch goal, unnecessary"), so this plan
works only on the normal answer path, which every question goes through.

## Why this direction

The Mac's read of 66 graded shortfalls (`docs/handoff-deep-thinking.md`,
`docs/deep-thinking/research-2026-11-20-paths/fred_question_types.md`) found
that **none** came from the model reasoning badly. They came from:

| Cause | Count | Workstream |
|---|---|---|
| Search or routing picked the wrong passage or card, or fell just under the gate | 25 | W1, W2 |
| A card or quote on the right topic that doesn't hold the answer | 15 | W3, W4 |
| A thin or incomplete model answer with the right passages | 15 | W5 (last) |
| Model drift from the passages | 7 | W5 |
| Model declined with the answer in hand | 3 | W2 |

The pattern that keeps recurring is a **dropped detail**: "belly", "baby",
"scalp", "can't see the Big Dipper", "without a compass", "everything
soaked". Both past safety defects were this kind. Follow-up questions are the
other weak spot: a wrong card carries over into later questions (#240, #235,
#228, #100, #205).

## Rules for this work

- **Safe first.** No change ships if it adds an unsafe answer on any set.
- **Fix causes, not single answers.** A change must help a kind of question,
  not one item.
- **Tune on the dev sets only.** The held-out set (40) and a new sealed set
  (step 0) are run once, at the end.
- **One run at a time**, each under 2 hours.
- **Cards:** existing cards may be edited (self-review, then the review page).
  New cards only with Ryan's yes.

## Steps

### 0 · Baseline and a fresh sealed set (Nov 20–22) — #258

- Run today's `main` on the dev sets: breadth (57), assembled working and
  sealed (90), and the chat sets for follow-ups. Grade with the four-part
  rubric and record a cause for each miss.
- Write a **new sealed set of ~40 questions**: half with one detail that
  changes the answer (patient, body part, no tool, weather), plus follow-up
  chats. Key points come from the sources. Don't run it until step 6.
- This also answers whether the 66 causes are still current: #23, #152 and
  #21 landed after most of those grades.

### W1 · Search keeps the detail (Nov 22–27) — #259, biggest bucket

- Find out why the qualifier loses. Is it the keyword-vs-meaning weighting
  (`score.ts` `fuse`, `DEFAULT_ALPHA`), the question being embedded whole, or
  the card matcher ignoring it?
- Likely fixes, tried one at a time on the dev sets:
  - A rare word in the question ("belly", "scalp", "bulrush", "paracord")
    must count for more when ranking.
  - A card loses its reserved place when the question names a body part,
    patient or condition the card never mentions.
  - Synonyms for real lexical gaps (paracord ↔ cord, "tummy" ↔ abdomen).

### W2 · The gate stops throwing away right answers (Nov 25–28) — #260

Several declines had the right card or passage ranked first, just under the
0.29 gate. Let a near-miss pass when keyword and meaning agree on the same
passage. Check that the look-alike questions are still declined.

### W3 · Quotes pick the sentence that answers (Nov 27–Dec 1) — #261

In 5 assembled misses, the search found the answer but the quote picked the
sentence closest to the question instead of the one that answers it (often
one or two sentences away). Prefer sentences that answer the question's
type (how, how long, can I, is it safe), and allow the neighbouring sentence.

### W4 · Cards answer the asked detail first (Nov 28–Dec 3) — #262

When a card is on topic but the question carries a detail (belly wound, infant
airway, head tilt, Big Dipper not visible, soaked wood), lead with the card's
line for that detail. Where an existing card has no such line, add one (an
edit of an existing card, not a new card, quoted from the manuals,
self-reviewed). The snakebite and far-from-help conflict waits for the WMS
guideline to be read.

### W5 · Follow-ups and thin answers (Dec 1–5) — #240

- Follow-ups: a card from an earlier turn must not answer an unrelated new
  question (#240, #235, #228). Use the local "Safe conversation
  understanding" write-up as the starting design, and the chat sets as the
  test.
- Thin answers, only if time is left: ask the model to keep every item the top
  passage lists. This is risky (prompt changes have moved many answers
  before), so keep it only if the dev sets show a clear gain.

### 6 · Final measure (Dec 5–8) — #263

Run the held-out set and the new sealed set once, graded blind where possible.
Update `docs/metrics.json`, then `npm run metrics`, and write
`docs/results-accuracy-rc.md`.

## Done looks like

- [ ] Baseline graded on the dev sets, with causes (step 0)
- [ ] New sealed set written and committed before any fix
- [ ] Each workstream: a results note, a before/after on the dev sets, 0 new
      unsafe answers
- [ ] Held-out and sealed sets run once at the end, numbers in `metrics.json`

## Waiting on Ryan (not blocking)

- Whether to read the testers' thumbs-down ratings to find real failures. That
  becomes useful once the iPhone and Android testers start.
- Any new field card that W4 turns out to need.
