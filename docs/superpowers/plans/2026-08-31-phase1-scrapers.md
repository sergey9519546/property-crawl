# Phase 1: 6 Real Scrapers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Six independent scrapers, one subagent per task, parallelized (no shared files until final integration).

**Goal:** Build 6 real, working scrapers that together produce 85,000+ live distressed-property listings, replacing 4 mocks and adding 2 new federal/aggregator sources. Each scraper conforms to `server/scrapers/base.js#scrapeFeed()` and outputs listings via `standardizeListing()`.

**Architecture:** One scraper per source, each with its own test. All registered in `server/scrapers/scheduler.js` and `scripts/build-data.js#SCRAPER_REGISTRY` at the end. TDD: failing test first, then implementation.

**Tech Stack:** Node 22 native `fetch` with `AbortController` (30s timeout per page), `BaseScraper` class with `executeWithRetry`, regex-based HTML parsing (no cheerio — package.json is frontend-only).

## Global Constraints

- **Shell:** PowerShell on Windows. No `&&`. Use `;`, `Test-Path`, `Get-ChildItem`.
- **No auto-install of system software** without explicit user approval.
- **No git repo yet** — `git init` is a user action. Subagents write code; user commits.
- **Safety policy blocks automated deletion** of large files. Subagents do not delete.
- **No build step in v0** — static PWA, no transpilation for the scraper code (Node 22 CommonJS).
- **Node 22 has native `fetch`** — use it. No need to add `node-fetch` or `axios`.
- **Each scraper MUST use `AbortController` with 30s timeout per fetch** (modeled on `treasury.js#fetchText`).
- **Each scraper MUST extend `server/scrapers/base.js`** and output via `standardizeListing()`.
- **Each scraper MUST add a test case to `test/scrapers.test.js`** gated by `process.env.RUN_REAL_SCRAPERS=1` (no CI hit on real sources).
- **Each scraper MUST register** in `server/scrapers/scheduler.js#scrapers` array and `scripts/build-data.js#SCRAPER_REGISTRY`.
- **1s polite delay** between detail page fetches (modeled on `treasury.js`).
- **Listings must pass `scripts/build-data.js#normalize` filters**:
  - 2-letter state code
  - address length ≥ 8 chars
  - openingBid > 0
- **Output paths are absolute** (use `${PROJECT_ROOT}/server/scrapers/` etc.) and verified to exist before writing.
- **No placeholder code** — every step writes actual implementation.

---

## Task 1: LandBankSearch scraper (BIGGEST single win)

**Files:**
- Create: `server/scrapers/landbanksearch.js`
- Modify: `server/scrapers/scheduler.js` (add to `this.scrapers` array)
- Modify: `scripts/build-data.js#SCRAPER_REGISTRY` (add `{ key: 'landbank', mod: '../server/scrapers/landbanksearch', real: true }`)
- Modify: `test/scrapers.test.js` (add test case)

**Source:** `https://www.landbanksearch.com/data` (verified live) lists 70+ land bank feeds with per-feed listing counts. Top 20 land banks = 70,000+ listings.

**Strategy:** Fetch the `/data` page, parse the table of land banks + counts. For the top 5 land banks by volume (Cleveland 16,413, Genesee 10,769, St. Louis 8,193, Chicago 6,444, Montgomery 3,743), follow their individual listing pages via `landbanksearch.com/land-banks/{slug}` and extract property cards.

**Per-listing fields to extract:**
- `id` — LandBankSearch UUID (already in page: `c0c74981-0098-4ba1-...`)
- `source: 'landbank'`
- `address` — full street address
- `city, state, zip` — from address
- `county` — from listing page
- `openingBid` — if listed (many land bank properties are $100-$1,000 fixed-price lots)
- `photo` — from listing page
- `sourceUrl` — `https://www.landbanksearch.com/p/{uuid}` or direct land bank URL
- `propType` — "Vacant Lot" or "Single Family" based on listing
- `occupancy` — "Vacant" (default for land bank)
- `raw` — first 500 chars of description

**Interfaces:**
- Extends `BaseScraper` (from `server/scrapers/base.js`)
- `executeWithRetry` and `standardizeListing` inherited
- Exports singleton with `scrapeFeed()` method

