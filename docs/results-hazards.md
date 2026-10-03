# Weather and terrain hazards: results (#115)

2026-10-03. Grades and packet: `hazards/`.

**Short version: a hazards pack (`core-hazards` 1.0.0, 86 passages, 0.21 MB)
from the National Weather Service, National Park Service, Bureau of Land
Management and Forest Service: lightning, flash floods, river crossings and
wildfire, all advice for the spot, with no signal. On new hazard questions the
answers that changed scored 3.0 → 6.5 of 12. Hazards that call for help now
are danger signs (#100), and four guard fixes came with it, the most serious
for a lightning victim: "Do not attempt to rescue the friend unless instructed
by a professional" is now impossible; the victim gets "It is perfectly safe to
touch a lightning victim... start CPR right away".**

## What was built

- **`core-hazards` 1.0.0**, built with the health pack's cleaning
  (`health-fetch.ts`, `health-pack.ts`): NWS lightning safety, outdoors,
  "five ways lightning strikes people", tips and myths; NWS "Turn Around Don't
  Drown" and flood safety; BLM and Zion flash floods; NPS safe river
  crossings; NPS wildland fire safety for visitors; NWS wildfire; Forest
  Service fire, Superior National Forest's wildfire steps, and safety in
  burned areas. Dropped: NWS's backcountry lightning PDF (its columns extract
  as run-together words), sections for coaches, cyclists, divers and indoor
  safety, permits and winter visits. The myths page's first myth lost its
  label in extraction ("you should crouch down" read as advice); restored.
- **Danger signs** (`triage.ts`): water rising around them, swept away,
  (wild)fire closing in, trapped by fire or flood, stuck on a ledge or cliffed
  out.
- **A lightning-strike guard** (`exposures.ts`): after "struck by lightning",
  advice not to touch, help or rescue the victim is replaced by a reviewed
  reply in NWS's words. On an emergency decline, a risk's reviewed reply comes
  before the general safety net.
- **The emergency rule echoed back is a dead end**: "If life is at risk, say
  to contact emergency services first." was shown as an answer.
- **The conversation's card lines before a decline** (#109's line matching):
  "should we run to the car" after "a bear just came into camp" was declined
  once a lightning passage on vehicles scored 0.13, above the thread-card
  floor; the bear card's "Don't run" now answers it.
- **Same-topic passages don't count against the thread card** (#121's
  similarity): a passage that says what the conversation's card says no
  longer switches the card off.

## Results

Same packs as the phone, `INTENT=1`, California. Graded blind (A/B shuffled,
key opened after). One grader, Claude, who wrote the change.

### Hazard questions (24, written before any source was searched for)

| | Before | After |
|---|---:|---:|
| Right decision | 12 | 16 |
| Score, the 12 changed answers | 3.0 | **6.5** |
| Unsafe | 0 | 0 |

Better: spreading out in a thunderstorm, a tent is not safe in lightning,
don't drive through water on the road, climb high when water rises in a
canyon, a wildfire closing in. The lightning victim was graded worse (the
echoed rule) before the fixes above; it now gets the reviewed reply.

Still missed: how long to wait after thunder, a dry wash as a campsite and a
campfire in high wind (partly), thick smoke, a slot canyon with clouds
upstream, stuck on a ledge (no source; the danger sign now gets the safety
net), a whiteout.

### Every other set (decisions, then the changed answers)

About 800 decisions (including the health, ailments and wildlife sets), 4
changed: "its getting dark" in a lost chat now answered from the Forest
Service's "if you are lost, stay put, signal" (sound, though no longer the
lost card), the lightning victim (now the reviewed reply), "should i prop my
leg up" after a snakebite (the snakebite guard shows the card, as before), a
forecast question (a different source; still answered, as before).

## Still open

- The model declines with the answering passage retrieved (waiting after
  thunder, as for bison and moose in #117).
- No free-to-use source for being stuck on a ledge.
- The phone needs this build and the new packs staged.
