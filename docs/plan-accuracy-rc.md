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

## Re-ordered 2026-11-21, after the baseline

The #258 baseline (`docs/results-baseline-rc.md`) changed the picture: on
the dev sets, search and declines now cause 8 of 43 shortfalls, and **thin
model answers cause 17**. In chats, **the card sticking to follow-ups**
causes 14 of 29 turns that fall short. So the order is now: small certain
fixes first, the biggest problems next, the riskiest change last. Ryan
agreed the order on 2026-11-21.

**Guard against going backwards, every step:** sweep the dev sets
(breadth, assembled ×2, chats-long-dev, chats-phone) and list every reply
that changed against the baseline in `docs/c258/`
(`~/fred-runs/112/textdiff.py`, `diff.py`). A change merges only if no
answer graded full today gets worse, no answer becomes unsafe, and the 29
chat turns graded ok stay ok. The held-out and sealed sets stay unread
until step 6.

## Steps

### 0 · Baseline and a fresh sealed set — #258 ✅ (2026-11-21)

Breadth 78.1%, assembled 82.2% / 80.0%, 0 unsafe, 4 of 9 dev chats with no
wrong turn. Sealed RC set committed unrun (#265).

### 1 · Two reply bugs (Nov 21–22) — #268

- A card reply ends with its last lines repeated and a stray fragment
  (`as-smoke-01`).
- The model's "I don't have reliable information" goes out as an answer with
  citations (`la-tentbrand-01`).

Fix each at the cause, for every card and every model refusal.

### 2 · Follow-ups: the card stops sticking (Nov 22–27) — #240, biggest chat problem

A card from an earlier turn must not answer a follow-up it doesn't fit
("ok fire's going", "should I take her ring off", "can she walk on it",
"should I pop it"), and a symptom list mid-chat ("dizzy, headache, pale")
gets an answer, not "watch". Starting design: the local "Safe conversation
understanding" write-up. Risk: follow-ups that rightly keep the card ("it's
blistering" after a burn) must keep it; the chat sets check that.

### 3 · Quotes instead of thin paraphrase (Nov 27–Dec 1) — #261

Two parts:
- The quote picks the sentence that answers (how, how long, can I, is it
  safe), allowing the neighbouring sentence: 5 quote-off misses.
- Where the top passage plainly holds the answer, quote it rather than let
  the model reword it thinly: aimed at the 17 thin model answers. Only for
  passages that clearly answer; every changed full answer is re-read.

### 4 · Cards answer the asked detail first (Dec 1–4) — #262

9 cards on the right topic lack the asked detail. Lead with the card's line
for the detail; where none exists, add one to the existing card (quoted
from the manuals, self-reviewed; no new cards without Ryan). Traps: lines
without a source are spoken as written; new lines can make a card win
questions it shouldn't (`card-editing-traps`).

### 5 · Search and the gate, small (Dec 4–7) — #259, #260

About 8 misses: 7 declines and one dropped detail ("stomach" → spine card).
- #259: a rare word in the question ("belly", "scalp") counts for more.
- #260: let a near-miss pass the gate only when keyword and meaning agree on
  the same passage. This is the riskiest change in the plan (it can make Fred
  answer look-alikes, which is how unsafe answers get in), so it ships only
  if all 30 look-alikes are still declined, or not at all.

### 6 · Final measure (Dec 8) — #263

Run the held-out set and the new sealed set once, graded blind where possible.
Update `docs/metrics.json`, then `npm run metrics`, and write
`docs/results-accuracy-rc.md`.

### Testers' ratings

Thumbs-down ratings from the iPhone and Android testers can point to kinds of
failure to look at. They are never used as a test set or tuned on directly.

## Done looks like

- [x] Baseline graded on the dev sets, with causes (step 0, #258)
- [x] New sealed set written and committed before any fix (#265)
- [ ] Each workstream: a results note, a before/after on the dev sets, 0 new
      unsafe answers
- [ ] Held-out and sealed sets run once at the end, numbers in `metrics.json`

## Waiting on Ryan (not blocking)

- Any new field card that step 4 turns out to need.
