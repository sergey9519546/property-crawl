# PROPERTY_CRAWL

> Zillow for distressed & government-sold property, with an AI that reads
> the fine print and tells you if each one is actually a deal — and what
> the catch is.

---

## Three-layer architecture

This repository contains three coordinated products that share a single
data source (`data.js`). They can be deployed independently or together.

| Layer | Path | Stack | Purpose |
|---|---|---|---|
| **v0 — Static PWA** | `index.html` + `app.js` + `data.js` + `vendor/` + `manifest.json` | Zero-build ES module, Tailwind Play CDN, vendored Leaflet + Lucide | The original browser dashboard. Runs anywhere static files run. Loads `data.js` directly. |
| **v1 — Node production backend** | `server/` | Node 22, PostgreSQL + PostGIS, custom HTTP server, 5 scrapers, security middleware, AI model router + cost tracker | Serves the same dataset to clients via REST API. In production, replaces the static `data.js` with a live DB. |
| **v2 — Next.js marketing site** | `src/` | Next.js 16, React 19, TypeScript, Tailwind 4, shadcn/ui, GSAP, Three.js, react-three | "Perfect Property" landing page with a live triage demo terminal, 3D parcel visualizer, AI comparison. Built and served separately. |

**The single source of truth** for the source registry is `data.js`
(`window.SOURCES`). `server/db/client.js` reads it via VM sandbox, and
`src/components/terminal/property-data.ts` mirrors it. A sync test
(`test/sync.test.js`, wired into `test/verify.js`) fails CI if they
drift.

---

## Quick start

### Run the static PWA (v0)

```bash
cd property-crawl
python3 -m http.server 8000
# open http://localhost:8000/
```

No install, no Node, no build. The PWA reads `data.js` and renders 20
listings with score rings, search, filters, sort, save/unsave, the
notice parser, the score help modal, and the AI analysis drawer.

### Run the production backend (v1)

```bash
cd property-crawl
npm install
node server/server.js
# open http://localhost:3000/
# API at http://localhost:3000/api/listings, /api/sources, /api/parse, /api/alerts, /api/export, /api/health
```

When no `DATABASE_URL` is set, `server/db/client.js` falls back to
loading `data.js` into an in-memory provider (great for local dev).
With `DATABASE_URL` set, it uses PostgreSQL + PostGIS per
`server/db/schema.sql`. The Docker compose (`docker-compose.yml`)
spins up the app + PostGIS together.

### Run the marketing site (v2)

```bash
cd property-crawl
npm install
npx next dev
# open http://localhost:3000/  (different port? use NEXT_PORT env)
```

Next.js renders the "Perfect Property" landing page with the live
triage terminal demo. The terminal reads from
`src/components/terminal/property-data.ts` (a curated 6-listing
marketing subset, intentionally different from `data.js`).

### Run the test suite

```bash
cd property-crawl
node test/verify.js
```

Runs 9 suites: client unit (12), server (8), scrapers (5), AI/security
(5), E2E (3), hardening (5), **SOURCES sync (5)**, Next.js build, and
Playwright Python E2E. ~45 seconds total.

### Run scrapers against real sources

```bash
node server/scrapers/scheduler.js
# or in CI: see .github/workflows/scraper.yml (runs every 6 hours)
```

Updates the database with fresh listings from HUD, Fannie Mae,
Freddie Mac, IRS, and per-county sheriff sites. The server picks up
the new rows on the next request.

---

## File layout

