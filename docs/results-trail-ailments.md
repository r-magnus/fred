# Common trail ailments: results (#116)

2026-10-02. Grades and packet: `ailments/`.

**Short version: the health pack (`core-health` 1.1.0, 215 passages, 0.47 MB)
now also carries NIH guidance on diarrhea and dehydration and on sports
injuries, FDA and EPA sun safety, and CDC norovirus prevention. On the new
trail-ailment questions, the answers that changed scored 4.0 → 7.0 of 9, with
nothing unsafe. Four topics have no free-to-use government source and stay
as known gaps (Ryan, 2026-10-02): treating sunburn, a home rehydration drink,
chafing, and protecting knees on descents.**

## What was added

| Publisher | Pages |
|---|---|
| NIH (NIDDK) | *Diarrhea*, *Symptoms & Causes of Diarrhea*, *Treatment of Diarrhea* |
| NIH (NIAMS) | *Sports Injuries*, *Diagnosis, Treatment, and Steps to Take* |
| FDA | *Tips to Stay Safe in the Sun*, *Sunscreen: How to Help Protect Your Skin* |
| EPA | *Action Steps for Sun Safety* |
| CDC | *How to Prevent Norovirus* (handwashing) |

Dropped, as for the rest of the pack: diagnosis, clinical trials, how doctors
treat diarrhea and the antidiarrheal-medicine section (Fred refers medicine
questions), references, news, and recalled sunscreen ingredients.

Searched and not used: the CDC's own pages on these topics (www.cdc.gov
refuses automated requests; its syndication API carries none of them), the
Army's *Field Hygiene and Sanitation* (TC 4-02.3, about running unit
sanitation) and *Foot Marches* (ATP 3-21.18, thin on these topics and written
for unit leaders), and MedlinePlus (part copyrighted).

## Results

Same packs as the phone, `INTENT=1`, California. Graded blind (A/B shuffled,
key opened after). One grader, Claude, who wrote the change.

### Trail-ailment questions (23, written before any source was searched for)

| | Before | After |
|---|---:|---:|
| Right decision | 12 | 14 |
| Score, the 9 changed answers | 4.0 | **7.0** |
| Unsafe | 0 | 0 |

Better: diarrhea on the trail (now rehydrate, watch for severe dehydration,
get care if it persists), when diarrhea means getting out (blood or black
stools, more than two days, dehydration), two days of diarrhea with dizziness
and little urine (now "seek medical help immediately"), what sunscreen
(broad-spectrum SPF 15+, every two hours), sunglasses at altitude.

Worse: "my knee swelled up after a long descent" got the sprain card (rest,
ice, compression, elevation); the NIH sports-injury passages now rank above
it, so the emergency's card no longer leads and Fred gives the watch reply.

Still missed (no source): treating a sunburn, cracked sunburned lips, a
rehydration drink without packets, chafed thighs, pack straps rubbing, knee
pain going downhill, setting poles for descents (the tips answer it partly).

### Every other set (decisions, then the changed answers)

About 700 decisions, 3 changed:

| Message | Before | After |
|---|---|---|
| "how do i avoid getting fried by the sun" | NPS camping page | FDA sun safety (fine) |
| "her leg is swelling up" after a snakebite | the snakebite card | the model answered from the sports-injury page, the snakebite guard replaced it: the hiker still sees the snakebite card |
| "how do i clean it" after "my husband just sliced his palm" | the cuts card (the thread's card) | the watch reply (slightly worse) |

The last chat already gave the watch reply one turn earlier ("my husband just
sliced his palm on a tin can"), before and after; "how do i clean it" used to
recover through the thread's card, which only applies when the message's own
best score is very low, and an NIH passage now scores just above that.

## Still open

- The four gap topics above (no free-to-use source).
- New passages can push a weakly matched emergency card out of the lead (the
  swollen knee, the cut in a second person's chat). Worth a general look: the
  card rule could compare against field-card-like passages only.
- The phone has health pack 1.0.0; 1.1.0 needs staging (content only, no code
  change since the health-pack phone check).

## Follow-up: cards crowded out by passages (#121)

A passage whose stored vector is within cosine 0.65 of a field card's (same
topic 0.65-0.81, related topics 0.43-0.61, measured) now backs the card
instead of outranking it, but only when it is the top result. The first
version accepted any agreeing passage and opened the trench-foot card for
"do i pop it" about a burn blister (the Army's trench-foot pages mention
blisters); requiring the top result fixed all four such chats.

Every set, decisions against the release before: 5 changed, all a reference
passage giving way to the card that covers it (the water card for three water
questions and a phone chat, the CPR card for compression depth). The swollen
knee after a descent is not recovered: its top passage is about sports
injuries in general, which no rule tells apart from the blister case without
letting wrong cards through.
