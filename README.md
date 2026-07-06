# Plate & Pixel — restaurant menu rebuild autopilot

Automated B2B outreach pipeline: find US restaurants with ugly digital menus, rebuild each one
into a beautiful branded mobile menu web app, and mail the owner a physical postcard with a
QR code to their new app — quoting one specific mistake from their old site to prove we looked.

```
DISCOVER → ANALYZE (Vision AI) → REBUILD (menu app + deploy) → PITCH (QR + copy) → FULFILL (Lob mail)
                                                                                 → SHOWCASE (before/after frame)
```

## Quick start (no API keys)

```bash
npm install
npm run demo          # full pipeline on the bundled "Kiyomi" fixture
open out/kiyomi/showcase.png
```

The demo produces everything the live pipeline does:

| File | What it is |
|---|---|
| `out/<slug>/before.png` | Full-page mobile screenshot of their current site |
| `out/<slug>/analysis.json` | Ugliness score, verdict, quirk, brand palette, full extracted menu |
| `out/<slug>/app/index.html` | The generated self-contained mobile menu web app |
| `out/<slug>/qr.png` | QR code pointing at the live app URL |
| `out/<slug>/postcard-front.html` / `-back.html` | Print-ready Lob postcard HTML |
| `out/<slug>/postcard.json` | Copy + recipient address |
| `out/<slug>/showcase.png` | The Menubly-style before → after → postcard presentation frame |

## Live pipeline

Copy `.env.example` to `.env` and fill in keys, then:

```bash
node src/index.js run --city="San Diego, CA" --query="sushi restaurants" --limit=10
node src/index.js run --city="Austin, TX" --mail    # --mail actually sends postcards via Lob
```

Each stage can also run standalone (`discover`, `analyze [slug]`, `rebuild <slug>`,
`pitch <slug>`, `fulfill <slug>`, `showcase <slug>`) — see `node src/index.js help`.

### The five stages

1. **Discovery** (`src/stages/discover.js`) — Google Places Text Search for restaurants with
   websites in a target US city. Without a key it falls back to `data/seed-restaurants.json`,
   so you can paste in your own prospect list.
2. **Analysis & Extraction** (`src/stages/analyze.js`) — Playwright loads the site at iPhone
   viewport, takes a full-page screenshot, and scrapes metadata (title tag, computed fonts,
   colors, body text). A vision model via **OpenRouter** scores ugliness 1–10, extracts every
   menu item + price, pulls brand colors/fonts, picks one of three **layouts** to best fit the
   brand (see below), and finds one specific verifiable **quirk**
   (e.g. *"Your website tab title says 'Vid Nikolic' instead of Kiyomi"*). Sites scoring
   below `UGLINESS_THRESHOLD` are skipped — we only pitch people we can genuinely help.
   Every discovered/analyzed lead is also logged to `data/leads.csv` for manual review.
3. **Rebuild** (`src/stages/rebuild.js`) — injects the extracted menu + brand into whichever
   `templates/layouts/<layout>.html` analysis picked, a zero-dependency single-file mobile app
   themed with their own colors. Deploys to Vercel when `VERCEL_TOKEN` is set; otherwise the
   static build in `out/<slug>/app/` works on any host.
4. **The Pitch** (`src/stages/pitch.js`) — generates the QR code and postcard copy. The copy
   must quote the quirk. Renders Lob-compatible print HTML (4x6", bleed-safe, address zone
   kept clear).
5. **Fulfillment** (`src/stages/fulfill.js`) — POSTs front/back HTML + the restaurant's
   registered address to Lob's Postcards API. Use a `test_` key for free dry runs; the run
   log records the Lob id and delivery ETA.

### Layouts (`templates/layouts/`)

One shared skin doesn't read as "hyper-personalized," so rebuild picks between three distinct
compositions per restaurant instead of just recoloring one template:

| Layout | Best for | Look |
|---|---|---|
| `grid-card` | The balanced default (4–6 usable real photos) | Photo-card grid, sticky category pills |
| `list-ledger` | Classic/formal brands, or 3 or fewer usable photos | Typographic printed-menu-card, no photo dependency |
| `magazine-split` | Vibrant/casual brands with 6+ usable real photos | Bold color-blocked editorial spread, alternating imagery |

**Showcase** (`src/stages/showcase.js`) renders the 1920×1080 presentation frame — before
screenshot, phone mock running the real generated app, and the postcard — for demos and
social proof.

## Keys

| Env var | Needed for | Notes |
|---|---|---|
| `OPENROUTER_API_KEY` | analyze, pitch | any vision-capable model; defaults to Claude Sonnet |
| `GOOGLE_PLACES_API_KEY` | discover | optional — seed list fallback |
| `VERCEL_TOKEN` | rebuild deploy | optional — static build otherwise |
| `LOB_API_KEY` | fulfill | `test_...` = free dry run, `live_...` = real mail |

## Guardrails

- Nothing is ever mailed without the explicit `--mail` flag.
- Fulfillment is skipped when the mailing address is incomplete.
- Only sites at or above the ugliness threshold get the treatment.
- Start with a Lob `test_` key and check the rendered PDFs in the Lob dashboard before going live.
