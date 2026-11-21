# Fred's website

Static, no build step. `index.html` + `home.css` + `home.js` is the front page;
`privacy/` (with the older `style.css`) is the privacy policy App Store Connect
links to: keep its URL.

Preview: `python3 -m http.server -d site 8000`, then http://localhost:8000.

## The idea

The page is one walk, from a morning trailhead to camp at night. The sky follows
the app's own colours (`apps/mobile/src/theme.tsx`: day, `SUNSET`, night), a
dotted trail runs down the left gutter through a milepost per section, and the
status pill loses a bar per stretch until there's no service, while Fred keeps
answering.

## Where things go

| What | Where |
|---|---|
| Footage / screenshots | `<figure data-slot="first-aid|survival|map">` in `index.html`. Swap the `.phone` inside for a `<video autoplay muted loop playsinline>` or `<img>`; the phones there now are HTML redrawings of the app. |
| Store links | `RELEASE LINKS` comment in the camp section. Both buttons point at the GitHub repo for now. |
| Numbers in Field notes | From `docs/METRICS.md` (2026-10-06 held-out run). Update by hand. |
| Hills, trees, stars, contours | Drawn by `home.js` from seeds, so they're the same on every visit. Colours are CSS variables in `home.css`. |
| `og:image` | Needs an absolute URL once the domain is live. |

Fonts are self-hosted (no third-party requests): Fraunces and Public Sans,
both SIL Open Font License.

## Hosting

Vercel: import the repo, set **Root Directory** to `site`, framework "Other",
no build command. The GitHub Pages workflow (`.github/workflows/pages.yml`)
also publishes `site/` on pushes to main; retire it once the domain points at
Vercel and App Store Connect's privacy URL is updated.