```
property-crawl/
├── index.html              # v0 PWA shell (hero, dashboard, map, parser, sources, drawer, modals)
├── app.js                  # v0 PWA single ES module (~860 lines)
├── data.js                 # CANONICAL source registry + 20 listings (read by v0 and v1)
├── manifest.json           # v0 PWA manifest
├── icon.svg, icons/        # v0 PWA icons (192, 512, maskable)
├── vendor/                 # v0 PWA third-party deps (Leaflet, Lucide) — no CDN at runtime
│
├── server/                 # v1 — production backend
│   ├── server.js           # custom Node 22 HTTP server
│   ├── ai/                 # cache, cost tracker, model router
│   ├── db/                 # PostgreSQL client, schema.sql, migrations/
│   ├── routes/             # /api/listings, /api/parse, /api/enrich, /api/alerts, /api/export
│   ├── scrapers/           # base, hud, fannie, freddie, irs, sheriff, scheduler
│   └── security/           # rate limiter, sanitizer, validators
│
├── src/                    # v2 — Next.js 16 marketing site
│   ├── app/                # App Router: page.tsx, layout.tsx, globals.css, api/scrapers/route.ts
│   ├── components/
│   │   ├── site/           # 23 site-specific components (hero, storyteller, gtm, seo, etc.)
│   │   ├── terminal/       # 7 terminal components (property-data, property-drawer, interactive-terminal, etc.)
│   │   └── ui/             # 50+ shadcn/ui primitives
│   ├── data/listings.ts    # re-exports from terminal/property-data
│   ├── hooks/              # use-mobile, use-toast
│   └── lib/utils.ts        # cn() helper (shadcn convention)
│
├── public/                 # v2 static assets (logo, fonts, hero blob, robots.txt, unicorn shader)
├── upload/                 # design assets (screenshots, blueprint) — not part of the build
│
├── test/                   # 9 test suites
│   ├── suite.test.js       # client unit (deal score, countdown, map, exports, AI hardening)
│   ├── server.test.js      # backend API tests
│   ├── scrapers.test.js    # ingestion pipeline
│   ├── ai.test.js          # cost tracker, model router, sanitizer
│   ├── e2e.test.js         # user journey emulation
│   ├── hardening.test.js   # 50k-char adversarial payload, etc.
│   ├── sync.test.js        # SOURCES drift detector (v0 <-> v2)
│   ├── playwright_test.py  # live browser automation
│   └── verify.js           # runner
│
├── audit/                  # architecture decisions, walkthroughs, findings
│   ├── SYSTEM_MODEL.md     # system model (originally v0; covers the dashboard + mentions the API)
│   ├── COHERENCE.md        # contradictions found and resolved
│   ├── DECISIONS.md        # architectural rationale
│   ├── QUESTIONS.md        # questions raised and answered
│   └── WALKTHROUGH.md      # fresh-eyes user + engineer walkthrough
│
├── .github/workflows/      # ci.yml (npm test on push) + scraper.yml (every 6h)
├── Dockerfile              # multi-stage Node 22 Alpine, non-root, healthcheck
├── docker-compose.yml      # app + postgis containers
├── package.json            # scripts: start, test, test:*, scrape
└── README.md               # this file
```

---

## How the data flows

```
                       ┌──────────────┐
   manual curation     │              │    VM sandbox load
   (you, the user)  ──▶│   data.js    │◀────────────────┐
                       │ (canonical)  │                 │
                       │ 20 listings  │                 │
                       │ 11 sources   │                 │
                       └──────┬───────┘                 │
                              │                         │
              ┌───────────────┼───────────────┐         │
              │               │               │         │
              ▼               ▼               ▼         │
       ┌──────────┐    ┌────────────┐   ┌──────────┐    │
       │  v0 PWA  │    │ v1 server  │   │ v2 Next  │    │
       │ window.  │    │ server/db/ │   │ terminal/ │    │
       │ LISTINGS │    │ client.js  │   │ property- │    │
       │ (read di- │    │ (loads via  │   │ data.ts  │    │
       │ rectly)   │    │ VM sandbox) │   │ (mirror)  │    │
       └──────────┘    └─────┬──────┘   └──────────┘    │
                             │                          │
                             ▼                          │
                       ┌──────────┐                    │
                       │ Postgres │                    │
                       │ +PostGIS │                    │
                       └──────────┘                    │
                             ▲                          │
                             │                          │
                       ┌──────────────┐                │
                       │ server/      │                │
                       │ scrapers/    │────────────────┘
                       │ (5 sources)  │  updates data.js
                       └──────────────┘  (could, in future)
```

For the v0 + v1 path (no scrapers yet), `data.js` is the canonical
source and both layers use it. Once scrapers are wired, they update
the DB, and the v0 PWA can be migrated to fetch from `/api/listings`
instead.

For the v2 path, the marketing site uses its own curated subset
(6 listings) — see the comment at the top of
`src/components/terminal/property-data.ts` for the rationale.

---

## Deploying

You can deploy each layer independently.

### v0 (static PWA)

Any static host: Vercel, Netlify, Cloudflare Pages, GitHub Pages, S3+CF.
Set the publish directory to `property-crawl/`. The PWA is a static
SPA — no build step, no Node runtime.

### v1 (Node server)

