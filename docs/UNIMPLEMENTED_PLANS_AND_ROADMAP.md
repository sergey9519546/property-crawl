# Unimplemented Plans, Historical Proposals & Future Roadmap

> **This document is an architectural and historical compilation, not an active status source.**
> Open work, verified closures, source limits and dependencies live in
> [`docs/COMPLETION_CHECKLIST.md`](./COMPLETION_CHECKLIST.md), which is the single
> canonical source of truth and is guarded by `test/docs-checklist-honesty.test.js`.
> What follows compiles all previous plans, research roadmaps, and unimplemented proposals
> across `STRATEGY.md`, `ULTRAPLAN.md`, `FOOLPROOF_SCRAPE_RESEARCH.md`, the architectural audits,
> and the Discovery Brain specifications.

> **2026-10-31 stabilization:** implementation labels below are historical.
> Track 2/3 modules now have local integration and control-test repairs, with
> source, database and hosted acceptance limits retained in
> [`COMPLETION_CHECKLIST.md`](./COMPLETION_CHECKLIST.md) and
> [`audit/08`](../audit/08-tracks123-stabilization-2026-10-31.md).
> Earlier "shipped" or "100% verified production" language does not certify
> the current hosted deployment or live source qualification.

---

## 1. Executive Summary

While `property-crawl` has achieved a 100% verified production deployment on Render (PostgreSQL 16 + PostGIS 3.6, 10,335 listings, strictly $0/month cost), multiple ambitious engineering and data acquisition plans were drafted in prior sessions.

Across recent workstreams, a substantial number of these flagship subsystems have been fully implemented, control-tested, and shipped into the verified production codebase. This document compiles the complete inventory, explicitly differentiating what is **NOW IMPLEMENTED & SHIPPED** from what remains **PROSPECTIVE OR POLICY-DEFERRED** (such as autonomous 24/7 background IMAP polling daemons, live Stripe billing webhooks, or statutory/robots exclusions).

---

## 2. Systems from STRATEGY.md (Build Blueprint)

### Hack #1 — Statewide Email-as-API Statutory Alert Pipeline
- **The Plan:** Rather than scraping press sites that carry $10,000/incident liquidated damages ToS clauses (e.g. Illinois), subscribe to free statewide press association "Smart Search" email alerts (`floridapublicnotices.com`, `publicnoticeillinois.com`, `texaspublicnotices.com`, `publicnoticesohio.com`, `publicnoticepa.com`, `georgiapublicnotice.com`). An automated IMAP worker polls the dedicated inbox 2×/day, extracts unstructured legal notice prose, passes it to an LLM to generate structured JSON (case number, judgment amount, plaintiff, defendant, sale date, attorney), and inserts it into the database.
- **Implemented & Shipped:**
  - `server/ai/notice-parser.js`: Hybrid deterministic regex & LLM parser extracting legal notice fields with character-span citations (`evidenceSpans`, `verifyVerbatimSpan`, and confidence scoring).
  - `server/scrapers/email-intake.js`: Legal notice intake pipeline supporting raw EML / RFC 822 parsing, structured extraction, and ingestion into the listing pipeline.
  - Interactive split-pane review UI (`src/components/workspace/review-split-pane.tsx`) rendering verbatim citation badge highlights directly from extracted notice text.
  - Verified by `test/sources/email-notices-pipeline.test.js`, `test/source-network-email-intake.test.js`, and `test/ai/notice-parser.test.js`.
- **Prospective / Policy-Deferred:**
  - Autonomous 24/7 background IMAP polling daemon actively connecting to dedicated IMAP mailbox credentials in production (deferred to preserve zero-cost footprint and avoid credential exposure without dedicated operator mailboxes).

### Hack #2 — Multi-County Vendor Platform Parsers
- **The Plan:** Build platform-level parsers to unlock dozens of counties per platform:
  - `salesweb.civilview.com` (New Jersey / Pennsylvania sheriff sales).
  - `Realauction` (`{county}.sheriffsaleauction.ohio.gov` and `{county}.realtaxdeed.com`) across Ohio and Florida counties.
  - `AcclaimWeb` (Harris Recording Solutions) for Clark County NV and county recorders.
  - `Texas Tax Sale` auction dockets across major Texas county precincts.
