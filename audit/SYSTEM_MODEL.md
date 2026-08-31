# SYSTEM_MODEL.md — System Model & Ground Truth

> Comprehensive architecture, entity dictionary, user flows, and invariants for `PROPERTY_CRAWL`.
> Grounded exclusively in codebase evidence (`index.html`, `app.js`, `data.js`, `server/`, `src/`).
>
> **Note**: this document focuses on the v0 static PWA (the original dashboard), which is the most code-complete layer. The v1 production backend (`server/`) and v2 Next.js marketing site (`src/`) are documented at a higher level; see the top-level `README.md` for the full three-layer architecture and the per-suite test plan.

---

## 1. Product Identity & Purpose

### What the Codebase Proves
`PROPERTY_CRAWL` is a three-layer product: a static PWA dashboard (v0) backed by an optional Node.js + PostgreSQL production server (v1), with a Next.js marketing site (v2) that hosts a live triage demo. The v0 layer is a client-side Single Page Application / Progressive Web App that acts as a discovery and triage intelligence dashboard for distressed and government-sold residential and commercial properties across 9 US states and 11 distinct auction/REO sources.

**Evidence**:
- Title & Meta: `index.html:6-7`, `manifest.json:10-12` — *"Zillow for distressed and government-sold property, with an AI that reads the fine print and tells you if each one is actually a deal — and what the catch is."*
- Footer Disclaimer: `index.html:245-248` — *"© 2026 PROPERTY_CRAWL — a discovery & intelligence layer. Not a broker. Not legal or financial advice. Triage tool · verify all terms at the source before bidding."*
- Hero Header: `index.html:128-137` — *"Triage tool · 9 states · 11 source types"*

### Architecture & Runtime Environment

