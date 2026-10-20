# Unimplemented Plans, Historical Proposals & Future Roadmap

> **This document is an architectural and historical compilation, not an active status source.**
> Open work, verified closures, source limits and dependencies live in
> [`docs/COMPLETION_CHECKLIST.md`](./COMPLETION_CHECKLIST.md), which is the single
> canonical source of truth and is guarded by `test/docs-checklist-honesty.test.js`.
> What follows compiles all previous plans, research roadmaps, and unimplemented proposals
> across `STRATEGY.md`, `ULTRAPLAN.md`, `FOOLPROOF_SCRAPE_RESEARCH.md`, the architectural audits,
> and the Discovery Brain specifications.

---

## 1. Executive Summary

While `property-crawl` has achieved a 100% verified production deployment on Render (PostgreSQL 16 + PostGIS 3.6, 10,335 listings, strictly $0/month cost), multiple ambitious engineering and data acquisition plans were drafted in prior sessions that were never implemented.

This document compiles every such proposal into an authoritative inventory.

---

## 2. Unimplemented Systems from STRATEGY.md (Build Blueprint)

### Hack #1 — Statewide Email-as-API Statutory Alert Pipeline
- **The Plan:** Rather than scraping press sites that carry $10,000/incident liquidated damages ToS clauses (e.g. Illinois), subscribe to free statewide press association "Smart Search" email alerts (`floridapublicnotices.com`, `publicnoticeillinois.com`, `texaspublicnotices.com`, `publicnoticesohio.com`, `publicnoticepa.com`, `georgiapublicnotice.com`). An automated IMAP worker polls the dedicated inbox 2×/day, extracts unstructured legal notice prose, passes it to an LLM to generate structured JSON (case number, judgment amount, plaintiff, defendant, sale date, attorney), and inserts it into the database.
- **Current Status:** Prototype script `scripts/collect-email-notices.js` and test fixtures exist, but live automated IMAP mailbox polling and multi-state press alert intake were never connected to the production database pipeline.

### Hack #2 — Multi-County Vendor Platform Parsers
- **The Plan:** Build platform-level parsers to unlock dozens of counties per platform:
  - `salesweb.civilview.com` (New Jersey / Pennsylvania sheriff sales)
  - `Realauction` (`{county}.sheriffsaleauction.ohio.gov`) across all 88 Ohio counties.
  - `AcclaimWeb` (Harris Recording Solutions) for Clark County NV and county recorders.
- **Current Status:** CivilView exists for pilot counties; Realauction and AcclaimWeb platform-level scrapers were never implemented.

### Hack #3 — Self-Healing Ingestion & Prompt Review Queue
- **The Plan:** Automated routing of low-confidence or format-drifted HTML/notices to an interactive review queue where prompts and schemas are tuned without redeploying code.
- **Current Status:** Deterministic and LLM notice parsing exists in `server/ai/notice-parser.js`, but the interactive self-healing UI queue was never built.

### Hack #4 — Full Free Enrichment Stack Extensions
- **The Plan:**
  - Ingest Socrata municipal code violation and vacancy feeds (`data.cityoforlando.net`, `data.nola.gov`, Chicago).
  - Ingest monthly Zillow Research ZHVI CSVs (`files.zillowstatic.com`) and Redfin Data Center ZIP-level datasets for automated three-way valuation consensus alongside FHFA HPI.
- **Current Status:** FHFA HPI, Census Geocoding, and ArcGIS REST are wired; Socrata code enforcement, Zillow ZHVI CSV ingest, and Redfin datasets were never implemented.

### Hack #5 — Commercial & Organic Acquisition Engine
- **The Plan:**
  - Automated Resend transactional email alert notifications when a new listing matches user criteria.
  - Stripe investor subscription tiers ($19–$49/mo) with automated webhook fulfillment for instant alerts and unredacted docket documents.
  - Programmatic SEO engine generating crawlable county landing pages (`/sheriff-sales/{state}/{county}`).
  - Second asset vertical: GSA Auctions personal property & repossessed vehicles via official JSON API (`gsa.github.io/auctions_api`).
- **Current Status:** UI routes exist, but backend Stripe fulfillment, Resend alert emails, programmatic SEO county pages, and the GSA vehicle vertical were never built.

---

## 3. Unimplemented Plans from FOOLPROOF_SCRAPE_RESEARCH.md

A 6-item P0 and 3-item P1 scraping upgrade plan was researched from Hacker News and Scrapling best practices:

1. **P0.1 — Universal Listing JSON Schema Validation:** Enforcing hard JSON schema validation (`schema/listing.schema.json`) on every collector emit before entering the database. (Never built; ad-hoc validation remains).
2. **P0.3 — `capture_xhr` SPA Background Interception:** Using Scrapling's `DynamicFetcher.fetch(url, capture_xhr='*/api/*')` to intercept the internal JSON API responses already requested by Fannie Mae (HomePath), Freddie Mac (HomeSteps), and VA REO (VRM), bypassing HTML parsing without CAPTCHA triggers. (Prototyped in `server/scrapers/spa-xhr.js`, but production scrapers remain unpromoted).
3. **P0.4 — Crawlee-Style AutoThrottle:** Dynamically spacing requests based on upstream latency and parsing `Retry-After` HTTP headers. (Fixed jitter exists; adaptive throttling not built).
4. **P0.5 — Parser Development-Mode Disk Cache:** Local disk cache saving raw HTML responses during development for offline selector refinement. (Never built).
5. **P0.6 — Selector Drift & Yield Collapse Alarms:** Computing DOM structure hashes and tracking field extraction yield percentages across runs to alert before data is corrupted. (Never built).
6. **P1.7 — Secondary LLM Extraction Lane:** Routing unparsed legal notices to an LLM extraction queue with human review. (Never built).
7. **P1.8 — Scrapling Adaptive Presentation Selectors:** Enabling Scrapling `adaptive=True` on non-identity fields with a frozen selector store. (Never built).
8. **P1.9 — Sanitized Markdown Evidence Snapshots:** Archiving `page.markdown()` snapshots alongside raw HTML for auditability. (Never built).

---

## 4. Unimplemented Discovery Brain & ServiceLink Plans

From `docs/discovery-brain-runbook.md` and `MEMORY.md` §14.11:

1. **ServiceLink Bounded Resumable Pagination Across 5,900 Archive Records:**
   - The live collector is capped at 500 records per run.
   - The historical archive contains 5,900 listings and 40,578 image references.
   - Resumable cursor pagination across all 50 states was designed but never built.
2. **Property Intelligence Source Atlas Automated Ingestion:**
   - Ingesting the 501 registry entries and 557 ledger rows in `Property_Intelligence_Source_Atlas_VERIFIED_2026-09-05.docx` into active automated collectors.
3. **Append-Only Cryptographic Evidence Ledger:**
   - Moving from local observation files to an append-only PostgreSQL evidence ledger with cryptographic run hashes.

---

## 5. Unimplemented Multi-Agent Architecture Plans

From `audit/02-plan.md` and `audit/04-revised-plan.md`:

1. **Tier 3.2 — Project-Native Capability Collapse:** Removing generic, uncurated third-party marketplace skills (generic GCP, general SEO, legacy social media templates) to leave only the 4 native verbs: `scrape -> normalize -> score -> publish`.
2. **Tier 3.3 — Typed Capability Graph & DAG Orchestrator:** Dynamic multi-agent DAG execution pipeline where specialized subagents execute parcel geocoding, HPI valuation, and title risk analysis in parallel with typed input/output schemas.
3. **Tier 3.4 — Usage Telemetry & Self-Tuning Trigger Weights:** Autonomous background adjustment of skill trigger confidence scores based on verified agent session outcomes.

---

## 6. Unimplemented Collection Expansion (ULTRAPLAN WS-E)

- **HUD Nationwide Sweep:** Bounded state queueing to expand HUD from OH/NJ declared scopes to all 52 jurisdictions. (Policy-deferred).
- **IRS Seized Property Promotion:** Blocked by publisher inventory (0 real estate auction cards observed during canaries).
- **GSA Surplus Real Estate Promotion:** Blocked by publisher `robots.txt` disallowing `/our-listing`.
- **CivilView Multi-County Expansion:** Enrolling remaining 19 New Jersey counties and Pennsylvania dockets.

---

## 7. Unimplemented Infrastructure & Commercial Features

- **Persistent Cache Volume:** Adding persistent disk storage (e.g. Render Persistent Disk or Cloudflare R2 / S3) so `.cache/` survives container redeploys.
- **Production Webhook Receivers:** Connecting live production receivers for `NEWSLETTER_ENDPOINT` and `CONTACT_ENDPOINT`.
- **Custom Apex Domain & Branded SSL:** Binding `https://perfectproperty.app` (or custom apex domain).
- **Multi-Tenant / Multi-User Auth:** Post-beta role-based access control (RBAC) separating anonymous viewers, subscriber members, and system operators.
- **Formal Legal Review:** Independent attorney review of `/terms` and `/privacy`.

---

*Reference: Current operational state is guarded by [`docs/COMPLETION_CHECKLIST.md`](./COMPLETION_CHECKLIST.md).*
