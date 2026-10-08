# Making Fred better company: research on conversation quality

2026-10-08. Desk research only, no code changed. Sources: Fred's own code,
past results write-ups and saved chat runs, plus outside reading (links
inline).

## The short version

**Fred sounds sterile mainly because almost nothing he says in a conversation
is written for that conversation.** In the saved chat runs, about 9 replies in
10 are fixed text: a field card shown word for word, the one "Got it" line, or
one of the fixed safety replies. The friendly opening line only goes on the
remaining 1 in 10, the answers the model writes itself. So the opener, however
good it gets, cannot change how most of a conversation feels.

That points away from "make the model chattier" and toward three things, in
this order:

1. **Give the fixed replies a human frame**, built by rules from what the
   hiker said, not written by the model. Free in time, and it cannot invent
   advice.
2. **Say cards the way a person would**: the point first, the next few
   actions, then check back, with the whole card one tap away. The outside
   evidence for this is the strongest of anything here.
3. **Try two newer small models as drop-in replacements** for the answers the
   model does write. This is a swap, not training.

None of these adds field cards. None needs fine-tuning.

## What Fred says today, counted

From 22 saved chat run files in `docs/` (1,540 replies over 559 chats; the
same chats appear in several before-and-after runs, so read these as rough
shares, and the chat sets lean toward injuries and emergencies):

| What the hiker gets | Share of replies |
|---|---:|
| A field card, word for word | 34% |
| "Got it. I'm right here whenever you need me..." | 23% |
| A model-written answer | 12% |
| The fixed "get help now" reply | 11% |
| "I don't have reliable information on that." | 11% |
| The fixed "I don't have steps for that exact problem" reply | 9% |

Three more numbers from the same runs:

- **In 38% of chats, Fred repeats one of his own replies word for word.** One
  reply in four is a repeat of something he already said in that chat.
- **The "Got it" line shows up twice or more in 14% of chats.** It is a single
  sentence, and it lists what Fred can do every time.
- **A card reply is about 1,060 characters at the middle, 1,360 at the long
  end.** That is a full phone screen or more of numbered text in answer to one
  sentence from the hiker.

So the "FAQ search" feeling has a plain cause: Fred mostly returns documents.

## What the card replies look like, and why they read oddly

I don't know exactly which part feels odd to you, so here is what I see. Tell
me which of these it is, or if it's something else.

- **Everything is a card.** Each reply sits in a paper card with a tab on it
  ("Field card", "From the guides", "Fred"). That is how search results look,
  not how a friend talks.
- **The card doesn't notice who is asking.** "my mom slipped on the wet
  boardwalk... now her wrist is swollen and she wont let me touch it" gets
  "Splint it the way you find it..." and then step 1: "Signs of a break
  include a lot of pain and swelling...". Correct, but it never mentions mom,
  the wrist, or that she won't let anyone touch it.
- **The first step is often not an action.** Several cards open with how to
  recognise the problem, when the hiker has just described it.
- **Everything comes at once**: summary, up to eight steps, the don'ts, the
  get-help line, a disclaimer, the sources.
- **Short answers from a card can miss.** In the same chat, "can she still
  carry her pack" got the spine-injury card's line "Pack rolled clothing or
  anything similar on both sides of the head". It looks like the word "pack"
  made the match. That is from a 2026-10-07 run
  (`docs/said-as/chats-4-runs-on-round2.jsonl`); I have not checked it on the
  current build. Worth a look as a bug whatever else we do.

## What outside work says

### Scripted bots feel rigid, and the fix that worked kept the script