**v0 (static PWA — this document's primary focus)**:
- **Zero build step static web application**: Pure HTML5, ES6 Module JavaScript, Tailwind CSS via CDN / JIT (`index.html:19-36`), local static vendor bundles (`vendor/leaflet/`, `vendor/lucide/`), and Puter.js SDK (`https://js.puter.com/v2/`, `https://builder.puter.com/runtime.js`).
- **Data Architecture**: Static registry in `data.js` attached to `window.SOURCES` and `window.LISTINGS`, transformed at runtime via pure functional filtering and sorting in `app.js`.
- **Persistence Layer**: Cloud Key-Value storage via `puter.kv.get/set('pc_saved')` when authenticated, with automatic fallback to browser `localStorage.getItem/setItem('pc_saved')` when unauthenticated (`app.js:112-140`).
- **AI Integrations**: Puter AI Chat API (`puter.ai.chat(prompt, {model: 'gpt-4o-mini'})`) powering (1) the Deal Analysis "here's the catch" summary (`app.js:533-565`), and (2) the Unstructured Legal Notice Parser (`app.js:567-633`).

**v1 (Node production backend — `server/`)**:
- Custom Node 22 HTTP server (`server/server.js`) with 7 API routes, PostgreSQL + PostGIS database (`server/db/schema.sql`), 5 scrapers (`server/scrapers/`), security middleware (`server/security/`), AI model router + cost tracker (`server/ai/`).
- Loads `data.js` via VM sandbox into an in-memory provider when `DATABASE_URL` is not set.
- Production deployment via `Dockerfile` + `docker-compose.yml`.

**v2 (Next.js marketing site — `src/`)**:
- Next.js 16 + React 19 + TypeScript + Tailwind 4 + shadcn/ui.
- Renders the "Perfect Property" landing page with 23 site components and 7 terminal components.
- The triage terminal reads from `src/components/terminal/property-data.ts` (a curated 6-listing marketing subset, intentionally different from v0's 20).
- **SOURCES taxonomy is mirrored** from v0's `data.js`; `test/sync.test.js` fails CI on drift between the two SOURCES blocks.

---

## 2. Entity Dictionary & Data Model

### Entity 1: `SOURCE` (`window.SOURCES` in `data.js:9-21`)
Keyed dictionary containing metadata for the 11 verified property auction and disposition sources.
- **Fields**:
  - `label` (`string`): Human-readable source name (e.g. `"Sheriff Sale"`, `"HUD Home"`, `"IRS Seized"`).
  - `tier` (`string`): Categorization tier (`"A"` for Federal/GSE REO & Seizures, `"B"` for State/County Foreclosure Notices).
  - `color` (`string`): Distinct hex color code (e.g. `#0f766e` for Sheriff, `#1d4ed8` for HUD, `#b45309` for IRS).
  - `note` (`string`): Explanatory note or domain origin (e.g. `"hudhomestore.gov — owner-occupant window applies"`).

### Entity 2: `LISTING` (`window.LISTINGS` in `data.js:23-209`)
Array of 20 property records.
- **Core Attributes**:
  - `id` (`string`): Unique identifier formatted as `[STATE]-[COUNTY]-[NUM]` or `[SOURCE]-[ID]` (e.g. `"OH-CUY-10231"`, `"HUD-441-92831"`).
  - `source` (`string`): Foreign key matching a key in `window.SOURCES`.
  - `state` (`string`): 2-letter state code (`"OH"`, `"NJ"`, `"FL"`, `"TX"`, `"PA"`, `"IL"`, `"GA"`, `"NV"`, `"AZ"`).
  - `county` (`string`): County name (e.g. `"Cuyahoga"`, `"Bergen"`).
  - `city` (`string`): City name (e.g. `"Cleveland"`, `"Hackensack"`).
  - `zip` (`string`): 5-digit postal code.
  - `address` (`string`): Full street address including city, state, zip.
  - `lat`, `lng` (`number`): Coordinates for Leaflet map placement.
  - `beds`, `baths`, `sqft`, `year` (`number`): Physical property metrics (0 for commercial parcels).
  - `propType` (`string`): `"Single Family"`, `"Multi-Family (3)"`, `"Commercial / Warehouse"`, `"Government Office Bldg"`.
  - `openingBid` (`number`): Minimum starting bid or list price in USD.
  - `estLow`, `estHigh` (`number`): Estimated market value band in USD.
  - `assessed` (`number`): Tax assessed value in USD.
  - `saleDate` (`string`): ISO date `YYYY-MM-DD`.
  - `plaintiff`, `defendant`, `attorney` (`string`): Legal parties and contacts.
  - `judgment` (`number`): Judgment amount in USD (0 for non-foreclosure government dispositions).
  - `occupancy` (`string`): `"Occupied"`, `"Vacant"`, `"Vacant / boarded"`, `"Unknown"`.
  - `deposit` (`string`): Deposit terms and certified funds requirements.
  - `photo` (`string`): URL to property photo.
  - `sourceUrl` (`string`, optional): External link to the official source repository.
  - `raw` (`string`): Verbatim published legal notice or auction description text.

### Entity 3: `COMPUTED_LISTING_METRICS` (`data.js:212-221`)
Precomputed metrics generated at script load:
- `mid` (`number`): `(estLow + estHigh) / 2`.
- `ratio` (`number`): `openingBid / mid`.
- `equity` (`number`): `Math.max(0, mid - openingBid)`.
- `dealScore` (`number`): `Math.max(1, Math.min(99, Math.round((1 - ratio) * 130)))`.

### Entity 4: `SCORE_BAND` (`app.js:96-103`)
Single source of truth for Deal Score visual classification:
- **Strong** (Score 55–99): Color `#0d9488`, Alpha `18`, *"bid is well under half of value; big equity spread."*
- **Moderate** (Score 35–54): Color `#d97706`, Alpha `18`, *"real discount, but margins get eaten by fees & repairs."*
- **Thin** (Score 1–34): Color `#dc2626`, Alpha `18`, *"bid is close to full value; little room for error."*

### Entity 5: `PARSED_NOTICE` (`app.js:576-578`)
Structured schema extracted by the LLM notice parser:
- `property_address`, `city`, `state`, `zip`, `parcel_or_lot`, `sale_date`, `sale_time`, `sale_type`, `plaintiff_or_seller`, `defendant`, `judgment_amount`, `deposit_terms`, `attorney`, `case_number`, `subject_to`, `redemption_note`.

---

## 3. End-to-End User Flows & Execution Traces

### Flow 1: Search, Filter, and Sort Execution
1. **Entry**: User types in `#q` (`app.js:773`), changes `#stateFilter`, `#typeFilter`, `#sortBy` (`app.js:774-776`), or clicks a source chip `#sourceChips button` (`app.js:206-216`).
2. **State Transition**: `state` object updated with query, state, type, sort, or `activeSources` Set.
3. **Pipeline**:
   - `applyFilters(LISTINGS, state)` (`app.js:236-250`): Performs case-insensitive matching across 10 fields (address, city, county, state, plaintiff, defendant, attorney, occupancy, deposit, source label).
   - `applySort(filtered, state.sort)` (`app.js:255-269`): Stable sorting with tiebreaker on `id`.
4. **Output**:
   - Updates `#resultCount` (`app.js:349`).
   - Toggles `#emptyState` visibility (`app.js:350`).
   - Re-renders cards in `#grid` (`app.js:351`).
   - Clears and plots circle markers on Leaflet map `#leaflet` with `fitBounds` (`app.js:364-377`).

### Flow 2: Property Detail & AI Deal Analysis
1. **Entry**: User clicks a property card (`app.js:341`) or map marker popup link (`app.js:372`).
2. **Drawer Open**:
   - `openDrawer(id)` (`app.js:389-485`): Removes `.hidden` from `#drawer`, slides `#drawerPanel` via `translate-x-full` removal, disables body scrolling, and traps focus via `trapFocus(#drawer)`.
   - Populates property metadata, photo, key facts table, and expandable original legal notice (`<details>`).
3. **AI Risk Assessment (`runAnalysis`)**:
   - Checks `analysisCache[id]` (`app.js:535`). If cached, renders immediately via `mdToHtml()`.
   - If uncached: Shows spinner `#aiBox`, constructs structured prompt with listing details and gotchas (`app.js:538-553`), calls `puter.ai.chat(prompt, {model: 'gpt-4o-mini'})` (`app.js:555`).
   - Normalizes response with `extractAiText()` and renders XSS-safe HTML with `mdToHtml()` (`app.js:500-532`).
   - Stores result in `analysisCache[id]`.
4. **Re-Analysis**: Clicking `#reAnalyze` deletes `analysisCache[id]` and re-runs `runAnalysis(l)` (`app.js:482`).

### Flow 3: Deal Saving & Cross-Device Sync
1. **Entry**: User clicks bookmark icon on card (`app.js:337`) or drawer `#drawerSave` (`app.js:480`).
2. **Storage Mutation**:
   - `toggleSave(id)` toggles `id` in `saved` Set (`app.js:380-386`).
   - `persistSaved()` persists JSON array to `puter.kv.set('pc_saved', ...)` if authenticated, else `localStorage.setItem('pc_saved', ...)` (`app.js:125-135`).
   - `updateAlertCount()` updates `#alertCount` badge in navigation (`app.js:136-140`).
3. **Alerts Modal (`openAlerts`)**:
   - Clicking `#alertsBtn` (`app.js:797`) opens `#alertsModal`.
   - Sorts saved listings by soonest `saleDate` (`app.js:638`).
   - Calculates urgency (`du <= 7` days) and past sales (`du < 0`), rendering distinct color-coded badges.
   - Detects stale IDs in `saved` that are no longer in `LISTINGS`, offering a one-click `#clearStale` button (`app.js:643-680`).

### Flow 4: Legal Notice AI Parser
1. **Entry**: User navigates to `#parser`, pastes text into `#rawNotice` (or clicks `#sampleBtn`), and clicks `#parseBtn` (`app.js:800-801`).
2. **AI Inference (`runParse`)**:
   - Validates input is non-empty (`app.js:573`).
   - Sends strict JSON extraction prompt with 16-field schema to `puter.ai.chat` (`app.js:576-582`).
   - Strips markdown fences (````json...````) and isolates JSON object with regex `\{[\s\S]*\}` (`app.js:584-585`).
   - Parses with `JSON.parse()` (`app.js:586`).
3. **Output (`renderParsed`)**:
   - Renders structured 16-row key/value table (`app.js:595-621`).
   - Sanitizes all AI strings via `esc()` and formats `judgment_amount` safely.
   - Enables `#copyParsed` button to copy formatted JSON to clipboard via `navigator.clipboard.writeText` (`app.js:623-632`).

---

## 4. Invariants & Rules Enforced

1. **Strict XSS Isolation**: All external and dynamic data (user queries, AI chat completions, legal notices, listing fields) MUST pass through `esc()` (`app.js:66-68`) or `mdToHtml()` before insertion into DOM.
2. **Single Source of Truth for Deal Scores**: `SCORE_BANDS` (`app.js:96-103`) controls all color rendering, alpha backgrounds, labels, and modal breakdowns across cards, map popups, drawer, alerts, and help modals.
3. **Focus Management & Accessibility**: All interactive modals (`#drawer`, `#alertsModal`, `#scoreModal`, `#mobileMenu`) must trap keyboard focus (`Tab`/`Shift+Tab`) via `trapFocus()` and release focus to the previously active element on close via `releaseFocus()` (`app.js:22-60`).
4. **Resilient Persistence**: The app functions completely in offline/unauthenticated mode using `localStorage`, seamlessly upgrading to cloud synchronization via `puter.kv` upon login (`app.js:113-135`).