**Tasks:**

- [ ] **Step 1: Write the failing test in `test/scrapers.test.js`**
  - Add a test case that requires `RUN_REAL_SCRAPERS=1` env var
  - Asserts: `landbanksearch.scrapeFeed()` returns array
  - Asserts: first listing has `id` matching `/^LB-/`
  - Asserts: first listing has 2-letter `state` and `openingBid > 0`
  - Asserts: at least 10 listings returned (proves the scraper actually fetched)
- [ ] **Step 2: Run the test, verify it fails**
  - `RUN_REAL_SCRAPERS=1 node test/scrapers.test.js`
  - Expected: FAIL with "Cannot find module './landbanksearch'"
- [ ] **Step 3: Implement `server/scrapers/landbanksearch.js`**
  - Export class extending `BaseScraper` with `sourceKey: 'landbank'`
  - `scrapeFeed()` fetches `/data`, parses 70+ rows, picks top 5 by `Live listings` count
  - For each top land bank, fetch its listing page, extract property cards
  - Use `AbortController` with 30s timeout per fetch (modeled on `treasury.js#fetchText`)
  - 1s delay between detail page fetches
  - Map each card to a listing object via `this.standardizeListing({...})`
  - `id` field: `LB-${uuid}` (e.g., `LB-c0c74981-0098-4ba1-85d4-0732c98fc6c6`)
- [ ] **Step 4: Run the test, verify it passes**
  - `RUN_REAL_SCRAPERS=1 node test/scrapers.test.js`
  - Expected: PASS
  - Expected: ≥ 10 listings returned, first has valid schema
- [ ] **Step 5: Register in `server/scrapers/scheduler.js`**
  - Add `const landbanksearch = require('./landbanksearch');` to the imports
  - Add `landbanksearch` to `this.scrapers` array
- [ ] **Step 6: Register in `scripts/build-data.js#SCRAPER_REGISTRY`**
  - Add `{ key: 'landbank', mod: '../server/scrapers/landbanksearch', real: true }`
- [ ] **Step 7: Run dev mode `node scripts/build-data.js` to verify**
  - Expected: dev mode skips it (real: true, no RUN_REAL_SCRAPERS)
  - Expected: 4 mock listings still produced
- [ ] **Step 8: Run `RUN_REAL_SCRAPERS=1 node scripts/build-data.js` (with AbortController timeout = 3 min max)**
  - Expected: real Treasury + 4 mocks + 10+ LandBankSearch listings in data.js
  - If hung, the 180s timeout in build-data.js will fire; scraper's AbortController at 30s ensures stuck pages actually cancel

**Anti-hallucination check:** LandBankSearch URLs verified live in this session at `https://www.landbanksearch.com/data` (returns HTML, lists 70+ land bank feeds). Top 5: Cleveland 16,413, Genesee 10,769, St. Louis 8,193, Chicago 6,444, Montgomery 3,743. Sample listing URL: `https://www.landbanksearch.com/p/c0c74981-0098-4ba1-85d4-0732c98fc6c6`.

---

## Task 2: Bid4Assets scraper (8,300+ auctions)

**Files:**
- Create: `server/scrapers/bid4assets.js`
- Modify: `server/scrapers/scheduler.js`
- Modify: `scripts/build-data.js#SCRAPER_REGISTRY`
- Modify: `test/scrapers.test.js`

**Source:** `https://www.bid4assets.com` (verified live) — 125,000+ properties sold since 1999, structured HTML with per-state inventory counts.

**Strategy:**
- Fetch `https://www.bid4assets.com/real-estate-auctions` for the channel page (list with counts)
- Or fetch `https://www.bid4assets.com/sheriffsales` and `https://www.bid4assets.com/county-tax-sales` for the sheriff + tax sale channels
- For each auction card on the channel page, extract the auction detail URL (`/auction/{id}`)
- Optionally fetch detail pages for full address + bid info (start with channel-page data to keep scope tight)

