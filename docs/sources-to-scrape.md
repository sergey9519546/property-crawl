# Sources still to scrape — 10 of 11

**Status (2026-08-31):** Treasury is the only real scraper (16 properties fetched). Sheriff, HUD, Fannie, IRS return 1 hardcoded mock each. Trustee, Freddie, USDA, VA, Marshals, GSA have no scraper at all.

**Goal:** Replace 4 mocks + write 6 missing scrapers = 10 new files, all conforming to `server/scrapers/base.js#standardizeListing`. Then `npm run refresh-data:real` produces a data.js with all 11 sources represented (target: 100+ real listings).

## Build order — easiest first

### 1. IRS Seized — `server/scrapers/irs.js` (REPLACE MOCK)
- **URL:** `https://www.irsauctions.gov` (200 OK, front page live)
- **Strategy:** same as Treasury — list page → detail pages, regex-parse
- **Volume:** ~5-10 active listings
- **ToS:** public, no auth. Blueprint: "HTML cards + email subscribe, low volume"
- **Fields:** opening bid, address, parcel no, auction date, deposit, sqft, beds/baths

### 2. GSA Surplus — `server/scrapers/gsa.js` (NEW)
- **URL:** `https://realestatesales.gov` (slow — needs 60s timeout)
- **Strategy:** HTML cards, ~5 live at any time
- **Don't use:** `gsa.github.io/auctions_api` — JSON API exists but is **personal property only** (vehicles, not homes) per blueprint §2
- **Fields:** opening bid, address, photos, auction date, sqft

### 3. USDA RD/FSA REO — `server/scrapers/usda.js` (NEW)
- **URL:** `https://resales.usda.gov` (map search + listing detail)
- **Strategy:** state-by-state list pages → detail pages
- **Note:** blueprint: "data.gov file is dead (2018) — parse the site respectfully"
- **Fields:** address, asking price, beds/baths/sqft, year, photos, state

### 4. VA REO (VRM) — `server/scrapers/va.js` (NEW)
- **URL:** `https://vrmproperties.com` (public browse, ~50-100 listings)
- **Strategy:** browse-by-state page → detail pages
- **Note:** blueprint: "registration only to offer" — public read is fine
- **Fields:** address, price, beds/baths/sqft, year, photos, list date

### 5. Trustee (non-judicial foreclosure) — `server/scrapers/trustee.js` (NEW)
- **URL:** start with `salesweb.civilview.com?countyId=N` (NJ, one URL scheme = most counties)
- **Strategy:** blueprint §1 Hack #1: press-association email alerts (FL, IL, TX, OH, PA, GA) > platform parsers. Bergen alone = 78 sales.
- **Volume:** multi-state = thousands
- **Fields:** address, sale date, plaintiff, defendant, judgment, attorney, opening bid (2/3 appraised)

### 6. Sheriff (judicial foreclosure) — `server/scrapers/sheriff.js` (REPLACE MOCK)
- **URL:** Cuyahoga OH is the v0 default — use `cuyahoga.sheriffsaleauction.ohio.gov` (Realauction platform)
- **Strategy:** identical to trustee — same legal-notice format, just different platform
- **Fields:** identical to trustee
- **Note:** Ohio is judicial; Cuyahoga County Sheriff runs the sales

### 7. HUD Homestore — `server/scrapers/hud.js` (REPLACE MOCK)
- **URL:** `https://www.hudhomestore.gov`
- **Strategy:** **per blueprint, robots.txt blocks crawlers; no official feed.** Two options:
  - (a) Manual daily CSV export (you visit, copy)
  - (b) Daily-check + LLM parse of public listing pages, respect rate limits
- **Volume:** ~900 nationally
- **ToS:** strict — don't hammer
- **Recommendation:** ship (a) for v0 launch; automate (b) post-launch

### 8. Fannie Mae HomePath — `server/scrapers/fannie.js` (REPLACE MOCK)
- **URL:** `https://www.homepath.com`
- **Strategy:** JS-rendered SPA, no API. Options:
  - (a) Partner agreement with Fannie Mae (slow, formal)
  - (b) Headless browser (Playwright) — costs infra
  - (c) Daily manual CSV export
- **Recommendation:** defer unless you have a partner agreement

### 9. Freddie Mac HomeSteps — `server/scrapers/freddie.js` (NEW)
- **URL:** `https://www.homesteps.com`
- **Strategy:** same as Fannie — JS SPA, no API
- **Recommendation:** defer

### 10. US Marshals — `server/scrapers/marshals.js` (NEW)
- **URL:** `https://www.usmarshals.gov/what-we-do/asset-forfeiture` → brokered via `RealLook.com` / `Gaston & Sheehan` / `Bid4Assets`
- **Strategy:** forfeiture page lists brokers per property; follow broker link
- **Volume:** low, per auction cycle
- **Recommendation:** defer — brokered listings have unstable URLs

## Cross-cutting requirements

Every new scraper MUST:

- Extend `server/scrapers/base.js` (inherits `executeWithRetry` + `standardizeListing`)
- Add to `server/scrapers/scheduler.js#scrapers` array
- Add to `scripts/build-data.js#SCRAPER_REGISTRY` with `real: true`
- Set `id` to `<KEY>-<source-id>` (e.g. `IRS-NV-891-88`, `HUD-OH-441-102`)
- Set `sourceUrl` to the original listing URL (for the "View on source" button)
- Pass `scripts/build-data.js#normalize` filters: 2-letter state, address ≥ 8 chars, openingBid > 0
- Use AbortController with 30s per fetch (see `treasury.js#fetchText`)
- 1s polite delay between detail page fetches

## Acceptance test per scraper

```bash
node server/scrapers/<name>.js                 # standalone, prints JSON
node scripts/build-data.js                     # dev, must not regress
RUN_REAL_SCRAPERS=1 node scripts/build-data.js # real, must include new listings
```

After all 10: data.js should have 100+ real listings across all 11 sources.

## Time estimate

| Tier | Scrapers | Effort each |
|---|---|---|
| Trivial (static HTML) | IRS, GSA, USDA, VA, Marshals | 1-2 hours |
| Medium (email + parser) | Trustee, Sheriff | 3-4 hours (incl. IMAP if going email route) |
| Hard (JS SPA / partner-only) | HUD, Fannie, Freddie | days, possibly weeks |

**Sprint target:** ship IRS + GSA + USDA + VA + Trustee + Sheriff = 6 in 1-2 days. Defer HUD/Fannie/Freddie/Marshals to Phase 3 (post-launch). Manual CSV exports for HUD/Fannie/Freddie until automatable.
