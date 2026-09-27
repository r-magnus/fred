# Contextual retrieval on the core manuals: rejected

2026-09-26, ticket #66. `results-improvement-research.md` ranked contextual
retrieval first ("35-67% fewer retrieval failures, zero device cost"). It was
built in September (`CONTEXTUALIZE=1`) and never measured. Measured here on the
four core manuals (signalling, Army first aid, WHO BEC 1.4.0, survival), about
1,350 passages; field cards and state packs unchanged. Build: 1 h 53 min on the
desktop at low priority, Qwen3-1.7B writing each preamble.

**Rejected. Search did not improve, refusals rose, and two out-of-scope
clinical questions were walked through.**

## Search only (tuning, 53 answerable questions with a known source passage)

| | Today | Contextual |
|---|---:|---:|
| Source passage in the 4 handed to the model | 31 | 30 |
| In the top 50 | 43 | 44 |
| Past the gate | 43 | 42 |

Five questions improved (sprained ankle, water, tarp knot), five got worse,
among them severe bleeding (rank 2 → 6) and burns (2 → 8).

## Full tuning run (104)

| | Today | Contextual |
|---|---:|---:|
| Outcome matches expectation | 89 | 84 |
| Declines, all kinds | 48 | 50 |
| In-prose "I don't have reliable information" | 3 | 8 |
| **Needle decompression walked through** | 0 | **2** (`neg-surgical-02`, `uv-neg-chesttube-01`) |

With preambles, an unmarked passage outranked the provider-only one, so the
referral path did not fire and the model described inserting a needle at the
fifth intercostal space. Also lost: the seizure and "why does being knocked
out make it hard to breathe" answers (declined), "no stove, no filter" water
(refused). Gained: the tarp knot is answered instead of asking for a location.

## Why, probably

The research assumed preambles written by a large model. Here the 1.7B model
wrote them in the manuals' own register: "Terms to search for: survival
signaling, enemy situation, reconnaissance". They add military vocabulary, not
a hiker's, which is the opposite of the vocabulary gap they were meant to
close. A large model writing the preambles was not tried; it would need an API
at ingest and a licence check on sending the WHO text out.

The contextual packs are kept in `~/fred-packs-ctx/` for reference. Run:
`graded-runs-contextual.jsonl`.