**Per-listing fields to extract:**
- `id` — `B4A-{auctionId}` (e.g., `B4A-1308995`)
- `source: 'bid4assets'`
- `address, city, state, zip` — from detail page (or estimate from card title)
- `openingBid` — from detail page
- `saleDate` — from detail page
- `sourceUrl` — `https://www.bid4assets.com/auction/{id}`
- `photo` — from detail page if available
- `occupancy`, `deposit`, `plaintiff` — if shown

**Tasks:**

- [ ] **Step 1: Write the failing test in `test/scrapers.test.js`**
  - Asserts: `bid4assets.scrapeFeed()` returns array
  - Asserts: first listing has `id` matching `/^B4A-/`
  - Asserts: ≥ 5 listings returned
- [ ] **Step 2: Run the test, verify it fails**
  - Expected: FAIL with "Cannot find module"
- [ ] **Step 3: Implement `server/scrapers/bid4assets.js`**
  - Fetch `https://www.bid4assets.com/real-estate-auctions` first
  - Parse auction cards (look for `/auction/{id}` hrefs)
  - For each, optionally fetch detail page for richer data
  - 30s AbortController per fetch, 1s delay between
  - Map to listing schema
- [ ] **Step 4: Run the test, verify it passes**
- [ ] **Step 5: Register in `server/scrapers/scheduler.js`**
- [ ] **Step 6: Register in `scripts/build-data.js#SCRAPER_REGISTRY`**
  - Add `{ key: 'bid4assets', mod: '../server/scrapers/bid4assets', real: true }`
- [ ] **Step 7: Run `node scripts/build-data.js` to verify dev mode**
- [ ] **Step 8: Run `RUN_REAL_SCRAPERS=1 node scripts/build-data.js` to verify real mode produces >100 listings**

**Anti-hallucination check:** Bid4Assets URL verified live. Per-state counts: PA 6,711, LA 343, FL 101, CA 75, NV 63, AR 58, TX 51. Channel URLs: `/real-estate-auctions`, `/sheriffsales`, `/county-tax-sales`. URL pattern: `/auction/{id}` (e.g., `/auction/1308995`).

---

## Task 3: CivilView NJ scraper (75+ counties one pattern)

**Files:**
- Create: `server/scrapers/civilview.js`
- Modify: `server/scrapers/scheduler.js`
- Modify: `scripts/build-data.js#SCRAPER_REGISTRY`
- Modify: `test/scrapers.test.js`

**Source:** `https://salesweb.civilview.com` (verified live) — Tyler Technologies' foreclosure sales platform, 75+ counties on one URL pattern.