- **Implemented & Shipped:**
  - **RealAuction Platform Adapter** (`server/scrapers/adapters/realauction.js`): Enrolled across Ohio sheriff sales (`{county}.sheriffsaleauction.ohio.gov`) and all 32 Florida tax deed counties (`{county}.realtaxdeed.com`). Parses preview dockets, certificate numbers, homestead status, CAD APNs, opening bids, assessed values, bankruptcy stays, and prior postponement trajectories (`test/county_platform_adapters.test.js`).
  - **AcclaimWeb Platform Adapter** (`server/scrapers/adapters/acclaimweb.js`): Enrolled for Harris Recording Solutions recorder portals (e.g. Clark County NV), parsing non-judicial trustee foreclosure notices, multi-line alias grantors, tag-wrapped recording labels, and document types without truncation (`test/county_platform_adapters.test.js`).
  - **Texas Tax Sale Adapter** (`server/scrapers/adapters/texas-tax-sale.js`): Enrolled across 11 major Texas jurisdictions/precincts, calculating statutory First Tuesday auction dates (Tex. Tax Code § 34.01), 180-day non-homestead and 730-day homestead redemption deadlines, cause numbers, CAD APNs, adjudged values, opening bids, and constable precincts (`test/texas-tax-sale-wiring.test.js`, `test/county_platform_adapters.test.js`).
  - **CivilView Platform Parser** (`server/scrapers/civilview.js`): Multi-county sheriff sale parser covering New Jersey and Pennsylvania dockets (`test/sources/civilview-all-counties.test.js`, `test/county_platform_adapters.test.js`).
- **Prospective / Policy-Deferred:**
  - Automated crawling of long-tail rural county clerk standalone HTML tables outside vendor platforms.

### Hack #3 — Self-Healing Ingestion & Prompt Review Queue
- **The Plan:** Automated routing of low-confidence or format-drifted HTML/notices to an interactive review queue where prompts and schemas are tuned without redeploying code.
- **Implemented & Shipped:**
  - Workspace review split-pane (`src/components/workspace/review-split-pane.tsx`) and document review queue backend (`server/routes/document-review.js`), supporting operator review, evidence span auditing, and status lifecycle state machines (`test/document-review.test.js`, `test/document-review-split-pane-pipeline.test.js`).
  - Deterministic fallback parsing when LLM confidence is low (`server/ai/notice-parser.js`).
- **Prospective / Policy-Deferred:**
  - Fully autonomous self-tuning prompt mutation daemon that rewrites and tests extraction system prompts without human review or code change.

### Hack #4 — Full Free Enrichment Stack Extensions
- **The Plan:** Free spatial, physical, and valuation enrichment replacing expensive commercial APIs:
  - US Census Geocoder and County ArcGIS REST endpoints.
  - FHFA House Price Index (HPI) calculations.
  - Socrata municipal code violation, super-lien, and vacancy feeds.
  - HUD Small Area FMR (SAFMR) rental floor underwriting.
  - Ingestion of monthly Zillow Research ZHVI CSVs and Redfin Data Center ZIP-level datasets for automated three-way valuation consensus.
- **Implemented & Shipped:**
  - **US Census Bureau Geocoder** (`server/enrichment/census-geocoder.js`): Free zero-key geocoding and FIPS mapping.
  - **County ArcGIS REST Cadastral Parcel Resolver** (`server/enrichment/arcgis-parcels.js`): Free county parcel polygon and cadastral APN resolution.
  - **FHFA House Price Index (HPI)** (`server/enrichment/hpi.js`): Macro-economic price appreciation benchmarks from FHFA master data.
  - **Socrata Municipal Code Enforcement & Super-Lien Ingest** (`server/enrichment/code-enforcement.js`): SODA REST client querying open data portals across Austin, Dallas, Baltimore, Cincinnati, Kansas City, Orlando, Chicago, New Orleans, Philadelphia. Detects open code violations, demolition orders, dangerous building repair special tax bills, nuisance abatement super-liens, and vacancy indicators (`test/enrichment/code-enforcement.test.js`, `test/municipal-code-enforcement-expansion.test.js`).
  - **HUD Small Area Fair Market Rents (SAFMR)** (`server/enrichment/hud-safmr.js`, `src/lib/underwriting.ts`): ZIP-level statutory rental floor underwriting across 0–4 bedroom configurations (`test/hud-safmr.test.js`).