- **Woebot**, the therapy chatbot, ran for years on text written entirely by
  people, with software only choosing which piece to show. That is Fred's
  design. Their reason was the same as ours: control over what is said. When
  they tested a large model, it "truly shone on an emotional level" but
  skipped ahead in exercises and didn't hold the bot's tone, so they kept the
  human-written structure and let the model in only behind checks
  ([IEEE Spectrum](https://spectrum.ieee.org/woebot)).
- A 2025 study put three designs side by side: a fully scripted bot, a free
  large model, and a model that had to follow the experts' script but could
  word it itself. The third beat the scripted bot on felt empathy (2.5 → 3.1
  out of 5), engagement and language quality. People said of the scripted one:
  "more like a good lesson than a conversation"
  ([arXiv 2411.06723](https://arxiv.org/html/2411.06723v2)). Small study (43
  people), and it used GPT-4o, far bigger than anything on a phone.
- Rasa, a chatbot toolkit, ships this as a feature: the reply is a fixed
  template and a model only rewords it to fit the conversation
  ([Rasa docs](https://www.rasa.com/docs/reference/primitives/contextual-response-rephraser/)).
  They warn the model can say things you didn't intend.

**For Fred:** the direction is right (keep reviewed content, vary the
surface), but Fred already tried the rewording step with his model and it
flipped the card's meaning ("Yes, she can walk on it" against a card that
says rest; `results-responsive-replies.md`). At this model size the surface
has to be varied by rules and by writing, or the model has to be boxed in
much more tightly than a prompt can do.

### Showing you heard someone can be done without a model

- In the standard account of how people show understanding, repeating back
  part of what the other person said is the strongest signal, above "uh huh"
  and above simply carrying on
  ([Clark and Brennan 1991](https://web.stanford.edu/~clark/1990s/Clark,%20H.H.%20_%20Brennan,%20S.E.%20_Grounding%20in%20communication_%201991.pdf)).
- A 2019 paper built replies that mirror and rephrase the user's words.
  Its simple rule-based version was rated about as good as the neural one and
  close to human-written replies
  ([Mimic and Rephrase](https://aclanthology.org/K19-1037/)).

**For Fred:** he already keeps a record of the conversation by fixed rules
(who is hurt, what happened, the setting). A first line like "Okay, your mom's
wrist." can be built from that record with no model call, in front of any
reply, including cards.

### Warmth helps, but the wrong kind backfires

- People prefer a health chatbot that expresses sympathy over one that gives
  advice flatly
  ([Liu and Sundar 2018](https://pure.psu.edu/en/publications/should-machines-express-sympathy-and-empathy-experiments-with-a-h/)).
- But when a chatbot claims feelings ("I feel for you"), people find it less
  genuine, and that cancels part of the gain. The kind of warmth with no such
  penalty was showing care through helping
  ([Seitz 2024](https://fis.leuphana.de/en/publications/artificial-empathy-in-healthcare-chatbots-does-it-feel-authentic/)).
- A warm reply may also be harder to doubt when it is wrong
  ([JMIR Human Factors 2026](https://humanfactors.jmir.org/2026/1/e108778/PDF)).

**For Fred:** name the situation and get to work ("Okay, a twisted ankle.
Let's get the weight off it."). Go easy on "Oh no" and "Sorry", and keep the
rule that Fred never says how things will turn out.

### In an emergency, good talk is short, steady and one thing at a time

- Emergency call-takers are trained to give firm step-by-step instructions,
  repeat the key instruction in the same calm words, and give the caller a
  job to do, which itself calms them
  ([IAED on repetitive persistence](https://www.iaedjournal.org/repetitive-persistence);
  [KOVA guide](https://gd.kovacorp.com/?p=2159)). Dispatchers describe their
  role as taking the weight of responsibility off the caller.
- Public-health crisis guidance says people under stress miss detail and
  remember what comes first and last, so: simple words, brief, positive
  actions ([CDC CERC](https://www.emergency.cdc.gov/cerc/ppt/CERC_Psychology_of_a_Crisis.pdf)).
  The often-quoted "people lose 80% of their ability to take in information"
  comes from training slides, not a study I could find.

**For Fred:** personality should change with urgency. In an emergency the
warm thing is a calm voice and one clear action, not a greeting. A
1,000-character card is the opposite of what this guidance describes.

### Step-by-step help: all at once is the known weak spot

- A study of home cooks using Alexa found that reading written steps aloud as
  they are hid the big picture and overloaded people. The fixes it names:
  summarise first, signpost, split long steps, reorder, volunteer the next
  thing ([Rewriting the Script](https://arxiv.org/abs/2306.09992)).
- Rewriting tasks into steps of manageable size was preferred in 86% of cases
  ([Ferreira et al. 2023](https://arxiv.org/abs/2309.11271v1)).
- An assistant that offers the next useful thing got nearly twice as much
  back-and-forth as one that only answers
  ([Frummet et al. 2024](https://epub.uni-regensburg.de/74598/1/3649500.pdf)).
- About a quarter of what people say during a guided task is not a question
  at all but a cue like "ok, done"
  ([Vtyurina and Fourney 2018](https://cs.uwaterloo.ca/~avtyurin/papers/Vtyurina_ConversationalCues.pdf)).
  Fred answers those with "Got it".
- Google's own design guide: write several versions of the lines people hear
  most and rotate them, because repetition is what makes an assistant sound
  robotic ([Google conversation design](https://developers.google.com/assistant/conversation-design/learn-about-conversation)).

These studies are about cooking and voice, not first aid on a screen. Nobody
seems to have tested one-step-at-a-time against all-at-once for first aid.

### Newer small models, as a swap

- **OCC-RAG-1.7B** (June 2026) is Fred's current model family, Qwen3-1.7B,
  given extra training to answer only from the passages it is handed and to
  say so when they don't answer. On a test of sticking to the given text it
  scores 81 against 65 for plain Qwen3-1.7B, and on correctly declining 87
  against 55 ([arXiv 2606.00683](https://arxiv.org/html/2606.00683v1)). Same
  size as today, so speed should be close, and phone-ready files exist
  ([Hugging Face](https://huggingface.co/occ-ai)). Unknowns: the licence
  isn't shown on the page; it writes its reasoning before the answer, which
  costs time; nothing is said about tone; the numbers are the authors' own.
- **Gemma 4 E2B** (Google, April 2026) is a little bigger than Fred's model.
  A team building an offline medical assistant for midwives found Gemma 4
  about twice as faithful to its sources as the previous Gemma, and cut
  wrongly-declined questions from 33% to 3% by picking it and reworking the
  prompt ([arXiv 2606.29580](https://arxiv.org/abs/2606.29580); the paper was
  later withdrawn over a licensing matter, so treat it as a lead). Reported
  file sizes disagree (1.3 GB to 3.1 GB), so it needs checking before
  anything else.
- Fred's two earlier swaps both lost (`results-qwen35-2b.md`,
  SmolLM2). Qwen's own figures rank Qwen3-1.7B above Qwen3.5-2B at following
  instructions, which matches what we measured.

### Boxing the model in, harder than a prompt can

The phone's model library can restrict the model to a set of allowed words
while it writes (a "grammar"), instead of checking afterwards. Fred's opener
check is already "only the hiker's words plus an allowed list", and it throws
away about three lines in ten. Written as a grammar, the model could only
produce lines that pass. Caution from two 2026 papers: forcing shape on small
models can make the content worse even when the shape is perfect
([The Constraint Tax](https://www.alphaxiv.org/abs/2605.26128);
[arXiv 2609.23742](https://arxiv.org/pdf/2609.23742)). A cheap thing to probe,
not a sure thing.

## Options, ranked

Ranked by how much of the conversation each touches, against what it risks
and costs. "Free" means no model call, so no added wait.

| # | Option | Touches | Risk to accuracy | Speed cost | Effort |
|---|---|---|---|---|---|
| 1 | **Several "Got it" replies, picked by what was just said** ("thanks" → "Anytime."; "ok it's off" → an acknowledgement that names it; never the capability list twice) | 23% of replies | None: fixed, reviewed text | Free | Small |
| 2 | **A first line built by rules from the conversation record** ("Okay, your mom's wrist."), in front of cards and fixed replies | Up to ~75% of replies | Low: only the hiker's own words and a fixed list; skipped in an emergency | Free | Medium |
| 3 | **Cards said in turns**: the point, the next two or three actions, the don'ts that matter now, then a check-back; whole card folded underneath | 34% of replies | Medium: what is folded can be missed. Needs a rule for what must always show | Free | Medium to large |
| 4 | **A check-back line per card** ("Has the bleeding slowed?"), written and reviewed with the card. Extra text on existing cards, not new cards | 34% of replies | Low | Free | Medium (writing and review) |
| 5 | **A tone that follows urgency**: calm and brief in an emergency, sympathetic for a problem, friendly for a plain question | All replies | Low | Free | Small, mostly rules Fred already has |
| 6 | **Softer dead ends**: when Fred has nothing, say what he did understand and ask one useful question | 20% of replies | Low to medium: must not read as an answer | Free | Medium |
| 7 | **Chat look**: Fred's words as speech, the card as something he hands over | All replies | None | Free | Medium (app only) |
| 8 | **Try OCC-RAG-1.7B and Gemma 4 E2B** on the desktop sets | 12% of replies | Measured before anything ships | Unknown until run | Medium (a day or two of runs) |
| 9 | **Opener written under a word-list grammar** rather than checked after | 12% of replies | Low | Probably none | Small probe |
| 10 | **Let the model reword cards** | 34% of replies | High: already flipped a card's meaning once | 5-10 s per reply | Not recommended now |

### What I would do first

**Options 1, 2 and 5 together**, as one small round. They touch most of the
conversation, cost no time on the phone, and cannot put a wrong fact on the
screen. Then **option 3 as an experiment** with a handful of cards, because
it is the biggest change to how Fred feels and also the one that needs your
judgement about what may be folded away. **Option 8 in the background**, since
it only needs desktop runs, one at a time.

### What I would not do

- More field cards (your call from 2026-10-01 stands, and nothing here needs
  them).
- Fine-tuning. OCC-RAG is someone else's already-trained model, so trying it
  is a swap.
- A looser prompt to make the model "friendlier". Every time the prompt gave
  this model more room, it filled the room with wrong statements
  (`results-thin-answers.md`, `results-answer-shape.md`).

## How we would know it worked

"Sounds like Fred" is already the fourth thing answers are graded on, but it
is judged one reply at a time. Sterile is a whole-conversation problem, so:

- **Blind side-by-side on whole chats**: the same chat, old Fred and new,
  shuffled; which would you rather have with you? Count wins, losses and ties
  on the chats that changed.
- **Repeats**: share of chats where Fred says the same thing twice (38% now).
- **Heard**: share of replies that use something the hiker said (who, what,
  where).
- **Unchanged**: every safety count, the answer text itself wherever it is a
  card, and time to first words on the phone.

## Ryan's answer on the cards (2026-10-08), and what it changes

"They don't take into full account what the user said. If I say 'something
something BURN' the burn card will show up. It shows up quickly, which is
good, but might not be tailored to the exact situation."

That is the second bullet above (the card doesn't notice who is asking), and
it moves tailoring the card itself to the top of the list.

Where Fred stands: a message is matched to a card by topic, and the card is
then shown whole. Only 3 of the 43 cards adapt at all (burns, heat illness,
stings and bites), each on one detail. Even then the fit is loose: "burned my
hand on the stove, it's blistering" picks the blistered-skin steps but still
opens with "If clothing is on fire: stop, drop and roll" and "Work out the
kind of burn".

Ways to tailor without the model rewriting anything, so speed and safety stay
as they are:

- **Mark each step with when it applies** ("only if clothing is on fire",
  "deep burn only", "if it's an arm or leg"). Fred shows the steps that fit
  what was said and folds the rest. This is the three-card idea made general.
  It is review work on existing cards, not new cards.
- **Read more details out of the message by rules**: who (child, adult, dog),
  where on the body, what caused it, how bad, what they have already done,
  what they don't have. Fred's conversation record holds some of this already.
- **Let a detail pull a line forward.** The burn card's get-help line covers
  burns to the face; if the hiker said "face", that line leads. The search
  model already matches card lines to questions well (13 of 15); the same
  match could run on statements.
- **Ask when one missing detail would change the steps**, most dangerous
  possibility first, which is how phone triage scripts are ordered.
- **Name the situation in the first line**, from the hiker's own words.

## Open questions for Ryan

1. What exactly feels odd about the cards: the look, the length, that they
   ignore what you said, or the short answers pulled from them?
2. Is it acceptable for part of a card to be folded away in a non-emergency,
   if the don'ts and the get-help line always stay visible?
3. Should Fred ask things back ("Has the bleeding slowed?"), or does that
   feel like too much from a phone in the woods?