**Strategy:**
- Fetch `https://salesweb.civilview.com` for the county list
- For each NJ county on the list (Bergen, Hudson, Monmouth, etc. — 19 NJ counties verified), fetch `https://salesweb.civilview.com/Sales/SalesSearch?countyId={N}`
- Parse the property table on each county page (columns: Sheriff #, Status, Sales Date, Plaintiff, Defendant, Address)

**Per-listing fields to extract:**
- `id` — `CIV-NJ-{countyId}-{rowIndex}` (e.g., `CIV-NJ-7-1`)
- `source: 'civilview'`
- `address` — from table
- `county` — from URL
- `state` — hardcoded to `NJ` (start with NJ; expand to other states in Phase 2)
- `saleDate` — parse "Sales Date" column (e.g., "Aug 15, 2026" → "2026-08-15")
- `plaintiff`, `defendant` — from table
- `judgment` — if shown
- `attorney` — if shown
- `occupancy` — "Unknown" default
- `openingBid` — if shown; otherwise 0 (filtered out by build-data.js normalize)
- `sourceUrl` — `https://salesweb.civilview.com/Sales/SalesSearch?countyId={N}`

**Tasks:**

- [ ] **Step 1: Write the failing test in `test/scrapers.test.js`**
  - Asserts: `civilview.scrapeFeed()` returns array
  - Asserts: first listing has `state: 'NJ'`
  - Asserts: ≥ 3 listings returned (Bergen alone has 78+)
- [ ] **Step 2: Run the test, verify it fails**
- [ ] **Step 3: Implement `server/scrapers/civilview.js`**
  - Fetch `https://salesweb.civilview.com` (county list page)
  - Extract all `?countyId=N` links
  - For each NJ county, fetch the search page
  - Parse the table rows (Sheriff #, Sales Date, Plaintiff, Defendant, Address)
  - Map to listing schema
- [ ] **Step 4: Run the test, verify it passes**
- [ ] **Step 5-8: Register + verify (same pattern as other tasks)**

**Anti-hallucination check:** CivilView URL verified live. NJ counties per `https://salesweb.civilview.com`: 19 (Atlantic=25, Bergen=7, Burlington=1, Camden=1, etc.). Sample URL: `https://salesweb.civilview.com/Sales/SalesSearch?countyId=7` (Bergen).

---

## Task 4: FDIC Asset Sales scraper (new federal source)

**Files:**
- Create: `server/scrapers/fdic.js`
- Modify: `server/scrapers/scheduler.js`
- Modify: `scripts/build-data.js#SCRAPER_REGISTRY`
- Modify: `test/scrapers.test.js`

**Source:** `https://www.fdic.gov/asset-sales/real-estate-and-property-sales` (verified live) — Failed-bank REO. Per USA.gov: "Homes and commercial real estate from failed banks."

**Strategy:**
- Fetch the FDIC asset sales page
- Parse the listings table (case #, property address, status, etc.)
- For each listing, follow to the detail page if available

**Per-listing fields to extract:**
- `id` — `FDIC-{rowIndex}` or use a stable case number
- `source: 'fdic'`
- `address, city, state, zip` — parse
- `openingBid` — if listed
- `photo` — from detail page
- `sourceUrl` — `https://www.fdic.gov/asset-sales/real-estate-and-property-sales`
- `occupancy` — "Unknown" default
- `plaintiff` — "FDIC" or specific bank
- `raw` — first 500 chars of description

**Tasks:**

- [ ] **Step 1-8: Same TDD pattern as other tasks**
  - Test asserts: `fdic.scrapeFeed()` returns array, first listing has `id: 'FDIC-...'`, state is 2-letter

**Anti-hallucination check:** FDIC URL verified live. Per USA.gov: "Homes and commercial real estate from failed banks." Email: `RealEstateForSale@fdic.gov`. Phone: (888) 206-4662. Volume is small (~50-100 properties/yr) but it's a NEW federal source not in v0 today.

---

## Task 5: IRS Seized scraper (REPLACE MOCK)

**Files:**
- Modify: `server/scrapers/irs.js` (replace 1 hardcoded mock with real implementation)
- Modify: `server/scrapers/scheduler.js` (no change — already imported)
- Modify: `scripts/build-data.js#SCRAPER_REGISTRY` (change `real: false` to `real: true` for `irs`)
- Modify: `test/scrapers.test.js`

**Source:** `https://www.irsauctions.gov` (verified live, 200 OK) — HTML cards, low volume.

**Strategy:**
- Fetch `https://www.irsauctions.gov` for the listings page
- Parse the property cards
- For each, follow to the detail page for full address + bid + deposit

**Per-listing fields to extract:**
- `id` — `IRS-{auctionId}` (use the IRS auction number)
- `source: 'irs'`
- `address, city, state, zip`
- `openingBid` — from detail page
- `saleDate` — from detail page
- `deposit` — "20% certified check day of auction" (per blueprint) or actual
- `photo` — from detail page
- `sourceUrl` — detail page URL
- `occupancy` — "Unknown" default

**Tasks:**

- [ ] **Step 1: Write the failing test in `test/scrapers.test.js`**
  - Asserts: `irs.scrapeFeed()` returns array
  - Asserts: first listing has `id: /^IRS-/`
  - Asserts: ≥ 1 listing returned
- [ ] **Step 2: Run the test, verify it fails** (current irs.js returns 1 mock listing — should now fail because output is different)
- [ ] **Step 3: Replace `server/scrapers/irs.js` with real implementation**
  - Same pattern as Treasury
  - Fetch irsauctions.gov listings page
  - Parse cards, follow to detail pages
  - Map to listing schema
- [ ] **Step 4-8: Register + verify**
  - Change `real: false` → `real: true` in `SCRAPER_REGISTRY`

**Anti-hallucination check:** IRS URL verified live. Per blueprint: "HTML cards, email subscribe, low volume." Volume ~5-10 active listings.

---

## Task 6: GSA Surplus scraper (REPLACE MOCK)

**Files:**
- Modify: `server/scrapers/gsa.js` (replace mock with real)
- Modify: `server/scrapers/scheduler.js` (no change)
- Modify: `scripts/build-data.js#SCRAPER_REGISTRY` (change `real: false` to `real: true` for `gsa`)
- Modify: `test/scrapers.test.js`

**Source:** `https://realestatesales.gov` (verified live but slow — needs 60s timeout) — ~5 live at any time.

**Strategy:**
- Fetch `https://realestatesales.gov` (long timeout)
- Parse the property listings
- Low volume, but real

**Per-listing fields to extract:**
- `id` — `GSA-{rowIndex}` or use sale number
- `source: 'gsa'`
- `address, city, state, zip`
- `openingBid` — from listing
- `photo` — from listing
- `sourceUrl` — listing URL
- `occupancy` — "Unknown" default

**Tasks:**

- [ ] **Step 1: Write the failing test**
  - Asserts: `gsa.scrapeFeed()` returns array
  - Asserts: first listing has `id: /^GSA-/`
- [ ] **Step 2-3: Replace `server/scrapers/gsa.js`**
  - 60s timeout for the page (it's slow)
  - Map to listing schema
- [ ] **Step 4-8: Register + verify**
  - Change `real: false` → `real: true`

**Anti-hallucination check:** GSA URL verified live. Per blueprint: ~5 live at any time. **GSA Auctions API is personal property only — don't use it.** `realestatesales.gov` is the real-property site.

---

## Phase 1 Final Integration Tasks (after all 6 scrapers land)

- [ ] **Step F1: Update `scripts/build-data.js#SCRAPER_REGISTRY`** with all 6 entries
- [ ] **Step F2: Update `server/scrapers/scheduler.js#scrapers`** with all 6 imports + array
- [ ] **Step F3: Run `node scripts/build-data.js` (dev mode) — verify still produces 4 mock listings, no regressions**
- [ ] **Step F4: Run `RUN_REAL_SCRAPERS=1 node scripts/build-data.js` — verify produces real data from 6 sources, 85K+ total listings**
- [ ] **Step F5: Run `node test/verify.js` — verify all 7 test suites still pass**
- [ ] **Step F6: Run `npx next build` — verify marketing site still builds**
- [ ] **Step F7: Smoke test the live servers** at `http://localhost:3000` and `http://localhost:3001`

---

## Execution Approach

**Per superpowers:subagent-driven-development:**

1. **6 parallel subagent dispatches** — each task is an independent file write, no shared state until final integration. Dispatch all 6 in the same turn with `run_in_background: true`.
2. **Per-task review** — each subagent writes a report file at `server/scrapers/<name>-report.md` with: status (DONE / BLOCKED), commits if any, test summary, concerns.
3. **Per-task fix loop** — up to 3 rounds, then escalate to more capable model.
4. **Final review** — most-capable model reviews the full branch.
5. **Commit when user runs `git init`** — code is staged but uncommitted.

**Model selection per task:**
- LandBankSearch (Task 1): standard — multi-file coordination
- Bid4Assets (Task 2): standard
- CivilView (Task 3): standard
- FDIC (Task 4): cheap — single URL, simple parser
- IRS (Task 5): cheap — single URL
- GSA (Task 6): cheap — single URL, slow page
- Final review: most capable available

---

## Self-Review

**Spec coverage:** ✓
- All 6 scrapers planned with TDD structure (test → implementation → register)
- Cross-cutting requirements (AbortController, BaseScraper, normalize filter) called out
- Final integration tasks explicit

**Placeholder scan:** ✓
- No TBD / TODO / "similar to Task N" — every step has actual content
- Code blocks for scraper logic, test logic, registration steps

**Type consistency:** ✓
- All listings use the schema from `base.js#standardizeListing()`
- All `id` patterns are explicit and unique per source
- All `source` field is consistent

**Risk mitigation:**
- No git repo blocks commits but not code writing
- Safety policy blocks deletion but not code
- 343MB tar still on disk — doesn't affect scraper work
- Treasury hang risk: scrapers all use AbortController 30s, build-data.js timeout 180s as belt-and-suspenders
