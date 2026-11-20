# TestFlight text: DRAFT for Ryan to rewrite

Not to be pasted as-is (RELEASE-HANDOFF.md §5 step 4: Ryan writes these).
Facts checked against `site/privacy/` and #247–#249 on 2026-11-19.

## Test Information

**Beta App Description** (testers see this)

> Fred is an offline field guide for first aid, survival, and the plants and
> animals around you. He runs entirely on your phone, works without signal, shows
> his sources, and says when he doesn't know. On first launch Fred downloads his
> guides (about 1.5 GB, Wi-Fi recommended); after that he works offline. Fred is
> a CS-195 senior project at Westmont College and is in beta: don't rely on him in
> a real emergency, and call emergency services if someone is hurt.

**Feedback Email:** *(Ryan's choice)*
**Privacy Policy URL:** https://r-magnus.github.io/fred/privacy/
**Marketing URL (optional):** https://r-magnus.github.io/fred/

## Beta App Review Information

- Contact name / phone / email: *(Ryan)*
- Sign-in required: **off** (Fred has no accounts)

**Review Notes**

> - First launch: after the welcome page, Fred downloads about 1.45 GB of guides
>   and an on-device language model from GitHub. Please use Wi-Fi and allow a few
>   minutes; the app is not stuck. After that, everything runs offline.
> - The last setup page shows a beta notice; tick the box to enable Start.
> - Location is used only on the device: to pick the regional plant and animal
>   guide, show the map, and plan routes. It is never sent anywhere.
> - Ratings: under each answer are thumbs up/down. Only when the user taps one is
>   that question, the answer, and an optional comment sent to the developer.
>   Ratings carry no account, location or device ID, and they are never shown to
>   other users (no user-generated content is shared).
> - First aid and safety answers are informational and cite their sources (e.g.
>   U.S. Army field manuals). Fred points users to emergency
>   services and is not a medical device.
> - Example question: "How do I treat a bee sting?"

## What to Test (build 14)

> First build for outside testers. Please try: setting Fred up from scratch (the
> guide download), asking a few questions about first aid, survival or local
> wildlife, and rating answers with the thumbs: a thumbs down with a comment
> about what was wrong helps most. Also try "I'm lost" to open the offline map.
