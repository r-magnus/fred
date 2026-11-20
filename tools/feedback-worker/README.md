# Fred feedback server (#247)

Where the app's thumbs up/down go. A Cloudflare Worker takes one rating per
`POST /feedback`, checks it (`src/check.ts`) and keeps it in a D1 (SQLite)
database. Both are on Cloudflare's free plan: 100,000 requests a day, 5 GB of
storage, and the free plan never puts them to sleep.

The app keeps every rating on the phone (`apps/mobile/src/feedback.ts`) until
this server answers `200`, so a hiker out of signal loses nothing.

## What a rating holds

The question, Fred's reply and its sources, up or down, the optional "What can
Fred do better?" comment, whether deep thinking was on or the answer was
stopped, the times, the app version and the phone's OS. **No location, no
device or person id.** The comment box in the app says that the question and
reply are sent.

## Set up (once)

From `tools/feedback-worker`:

1. `npx wrangler@4 login` (opens a browser; use the Fred Cloudflare account).
2. `npx wrangler@4 d1 create fred-feedback`, then put the `database_id` it
   prints into `wrangler.toml`.
3. `npx wrangler@4 d1 execute fred-feedback --remote --file schema.sql`
4. `npx wrangler@4 deploy`. It prints the address, e.g.
   `https://fred-feedback.<account>.workers.dev`.
5. Put `<that address>/feedback` as `FEEDBACK_URL` in
   `apps/mobile/src/feedback.ts`, then build the app again. Builds before this
   keep their ratings on the phone and send them once a build that knows the
   address is installed over them.

Check it from a shell:

```sh
curl -s -X POST https://fred-feedback.<account>.workers.dev/feedback \
  -H 'X-Fred-Client: fred-app/1' -H 'Content-Type: application/json' \
  -d '{"id":"smoke-test","rating":"up","comment":null,"question":"test","reply":"test","replyKind":"answer","sources":[],"deep":false,"stopped":false,"askedAt":"2026-11-19T00:00:00Z","ratedAt":"2026-11-19T00:00:00Z","appVersion":"0.0.0","platform":"curl"}'
# kept
```

## Read the ratings

```sh
# The newest thumbs down, with what was said
npx wrangler@4 d1 execute fred-feedback --remote --command \
  "SELECT received_at, question, comment, substr(reply,1,200) AS reply FROM feedback
   WHERE rating='down' ORDER BY received_at DESC LIMIT 20"

# Up and down so far
npx wrangler@4 d1 execute fred-feedback --remote --command \
  "SELECT rating, count(*) FROM feedback GROUP BY rating"

# Everything, as JSON, for a closer look
npx wrangler@4 d1 execute fred-feedback --remote --json --command "SELECT * FROM feedback" > ratings.json
```

The Cloudflare dashboard (Workers & Pages › D1 › fred-feedback › Console)
runs the same queries in a browser.

## Abuse

Anything inside an app can be read out of it, so there is no secret key. What
keeps junk out: the `X-Fred-Client` header, a 30-a-minute limit per address
(`[[ratelimits]]` in `wrangler.toml`), a 48 KB cap per request, and the field
checks in `src/check.ts`. Ratings are only ever read by the Fred team, never
shown to other users, so App Review's user-generated-content rules don't
apply (RELEASE-HANDOFF.md §5).

Delete test rows with
`npx wrangler@4 d1 execute fred-feedback --remote --command "DELETE FROM feedback WHERE platform='curl'"`.