- **Prospective / Policy-Deferred:**
  - Monthly automated bulk CSV ingestion of Zillow Research ZHVI and Redfin Data Center ZIP-level datasets for three-way valuation consensus (deferred to maintain zero external storage overhead).

### Hack #5 — Commercial & Organic Acquisition Engine
- **The Plan:** Programmatic SEO, statutory underwriting, email alerts, Stripe subscription fulfillment, and vehicle vertical.
- **Implemented & Shipped:**
  - **Programmatic SEO County Landing Pages** (`src/app/sheriff-sales/[state]/[county]/page.tsx`, `src/app/states/[state]/[county]/page.tsx`, `src/lib/county-seo.ts`): Search-optimized pages with title/meta descriptions, BreadcrumbList and ItemList schema.org JSON-LD structured data, statutory redemption rules summary, and offline-resilient local coverage matrix fallback (`test/seo/county-pages.test.js`).
  - **Statutory Underwriting & Tax Deed Yield Simulator** (`src/components/terminal/bidding-simulator.tsx`, `src/lib/underwriting.ts`): Interactive simulator calculating exact statutory returns (Georgia 20%/40% flat penalty, Texas 25%/50% flat penalty, Tennessee 12% per annum, Florida 0-day immediate deed), lien waterfall priority debt extinguishment, statutory fee presets, post-sale statutory redemption windows & IRS 120-day lockup carry, Tyler v. Hennepin surplus calculations, and property tax reassessment shock modeling (`test/tax-deed-simulator-ui.test.js`, `test/underwriting-truth.test.mjs`, `test/cash_to_close_complete.test.js`).
  - **Form Delivery / Resend Integration** (`src/lib/resend.ts`, `server/delivery/resend-client.js`, `test/delivery/form-submissions-resend.test.js`).
- **Prospective / Policy-Deferred:**
  - Live Stripe investor subscription billing webhooks in production ($19–$49/mo).
  - Automated 24/7 background notification daemon sending instant match email alerts.
  - Second asset vertical: GSA Auctions personal property & repossessed vehicles via official JSON API (`gsa.github.io/auctions_api`).

---

## 3. Scraping Upgrades from FOOLPROOF_SCRAPE_RESEARCH.md

A 6-item P0 and 3-item P1 scraping upgrade plan was researched from Hacker News and Scrapling best practices:

1. **P0.1 — Universal Listing JSON Schema Validation:**
   - **Implemented & Shipped:** Hard JSON schema validation in `schema/listing.schema.json` via `server/scrapers/validation.js` (`validateListingSchema`, `validateListingForIngestion`), enforcing required root fields, coordinate bounds, state patterns, and provenance sub-objects before database ingestion (`test/scrapers/listing-json-schema.test.js`).
2. **P0.3 — `capture_xhr` SPA Background Interception:**
   - **Shipped as Prototype / Policy-Deferred in Prod:** Prototyped and verified in `server/scrapers/spa-xhr.js` (`test/scrapers/spa-xhr-hardened.test.js`). Federal REO collectors (Fannie Mae HomePath, Freddie Mac HomeSteps, VA VRM) remain unpromoted to active default per source policy.
3. **P0.4 — Crawlee-Style Adaptive AutoThrottle:**
   - **Implemented & Shipped:** `server/scrapers/auto-throttle.js` dynamically spaces requests based on host-level exponential moving average (EMA) latency tracking, detects upstream latency spikes, parses `Retry-After` HTTP headers, and gracefully decays back to baseline (`test/scrapers/auto-throttle-adaptive.test.js`).
4. **P0.5 — Parser Development-Mode Disk Cache:**
   - **Implemented & Shipped:** Local disk cache saving raw HTML responses during development (`.cache/dev-scraper-cache/<hash-of-url>.txt`) with 24-hour TTL, opt-in via `SCRAPER_DEV_CACHE=1`, unconditionally disabled under `NODE_ENV=production` (`server/scrapers/base.js`, `test/scrapers/dev-cache-snapshots.test.js`).
5. **P0.6 — Selector Drift & Yield Collapse Alarms:**
   - **Implemented in Canary / Prospective in Background:** Field extraction yield tracking is enforced in canary gates; continuous automated background alarms computing DOM structure hashes across runs remain prospective.
