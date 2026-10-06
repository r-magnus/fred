# One model context: memory and the first question (#133, #134)

2026-10-04, Nothing Phone (3), every new pack staged.

**Short version: the app holds 2.9 GB, not 5.4 GB, and an emergency asked the
moment the app opens gets its reply in 3.2 s, not 26 s. Later answers are as
fast as before and say exactly what they said.**

## What was wrong

The intent check and the understanding step each had a model context of
their own (#101), so their fixed prompts stayed read between messages. Each
context turned out to hold its own copy of the model's weights, about 0.8 GB,
not just its prompt cache (~120 MB, as assumed):

| | App memory (PSS) |
|---|---:|
| Loaded (answer context) | 3.76 GB |
| After both extra contexts were set up | 5.40 GB |

Setting them up on the first message cost that message 24 s of model time:
"there's smoke and fire coming up the ridge toward us", the first question
after launch, got the emergency reply after 26 s (9 s once the app had
answered something else). A background warm-up at launch (first try) brought
it to 3.3 s for a question asked 8 s after opening, but asked at once it was
28.5 s: the warm-up starved the question's embedding (20 s instead of 1.5 s).
A generated opener (#130) added a third context and was slower everywhere.

## What changed

- One context for every model call. A lane's system prompt is read once,
  saved to a file (named by lane and a hash of model and prompt), and loaded
  before the lane's next call (~36 and 55 MB on disk). The files outlive the
  app: only the very first launch reads the prompts (a 7 s background
  warm-up); later launches need none.
- Every call starts from a known state: a lane from its saved prompt, an
  answer from an empty context. Reusing what the last call left changed an
  answer's wording; a saved answer prompt made answers differ from the
  desktop's, where accuracy is graded, to save under a second. Both dropped.
- The embedder is unchanged (fresh per text: a reused one gave wrong vectors).

## Results (phone, cooled before each run)

| | Before | After |
|---|---:|---:|
| App memory after setup | 5.40 GB | **2.92 GB** |
| Fire message, first question after launch | 26.1 s | **3.2 s** |
| "i dropped my water filter in the river, ugh, what now" (first in session) | 12.2 s | **3.4 s** |
| Intent check | 0.3 s warm, 2.4 s+ cold | 0.3 s always |
| Session: rope / diarrhea / desert / dress, first words | 16.5 / 9.2 / 7.9 / 10.7 s | 12.5 / 11.3 / 10.1 / 12.2 s |
| Card replies (hot spots, pond) | 3.5 / 2.0 s | 3.4 / 2.0 s |

Answer text: identical to the release for every answer except the third of
the session, a follow-up whose wording in the release depended on the answer
before it; it is now the same whatever came before.

Session answers 2-4 come 1-2 s later than the release's: the release read
those answers' instructions once and reused them across answers, which made
each answer's wording depend on the previous question. Kept as is: the
phone should say what the desktop graded.
