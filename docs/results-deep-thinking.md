# Deep thinking: results (#21)

2026-11-15/16. Plan and pass rule: `plan-deep-thinking.md` (written before
any run). Evidence for each round: `deep-thinking/`. Desktop, phone packs
(`~/fred-runs/phone-1018/packs`), state CA, the app's settings (intent,
opening line, voice, scope scorer, card matcher), written answers.

## Short version

**What ships as deep thinking is "search harder after a flat decline".**
When Fred would otherwise say only "I don't have reliable information"
(search under the bar, no card to offer), he rephrases the question in a
field manual's words and searches again, but only for a message the scope
scorer calls in scope, never a medicine or a procedure. Everything else is
exactly the normal answer.

It passed on 275 questions it had never been run on: 4 answers changed,
all former declines; +1.5 points; no unsafe answer; no out-of-scope
question answered; no right answer made worse; 10.0 -> 10.7 s mean on the
desktop. With the dev sets it turns about 1 decline in 70 into a useful
answer (poison oak on the campfire, a soaked kit, a sunburn, what eats
mesquite pods).

That's modest, and it doesn't move the held-out score: on the held-out set
the second search ran once and found nothing better. The four strategies
meant to use a lot more compute all failed, two of them on safety.

## Rounds

| Round | Strategies | Sets | Result |
|---|---|---|---|
| 1 | search (scope **or** card-matcher gate) + evidence first + best of 3 by sentence vectors | tuning, assembled | **Fail.** 3 out-of-scope answered (belay knot, "where am I right now?", magnetic declination). Changed answers, blind: normal 22.0, deep 19.0; 4 fully right made wrong |
| 2 | search (scope gate) + best of 3 judged by the words kept from the sources | tuning, assembled | **Fail.** 2 new unsafe answers, both from a *sampled* draft: wild beans "generally considered safe to eat"; poison oak "dispose ... by burning them in a controlled manner". Normal 9.5, deep 8.0 |
| 3 | search (scope gate) alone, greedy answer | tuning, assembled; confirmed on held-out, assembled-sealed, breadth | Dev +4.5 on 7 changes. **Confirmation fail:** normal 2.0, deep 1.5; a right quote (sand stakes, "dead man") and a right card (fire in the wet) replaced by worse written answers |
| 4 | search only after a **flat decline** | confirmed on 10 untouched sets (275 questions) | **Pass.** +1.5 on 4 changes, nothing worse |

## What we learned

- **Sampling a 1.7B model is unsafe.** Every unsafe answer in these runs
  came from a sampled draft (temperature 0.6), never from the greedy one.
  This is the third time (Qwen3 thinking mode, #36; the 2B model, #37).
- **Vectors can't judge drafts.** Three drafts' sentence-vector scores
  differed by about 0.01, so "best of three" picked at random and chose the
  one draft without "3 feet". A judge that counts source phrases rewards
  copying, and can't see a dangerous conclusion.
- **Evidence first changes almost everything** (27 of 33 first drafts) and
  nets out worse.
- **The scope scorer is the right gate for a second search.** Gating on the
  card matcher instead let in the same out-of-scope questions that sank the
  phase-3 second search.
- **Order matters.** Fred's quote and card rescues for a weak search are
  reviewed text; a second search must come after them, not before.

## Caveats

- One grader (Claude), blind by version where both sides answered. In
  rounds 3-4 one side was often a decline, so the version was obvious.
- Round 4's rule was found by looking at the first confirmation sets, so a
  fresh confirmation was named before running it (plan, round 4).
- One round-4 answer is a misreading: "can i keep hiking if i have the runs"
  answered as if "runs" were an injury. The rubric scores it the same as
  the decline it replaced (0); a person might find it odder.
- Desktop timings only. On the phone the second search adds the rewrite (a
  short generation) plus a search, only on flat declines.

## Not tried

A bigger model used only in deep thinking (Qwen3-4B; #37 measured only the
2B). It's the remaining "more compute" lever, but it means a ~2.5 GB extra
download and phones with enough memory, so it's a product decision first.