6. **P1.7 — Secondary LLM Extraction Lane:**
   - **Implemented in Workspace / Prospective in Batch:** Document review queue handles unparsed legal notices with human-in-the-loop review; continuous autonomous background batch LLM lane remains prospective.
7. **P1.8 — Scrapling Adaptive Presentation Selectors:**
   - **Prospective:** Enabling Scrapling `adaptive=True` on non-identity fields with a frozen selector store.
8. **P1.9 — Sanitized Markdown Evidence Snapshots:**
   - **Implemented & Shipped:** `createMarkdownEvidenceSnapshot` and `recordSnapshot` (`server/scrapers/discovery-snapshots.js`) converting raw HTML dockets and property cards into script-sanitized, human-auditable Markdown tables and cards saved alongside raw payload JSON (`test/scrapers/dev-cache-snapshots.test.js`).

---

## 4. Discovery Brain & ServiceLink Plans

From `docs/discovery-brain-runbook.md` and `MEMORY.md` §14.11:

1. **ServiceLink Bounded Resumable Pagination Across 5,900 Archive Records:**
   - The live collector runs bounded batches (`scripts/import-servicelink-archive.js`, `test/servicelink-archive-import.test.js`).
   - Resumable cursor pagination across all 50 states for all 5,900 historical archive listings remains prospective.
2. **Property Intelligence Source Atlas Automated Ingestion:**
   - 163 sources cataloged and verified in `server/sources/catalog.js`.
   - Continuous automated ingestion of all 501 registry entries from `Property_Intelligence_Source_Atlas_VERIFIED_2026-09-05.docx` remains prospective.
3. **Append-Only Cryptographic Evidence Ledger:**
   - Evidence records stored in PostgreSQL `document_review` and local observation files.
   - Moving to an append-only cryptographic hash chain (SHA-256 blocks) remains prospective.

---

## 5. Multi-Agent Architecture Plans

From `audit/02-plan.md` and `audit/04-revised-plan.md`:

1. **Tier 3.2 — Project-Native Capability Collapse:**
   - **Shipped:** Uncurated third-party marketplace skills pruned to leave the core native verbs: `scrape -> normalize -> score -> publish`.
2. **Tier 3.3 — Typed Capability Graph & DAG Orchestrator:**
   - **Prospective:** Dynamic multi-agent DAG execution pipeline where specialized subagents execute parcel geocoding, HPI valuation, and title risk analysis in parallel with typed input/output schemas.
3. **Tier 3.4 — Usage Telemetry & Self-Tuning Trigger Weights:**
   - **Prospective:** Autonomous background adjustment of skill trigger confidence scores based on verified agent session outcomes.

---

## 6. Collection Expansion (ULTRAPLAN WS-E)

- **HUD Nationwide Sweep:** Bounded state queueing to expand HUD from OH/NJ declared scopes to all 52 jurisdictions. (Policy-deferred to maintain strict API request limits).
- **IRS Seized Property Promotion:** Blocked by publisher inventory (0 real estate auction cards observed during canaries).
- **GSA Surplus Real Estate Promotion:** Blocked by publisher `robots.txt` disallowing `/our-listing`.
- **CivilView Multi-County Expansion:** Enrolling remaining New Jersey counties and Pennsylvania dockets beyond the active pilot.

---

## 7. Infrastructure & Commercial Features

- **Persistent Cache Volume:** Adding persistent disk storage (e.g. Render Persistent Disk or Cloudflare R2 / S3) so `.cache/` survives container redeploys.
- **Production Webhook Receivers:** Connecting live production receivers for `NEWSLETTER_ENDPOINT` and `CONTACT_ENDPOINT`.
- **Custom Apex Domain & Branded SSL:** Binding `https://perfectproperty.app` (or custom apex domain).
- **Multi-Tenant / Multi-User Auth:** Post-beta role-based access control (RBAC) separating anonymous viewers, subscriber members, and system operators.
- **Formal Legal Review:** Independent attorney review of `/terms` and `/privacy`.

---

*Reference: Current operational state is guarded by [`docs/COMPLETION_CHECKLIST.md`](./COMPLETION_CHECKLIST.md).*