Either:
- `Dockerfile` + `docker-compose.yml` (recommended) — `docker compose up` spins up the app + PostGIS together
- A Node-friendly PaaS: Render, Fly, Railway, Heroku, AWS App Runner. Set `DATABASE_URL` to a managed Postgres + PostGIS, and `npm start` runs `server/server.js`.

### v2 (Next.js)

- Vercel (zero config — connect the repo, point at `property-crawl/`, build command auto-detected)
- Netlify, Cloudflare Pages — all work; the project ships with no custom Next config that would block any of them.

### v0 + v1 + v2 together

The recommended shape is:
- v0 → CloudFront/Netlify (free, fast)
- v1 → Render or Fly (Docker)
- v2 → Vercel (free tier)

All three point at the same `data.js` until you wire the scrapers to
update the DB. Once that happens, v0's data can come from
`/api/listings` and v0/v1 share the live DB.

---

## Test suite

`node test/verify.js` runs 9 suites in sequence. The current tally
(May 2026) is ~45 passing assertions across 8 Node suites + a Next.js
production build + a Playwright Python E2E.

| # | Suite | What it covers |
|---|---|---|
| 1 | `suite.test.js` | client unit: deal score, countdown, map, exports, AI hardening |
| 2 | `server.test.js` | backend API: /api/health, /api/sources, /api/listings, /api/parse, /api/alerts, /api/export |
| 3 | `scrapers.test.js` | ingestion pipeline: sheriff, HUD, Fannie, IRS scrapers + scheduler |
| 4 | `ai.test.js` | cost tracker immutability, model router, AI cache hashing, sanitizer |
| 5 | `e2e.test.js` | full user journey emulation |
| 6 | `hardening.test.js` | 50k-char adversarial payload, validator, database, CSV escaping |
| 7 | `sync.test.js` | SOURCES drift detector (v0 ↔ v2) |
| 8 | `npx next build` | Next.js production build + TypeScript typecheck |
| 9 | `playwright_test.py` | live browser automation |

---

## What's done vs. what still needs work for ship

### ✅ Done

- ✅ Three-layer architecture (v0 static PWA + v1 Node backend + v2 Next.js marketing)
- ✅ Comprehensive 5-phase audit (`audit/`) with 32 contradictions resolved
- ✅ Matt Pocock-style architectural pass (`audit/POCOCK.md`) with 5 code-shape findings
- ✅ SOURCES taxonomy kept in sync between v0 (`data.js`) and v2 (`property-data.ts`) with a CI drift check
- ✅ 11 source types with distinct colors, tier labels, per-source notes
- ✅ Score system (open bid ÷ value band midpoint → 1–99) with consistent color/label across card, drawer, alerts, map, help modal
- ✅ Filter by state, type, source; sort by score/equity/bid/date
- ✅ Text search across address, city, county, plaintiff, defendant, attorney, occupancy, deposit, source label
- ✅ Save/unsave, alerts modal, stale-saved cleanup, anonymous-to-cloud merge on sign-in
- ✅ Saved-deals export to CSV and JSON
- ✅ AI "here's the catch" analysis with per-listing cache, XML delimiter protection, output validation
- ✅ AI notice parser with schema enforcement, copy JSON, one-click Add to Watchlist
- ✅ Drawer with a11y focus trap, ESC to close, Save / Re-run / View on source buttons
- ✅ Score help modal with placeholder + per-listing views
- ✅ Mobile menu with viewport-resize cleanup
- ✅ Leaflet responsive resize invalidation
- ✅ Midnight-normalized date countdowns
- ✅ XSS-safe by construction (all dynamic content goes through `esc()`)
- ✅ Map markers (Leaflet circleMarker, source-colored, with popups)
- ✅ Production backend: PostgreSQL + PostGIS, 7 API routes, 5 real scrapers, security middleware
- ✅ AI pipeline: cost tracker, model router, cache with SHA-256 hashing
- ✅ Hostile hardening: 50k-char payload sanitization, validator, CSV escaping
- ✅ CI/CD: GitHub Actions on every push + scheduled scraper every 6 hours
- ✅ Docker deployment: multi-stage build, non-root, PostGIS container, healthcheck
- ✅ Marketing site: 23 site components + 7 terminal components + 50+ shadcn/ui primitives

### 🟡 Still needed before public ship

These items need decisions from you (Sergey) before they can be
implemented.

