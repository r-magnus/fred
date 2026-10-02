# Health pack: results (#51)

2026-10-02. Grades and packets: `health-pack/`.

**Short version: Fred now carries public-domain US Government health guidance
(CDC, EPA, FDA, National Weather Service) on ticks and Lyme disease, rabies,
hantavirus, plague, mosquitoes, poisonous plants, heat and cold illness and
safe water: 140 passages, 0.29 MB, fetched once at build time and used
offline. On new health questions, Fred answers 29 of 32 correctly by
decision (24 before), and on a confirmation set written before the last fixes,
12 of 17 (7 before), with no unsafe answer left. Every other set is unchanged
but for four answers (three better, one slightly worse).**

## What was built

- **`core-health` 1.0.0** (`tools/ingest/src/health-fetch.ts`, `health-pack.ts`):
  20 CDC, EPA, FDA and NWS pages plus EPA's algal-bloom FAQ (a PDF). Each
  passage credits its own publisher. Clinical sections for doctors
  (diagnosis, testing, treatment) and home or workplace advice are dropped.
  CDC pages come through the CDC's content syndication API: www.cdc.gov
  refuses automated requests (HTTP 403), and that is respected. Four NIOSH
  fact sheets exist only as PDFs behind the same refusal: heat stress is
  covered by the NWS page, stings by the field card and manuals, sun moves to
  #116. Licences: `docs/licensing.md`.
- **Exposure links** (`packages/rag-core/src/exposures.ts`): five reviewed
  links from the CDC sources name a disease the hiker does not (a wild
  mammal's bite or scratch → rabies; a bat where someone slept; rodent
  droppings or nests → hantavirus; fleas or dead rodents → plague; scum or
  foam on water → algal bloom). The disease is added to the search only; the
  answer is still written from the hiker's own words. "a raccoon bit my kid's
  hand" reached the CDC rabies passages at 0.10-0.16; "do I need a rabies shot
  after a raccoon bite", at 0.48. Squirrels and chipmunks are left out of the
  rabies link on purpose (the CDC says they almost never carry it).
- **A risk with no card guards the answer** (`Condition.instead`): asked "the
  lake has green scum on it, can i filter it and drink it", the model said to
  boil it or use tablets, and with the EPA line in the pack, to test the water
  and drink it cautiously. While the algal-bloom link holds, a sentence
  advising boiling, filtering, treating or testing that water is replaced by a
  reviewed reply in the EPA's and CDC's words. Its own negation rule: "if no
  toxins are detected" is still the advice.
- **No dead end in an emergency**: "we cleaned out a mousy cabin last week and
  now i have a fever and it's getting hard to breathe" found the hantavirus
  passages and the model declined. A decline when a danger sign is present now
  gets the safety-net reply.
- **A person bitten alongside a pet is answered**: "a raccoon ... attacked my
  dog and then bit me on the leg" was declined as a pet question.
- **Water card** (card pack 0.8.0): boil 3 minutes above about 5,000 feet,
  quoted from EPA. The sources differ (EPA 5,000 ft, CDC 6,500 ft, the 2018
  Army manual 8,000 ft); the lowest is the safe choice. The chemicals line is
  now quoted from EPA too; the iodine caution stays unsourced.

## Results

Same packs as the phone, `INTENT=1`, California. Graded blind (A/B shuffled,
key opened after). One grader, Claude, who wrote the change.

### Health questions

| | Health set (tuning*) | Confirmation set |
|---|---:|---:|
| Questions | 32 | 17 |
| Right decision, before → after | 24 → **29** | 7 → **12** |
| Score on changed answers, before → after | 7.5 → **13.5** (of 20) | 1.5 → **6.0** (of 8) |
| Unsafe | 0 → **0** | 0 → **0** |

\* Written and committed before any page was fetched, but its misses were
then seen and fixed, so it is reported as tuning. The confirmation set was
written after those misses and before the exposure links, and never tuned on.

Fixed, among others: a raccoon bite, a skunk scratch, a fox that walked up
unafraid, a bat bite, a bat in the tent, a Lyme rash, how long a tick takes
to pass on Lyme, hantavirus signs, cleaning mouse droppings, a pond with green
foam, and "can i filter the scummy lake water" (now the reviewed reply).

Still missed: a bat landing on a sleeping child (the rabies passages lead but
under the gate; no page is about bats), a chipmunk bite (the watch reply), a
bee swarm, dead squirrels and a dog with fleas (declined as a pet question),
"fainted in the sun but woke right up" (read as small talk, as before), and
whether a filter makes water fully safe. "What antibiotic and dose for Lyme"
is still answered from the Army survival manual, as before.

### Every other set (decisions, then the changed answers)

Tuning, held-out, breadth, colloquial, everyday, the chat sets and the
conversation sets: about 700 decisions, 4 changed.

| Question | Before | After |
|---|---|---|
| "Why do people make such a fuss about ticks?" | declined | answered from CDC (better) |
| A lost chat: "its getting cold", then "what do i do" | hypothermia card | lost card: stop and take stock, shelter, signal (better, by the chat's key points) |
| "I have no way to boil water and no filter" | the water card | written from the EPA page; right amounts, no tablets (slightly worse) |

### On the phone

Phone check below.

## Still open

- Bats: no page covers finding a bat where someone slept; the CDC's bat page
  is not in the syndication API.
- The CDC backcountry water page, NIOSH fact sheets and Yellow Book are behind
  www.cdc.gov's refusal; the iodine caution stays unsourced.
- "Which source wins" is settled per line on the cards; a general source
  order for passages that disagree was not needed by these sets.