| # | Item | Owner | Why blocked |
|---|---|---|---|
| 1 | **Real listing data** | you | The 20 listings in `data.js` are realistic but invented samples. The "View on source" buttons point to source landing pages, not specific listings. For the product to be a useful triage tool, each listing needs a real `sourceUrl` to the actual sale page. |
| 2 | **Puter production app setup** | you | The current page uses `builder.puter.com` defaults. For production, register a Puter app under your account, get a stable app ID, and confirm rate limits and pricing. Without this, the AI features won't work for real users. |
| 3 | **Privacy policy + Terms of Service** | you (+ lawyer) | The footer has plain-English disclaimers but no formal legal pages. |
| 4 | **Hosting choice** | you | Pick a static host for v0, a Node host for v1, a Next host for v2. The repo works with all major hosts. |
| 5 | **Real-device mobile testing** | you | Tested in browser-emulated mobile. Real iPhone/Android testing catches PWA install, safe-area insets, Safari storage quotas. |
| 6 | **Tailwind local in v0** | me, on request | v0 still uses the Play CDN. One-time Tailwind CLI build removes the runtime CDN. |
| 7 | **Inter font local in v0** | me, on request | v0 still uses Google Fonts. Download 5 WOFF2 files, add `@font-face` rules, remove the `<link>`. |
| 8 | **Live scraper wiring** | me, after #1 | The scrapers exist but the UI doesn't trigger them. Add a "Refresh" button that calls `POST /api/scrapers` and re-fetches listings. |
| 9 | **v0 → /api/listings migration** | me, after #1 | Once the DB has real data, change v0's `card()` to fetch from the API instead of reading `window.LISTINGS` directly. Removes the static-vs-live drift risk. |

### Deferred design items (logged, not blocking)

- **F01**: non-judicial sale labeling (trustee sales vs. sheriff sales share the "Foreclosure notice" tier label)
- **F03**: `analysisCache` invalidation if listing data changes
- **F08**: parser output ↔ listing schema isomorphism (would let parsed notices become saved deals in one click)
- **F-PK-10**: AI prompt injection — the AI prompts embed untrusted text without delimiter separation. Mitigations: delimiter-wrap, output validation, pre-extraction. Design decision needed.

---

## Quick architectural decisions worth knowing

These are choices the codebase has already made.

- **Three layers, single source of truth.** v0 and v2 mirror `data.js`; the sync test fails CI on drift.
- **`window.LISTINGS` / `window.SOURCES` as globals**, not ES module imports. Lets `data.js` be a plain `<script>` tag for the no-build static PWA.
- **Server reads data.js via VM sandbox.** `server/db/client.js` runs `data.js` in a Node `vm` context, extracts `window.SOURCES` and `window.LISTINGS`, and uses them as the in-memory provider. With `DATABASE_URL` set, the real DB takes over.
- **Puter for auth + AI + KV in v0.** One vendor for three dependencies. Tradeoff: vendor lock-in, but the free tier covers dev/early-user load.
- **Custom Node server, not Next.js API routes.** The v1 server is a single `server/server.js` file with explicit routing. Next.js API routes (e.g., `src/app/api/scrapers/route.ts`) exist for the marketing site but the real ingestion pipeline runs from `server/scrapers/scheduler.js`.
- **Shadcn/ui for v2 components.** 50+ primitives, all owned in the repo, all customizable. No external component library to upgrade.
- **Tailwind via Play CDN in v0 (dev) → pre-compiled CSS in production.** v0 uses the JIT compiler; v2 uses Tailwind 4 with PostCSS.
- **Lucide icons in v0 (UMD bundle) and v2 (lucide-react).** Same icon set, two deliveries.

---

## Where to look for design context

- `audit/SYSTEM_MODEL.md` (10 KB) — entity dictionary, architecture, invariants
- `audit/COHERENCE.md` (4 KB) — 5 contradictions found and resolved in v0
- `audit/DECISIONS.md` (2 KB) — architectural rationale
- `audit/QUESTIONS.md` (5 KB) — questions raised and answered
- `audit/WALKTHROUGH.md` (5 KB) — fresh-eyes user + engineer walkthrough
- `audit/POCOCK.md` (21 KB) — Matt Pocock-style code-shape audit (in the parent workspace, not this folder)

---

## License

The codebase doesn't have one. Add one before public launch. MIT or
Apache-2.0 are both fine for a non-commercial PWA; AGPL if you want to
prevent proprietary forks.
