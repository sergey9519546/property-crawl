# Technology Stack & Infrastructure Audit

**Project:** Property-Crawl (`property-crawl`)  
**Version:** 2.0.0  
**Audit Date:** November 9, 2026  
**Auditor:** Tech Stack & Infrastructure Auditor  
**Repository Location:** `C:\Users\serge\.minimax\sessions\mvs_33469e4a8e48472faf25c6f55a29c489\workspace\property-crawl`

---

## 1. Executive Summary & Architecture Overview

`property-crawl` is an evidence-first, private operator real estate intelligence workspace and distress meta-aggregator for pre-foreclosure, tax deed, sheriff sale, and government-acquired residential assets.

The repository employs a **hybrid architecture** combining a modern Next.js 16 frontend and an ultra-lean, frameworkless Node.js 22 backend, supported by an optional Python 3 anti-detect scraping subsystem.

```
                              ┌───────────────────────────────────────────────┐
                              │           Public Internet / CDN               │
                              └──────────────────────┬────────────────────────┘
                                                     │
                                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Web Layer (Next.js 16.3.8 + React 19.2.8 + Turbopack)                                                      │
│ - Port 3000 (Production Public Port)                                                                       │
│ - Strict CSP Nonce Middleware (src/proxy.ts)                                                                │
│ - BFF Reverse Proxy: src/app/api/* → PROPERTY_API_URL (Internal Port 3002)                                  │
│ - UI: Tailwind CSS 4, Radix UI, Framer Motion, GSAP, Recharts, MapLibre GL 6.10                             │
└────────────────────────────────────────────────────┬────────────────────────────────────────────────────────┘
                                                     │ Local IPC / HTTP Loopback
                                                     ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Backend Listing & Discovery API (Pure Node.js 22 Runtime)                                                  │
│ - Native node:http (Zero Express/Fastify bloat)                                                             │
│ - Native node:test Test Runner                                                                              │
│ - Strict Socket Rate Limiting & Proxy Trust Keying (X-Forwarded-For)                                        │
│ - Ingest Scheduler & Discovery Worker Pool                                                                  │
└──────────────┬─────────────────────────────┬─────────────────────────────┬──────────────────────────────────┘
               │                             │                             │
               ▼                             ▼                             ▼
┌──────────────────────────────┐ ┌──────────────────────────────┐ ┌───────────────────────────────────────────┐
│ Primary Database             │ │ Embedded DB Fallback         │ │ Local Cadastral Index                     │
│ - PostgreSQL 16 + PostGIS 3.4│ │ - @electric-sql/pglite 0.5.8 │ │ - node:sqlite DatabaseSync (Node 22)      │
│ - Extensions: uuid-ossp,     │ │ - WASM PostGIS 3.6           │ │ - Read-only fast-path APN/FIPS lookup     │
│   pg_trgm, pgcrypto          │ │ - .cache/pgdata disk mount   │ │ - .cache/local-parcels.db                 │
└──────────────────────────────┘ └──────────────────────────────┘ └───────────────────────────────────────────┘
               │                             │                             │
               ▼                             ▼                             ▼
┌──────────────────────────────┐ ┌──────────────────────────────┐ ┌───────────────────────────────────────────┐
│ External Scraper Pipeline    │ │ Alerts & Transactional Mail  │ │ Imagery & Geospatial                      │
│ - Native Scrapers (Node.js)  │ │ - Resend HTTP API            │ │ - MapLibre GL 6.10 (Vector Maps)          │
│ - LandBankSearch (70+ banks) │ │ - Local Outbox Fallback      │ │ - Google Street View Static + Embed       │
│ - Zyte API & Scrapy Cloud    │ │   (.cache/mail-outbox/)      │ │ - Panoramax Web Viewer (CDN ESM)          │
│ - Scrapling Toolchain (Py3)  │ │ - Webhook Leads (Formspree)  │ │ - Mapillary API v4 Fallback               │
└──────────────────────────────┘ └──────────────────────────────┘ └───────────────────────────────────────────┘
```

---

## 2. Runtime Engines & Language Environments

### 2.1 Node.js Runtime
* **Declared Engine:** `>=22.0.0` (in `package.json`).
* **Container Base Images:** `node:22-alpine` across `Dockerfile`, `Dockerfile.discovery`, `Dockerfile.production`, and `docker-compose.base44.yml`.
* **Execution Paradigm:**
  * **Zero Web Frameworks in Backend:** The API server (`server/server.js`) utilizes Node's built-in `node:http` module directly without Express, Fastify, or Koa.
  * **Standard Library Primacy:** Extensively leverages `node:crypto` for HMAC and SHA-256 evidence hashing, `node:net` for CIDR/IP validation, `node:child_process` for worker and Python bridges, `node:sqlite` for cadastral indexing, and native global `fetch`.
  * **Module Interop:** Dual-mode setup with CommonJS (`'use strict'`, `require`) for backend and scraping infrastructure, alongside native ECMAScript Modules (ESM) / TypeScript for Next.js UI components.

### 2.2 Python Runtime (Crawler & Anti-Detect Toolchain)
* **Target Version:** Python 3.11 / Python 3.12.
* **Environment Path:** Auto-detected from `.cache/crawler-tools/venv/Scripts/python.exe` (Windows), `.cache/crawler-tools/venv/bin/python` (Linux/macOS), or configured via `SCRAPLING_PYTHON`.
* **Manifest:** `scripts/crawlers/requirements.txt`
  ```text
  scrapling==0.4.15
  camoufox==0.5.8
  curl_cffi==0.16.3
  patchright==1.64.1
  browserforge==1.2.4
  ```
* **Active Python Modules:**
  * `scripts/crawlers/scrapling_extract.py`: Structural parser executing adaptive selector extraction.
  * `scripts/crawlers/scrapling_spa_xhr.py`: Headless browser interceptor for dynamic JavaScript SPAs.
  * `scripts/crawlers/scrapling_spider.py`: Crawling spider across nested portal listings.
  * `scripts/prepare-discovery-import.py`: Ingestion normalization utility.
  * `scripts/record-workspace-walkthrough.py`: Synthetic screen/operator workflow recorder.
  * `test/discovery_ui_regression_test.py`: UI regression suite.
  * `test/next_ui_e2e_test.py`: End-to-end integration suite.
  * `test/detail_media_recovery_e2e_test.py`: Media extraction recovery tests.
  * `test/scrapling_parser_test.py`: Scrapling parser verification.

---

## 3. Database & Persistence Layer

| Engine | Version / Implementation | Role | Storage Path / Connection |
| :--- | :--- | :--- | :--- |
| **PostgreSQL (Production)** | PostgreSQL 16 (PostGIS 3.4) | Primary relational & spatial inventory | `DATABASE_URL=postgres://...` |
| **PGlite (Embedded WASM)** | `@electric-sql/pglite` 0.5.8 | $0 / Local fallback when Postgres is absent | `.cache/pgdata` |
| **SQLite (Cadastral Index)**| Node 22 `node:sqlite` (`DatabaseSync`) | Read-only APN/FIPS spatial lookup cache | `.cache/local-parcels.db` |
| **Redis** | **NONE / NOT USED** | Intentionally omitted | N/A |
| **File / Disk Cache** | JSON / JSONL Append Stores | Operator state, triage, and leads | `.cache/*.json`, `.cache/form-submissions/` |

### 3.1 PostgreSQL & PostGIS Details
* **Container Image:** `postgis/postgis:16-3.4-alpine`
* **Client Driver:** `pg` (`^8.16.0`)
* **Minimum Supported Server Version:** PostgreSQL 14 (`MIN_SERVER_VERSION_NUM = 140000`). Production requires 16.
* **Mandatory Extensions:**
  * `postgis` (Geography data types, `ST_DWithin`, spatial bounds)
  * `uuid-ossp` (`uuid_generate_v4()`)
  * `pg_trgm` (Trigram text indexing for address/APN fuzzy search)
  * `pgcrypto` (Hashing and cryptographic token handling)
* **Schema & Migration Pipeline:**
  * Initial baseline: `server/db/schema.sql`
  * Applied migrations: `003-029` managed via `AUTO_MIGRATE=1` or `scripts/discovery-migrate.js`.
  * Core tables include: `listings`, `sources`, `saved_deals`, `listing_history`, `saved_searches`, `alert_matches`, `ai_cache`, `source_observations`, `source_observation_runs`, `document_reviews`, `accounts`, `account_login_tokens`, `stripe_webhook_events`, `worker_leases`, `discovery_jobs`, `discovery_source_runs`, `discovery_atlas_ledger`.

### 3.2 PGlite Embedded WASM Fallback
* **Packages:** `@electric-sql/pglite` (`^0.5.8`), `@electric-sql/pglite-postgis` (`^0.2.8`), `@electric-sql/pglite-socket` (`^0.2.11`).
* **Architecture:** In `server/db/pglite-pool.js`, PGlite runs a full WASM PostgreSQL engine with PostGIS 3.6 directly inside the Node process.
* **Adapter Surface:** Replicates the `node-postgres` (`pg.Pool`) surface, handling single vs. extended wire protocol variations and statement array responses.
* **Concurrency Handling:** Implements serialized checkout using `AsyncLocalStorage` (`flowStorage`) with re-entrancy support to prevent query deadlocks while sharing the single WASM connection.

### 3.3 Node 22 Built-in SQLite (`node:sqlite`)
* **Module:** `server/enrichment/local-parcel-index.js`
* **Mechanism:** Requires native `node:sqlite` (`DatabaseSync` class).
* **Usage:** Provides synchronous, low-latency, read-only indexing for millions of cadastral parcel boundaries by APN, County FIPS, and State code without network overhead.

### 3.4 Architectural Absence of Redis
* Redis is **deliberately absent** from the repository architecture.
* Task distribution and concurrency are governed natively in PostgreSQL using transactional row-level locking (`FOR UPDATE SKIP LOCKED`), worker leases (`worker_leases`), and time-bounded job fences (`discovery_jobs`).
* Caching is divided cleanly between durable disk-backed JSON stores in `.cache/`, in-memory Map structures with TTLs, and HTTP `Cache-Control` headers.

---

## 4. External Scraper APIs & Ingestion Pipelines

### 4.1 Zyte API & Scrapy Cloud
* **Client Implementation:** `server/scrapers/zyte-client.js`
* **Zyte Extraction API:** `https://api.zyte.com/v1/extract`
* **Scrapy Cloud API:** `https://app.zyte.com/api` (Default Project ID: `870105`)
* **Webhook Receiver:** `server/ingest/scrapy-webhook.js` secured via `SCRAPY_INGEST_SECRET`.
* **Security Guard:** Comprehensive SSRF validation (`isBlockedSsrfHost`, `isNonPublicIpv4`) denying loopback, RFC 1918 private subnets, link-local / IMDS (`169.254.0.0/16`), CGNAT, TEST-NET, multicast, and IPv4-mapped IPv6 literals.

### 4.2 LandBankSearch
* **Module:** `server/scrapers/landbanksearch.js`
* **Source:** `https://www.landbanksearch.com/data`
* **Scope:** Meta-aggregator sweeping over 70+ municipal US land banks with over 80,000+ distressed listings.
* **Mechanism:** Two-stage cursor rotation (`LANDBANK_ROTATION_OFFSET`, `LANDBANK_MAX_BANKS`), polite crawl jitter, automatic retry backoff, and unit-level run reporting (`server/scrapers/run-report.js`).

### 4.3 Scrapling Anti-Detect Subsystem
* **Bridge Modules:** `server/scrapers/scrapling-bridge.js`, `server/scrapers/scrapling-runner.js`, `server/scrapers/scrapling-spider.js`
* **Python Toolchain:** `scrapling`, `camoufox`, `curl_cffi`, `patchright`, `browserforge`
* **Operational Mode:** Invoked via subprocess with JSON IPC over stdin/stdout. Constrained by strict buffer limits (4MB input max, 2MB output max, 5000ms default timeout).
* **Extraction Profiles:** `gsa-index`, `gsa-detail`, `page-links`, `table-extract`, `hud-cards`, `treasury-detail`, `irs-detail`, `usda-table`, `civilview-sales`.

### 4.4 Public & Government Source Feeds
* **GSA Auctions:** `server/scrapers/gsa.js` (Open Data API + HTML scraper).
* **HUD Homestore:** `server/scrapers/hud.js` (State-by-state foreclosure inventory).
* **US Treasury:** `server/scrapers/treasury.js` (Seized property auctions).
* **IRS Real Estate:** `server/scrapers/irs.js` (IRC tax seizure sales).
* **USDA Rural Development:** `server/scrapers/usda.js`.
* **VA REO:** `server/scrapers/va.js` (Veterans Affairs acquired assets).
* **GSE Portals:** Fannie Mae HomePath (`server/scrapers/fannie.js`), Freddie Mac HomeSteps (`server/scrapers/freddie.js`).
* **Sheriff Sales & Tax Deeds:** CivilView (`server/scrapers/civilview.js`), Realauction, Bid4Assets (`server/scrapers/bid4assets.js`), California State Controller (`server/scrapers/ca-controller-tax-sale.js`), Florida Department of Revenue (`server/scrapers/fl-dor-cadastral.js`).
* **CourtListener / RECAP:** `server/scrapers/courtlistener.js` (Free Law Project REST API v4 for bankruptcy and federal foreclosure docket monitoring).
* **HUD / USPS Vacancy:** `server/scrapers/hud-usps-vacancy.js` (Public HUD GIS Open Data ArcGIS Hub mirror).
* **FHFA House Price Index:** `server/scrapers/fhfa-hpi.js` (Master valuation macro time-series).

### 4.5 IMAP Legal Notice Ingestion
* **Module:** `server/scrapers/email-ingest.js`, `scripts/collect-email-notices.js`
* **Protocol:** IMAP over TLS (port 993) implemented with native Node `tls` sockets.
* **Function:** Ingests press-association legal notice alerts and newspaper classified feeds into raw evidence packets.

---

## 5. Alerting, Notifications & External Communication

### 5.1 Resend Email Delivery
* **Client Implementation:** `server/delivery/resend-client.js`, `server/delivery/outbound-mail.js`
* **Endpoint:** `https://api.resend.com/emails` (Direct native HTTP `fetch` - zero external npm package dependencies).
* **Credentials:** `RESEND_API_KEY`, `RESEND_FROM` (Defaults to `PerfectProperty Alerts <alerts@perfectproperty.org>`).
* **Payloads:** Deal alerts, search subscription matches, and operator notifications using high-contrast, accessible HTML and plaintext multipart MIME structures.

### 5.2 Local Outbox Fallback (Offline Mode)
* When `RESEND_API_KEY` is not present, outbound emails automatically append as structured JSON Lines into `.cache/mail-outbox/outbox.jsonl`. The API reports `{ delivery: "local", sent: false }` to prevent misleading delivery claims.

### 5.3 Webhook Lead Endpoints
* Configurable via `NEWSLETTER_ENDPOINT` and `CONTACT_ENDPOINT` (e.g., Formspree or custom operator webhooks). Form submissions write locally to `.cache/form-submissions/` if webhooks are unconfigured.

---

## 6. Mapping, Visualization & Geocoding

### 6.1 Interactive Web Mapping
* **Primary Rendering Engine:** `maplibre-gl` (`6.10.0`)
* **Styling & CSS:** `maplibre-gl/dist/maplibre-gl.css`
* **Canvas Componentry:**
  * `src/components/listings/discovery-map.tsx`: Interactive asset search map.
  * `src/components/site/deal-discovery-map.tsx`: Marketing landing discovery map.
  * `src/components/terminal/market-map.tsx`: High-density operator terminal map.
* **Vector & Geo Helpers:** `@mapbox/vector-tile`, `@mapbox/point-geometry`, `@maplibre/vt-pbf`, `pmtiles`, `geojson-vt`.
* **Note on Leaflet & Mapbox:** **Leaflet is not used**. Mapbox GL JS is not directly imported; MapLibre GL is utilized to maintain open standards and zero mandatory commercial map tile fees.

### 6.2 Street-Level Imagery & Panoramas
* **Google Maps Platform:**
  * Street View Static API: `server/routes/property-image.js` via server key `GOOGLE_MAPS_API_KEY`.
  * Geocoding API: Rooftop geocoder with strict circuit breaker thresholds via `GOOGLE_GEOCODING_API_KEY`.
  * Maps Embed API: Interactive browser panorama viewer (`src/components/listings/interactive-street-view.tsx`) using `NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY`.
  * Maps JavaScript API: Walkthrough viewer via `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`.
* **Panoramax (Open Street Imagery):**
  * ESM CDN integration (`src/lib/panoramax-viewer.ts`) via `@panoramax/web-viewer@5.2.0` and `@photo-sphere-viewer/core@5.15.1`.
  * Endpoint configured via `PANORAMAX_API_ENDPOINT`.
* **Mapillary:**
  * Fallback street photo resolution via `MAPILLARY_ACCESS_TOKEN` (`server/media/mapillary.js`).

---

## 7. Billing, Payments & Authentication

### 7.1 Stripe Billing Subsystem
* **Server Implementation:** `server/billing/stripe-checkout.js`
* **Webhook Endpoint:** `src/app/api/webhooks/stripe/route.ts`
* **Configuration:** `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`.
* **Capabilities:** Checkout session creation, customer portal link generation, webhook signature verification (`stripe_webhook_events` audit table), and entitlement tier gating.

### 7.2 Operator Authentication & Workspace Identity
* **Credentials:** `SCRAPER_ADMIN_TOKEN` (alias: `PROPERTY_OPERATOR_SECRET`).
* **Session Cookie:** Encrypted workspace session token governed by `WORKSPACE_SESSION_SECRET` and `WORKSPACE_SESSION_EPOCH`.
* **Cookie Security:** Enforces `Secure`, `HttpOnly`, and `SameSite=Strict`. Only permits insecure cookies if `WORKSPACE_COOKIE_INSECURE=1` is explicitly provided during local HTTP development.

---

## 8. Hosting Infrastructure & Deployment Manifests

| Host / Platform | Configuration File | Runtime Container / Image | Exposed Port | Tier Target |
| :--- | :--- | :--- | :--- | :--- |
| **Render** | `render.yaml` | `Dockerfile.production` | 3000 (Internal 3002) | Free Tier ($0) / Standard |
| **Fly.io** | `fly.toml` | `Dockerfile.production` | 3000 | Eco / Shared CPU |
| **Koyeb** | `koyeb.yml` | `Dockerfile.production` | 3000 | Eco Instance ($0 Free Tier)|
| **Vercel** | `vercel.json` | Next.js Serverless Framework | N/A | Hobby / Pro |
| **Docker Compose (Core)**| `docker-compose.yml` | `Dockerfile` + PostGIS 16 | 3000 (API), 5432 (DB) | Self-hosted Linux |
| **Docker Compose (Disc.)**| `docker-compose.discovery.yml` | Multi-container micro-stack | 3000 (API), 3001 (UI), 55432 | Dedicated Discovery Cluster|
| **Base44 Dev Container** | `docker-compose.base44.yml` | Live-reload source volume mount| 3000 (Web), 3000 (API IPC) | Cloud IDE / Dev Sandbox |

### 8.1 Dual-Process Architecture in `Dockerfile.production`
Production deployments on Render, Koyeb, and Fly.io execute `scripts/start-production.js`. This supervisor process:
1. Detects host memory ceilings from Linux cgroups (`/sys/fs/cgroup/memory.max` or `memory.limit_in_bytes`).
2. Configures Node Old Space limits dynamically (`--max-old-space-size`).
3. Boots the backend listing API (`server/server.js`) on an internal loopback port (default `3002`).
4. Polls `/api/health` and `/api/health/ready` until healthy.
5. Boots Next.js standalone runner (`next start`) on public port `3000`, proxying backend requests to loopback.

---

## 9. Dependency Inventory & Exact Versions

### 9.1 Core Production Dependencies (`package.json`)
```json
{
  "next": "16.3.8",
  "react": "19.2.8",
  "react-dom": "19.2.8",
  "pg": "^8.16.0",
  "tailwindcss": "4.3.3",
  "@tailwindcss/postcss": "4.3.3",
  "postcss": "8.5.26",
  "maplibre-gl": "6.10.0",
  "framer-motion": "13.1.1",
  "gsap": "3.15.0",
  "recharts": "3.10.1",
  "lucide-react": "1.38.0",
  "robots-parser": "3.0.1",
  "clsx": "2.1.1",
  "tailwind-merge": "3.6.0",
  "class-variance-authority": "0.7.1",
  "cmdk": "1.1.1",
  "embla-carousel-react": "8.6.0",
  "input-otp": "1.5.0",
  "next-themes": "0.4.6",
  "react-day-picker": "10.0.1",
  "react-hook-form": "7.87.0",
  "react-resizable-panels": "4.12.3",
  "sonner": "2.0.8",
  "tw-animate-css": "1.4.0",
  "vaul": "1.1.2"
}
```

### 9.2 Radix UI Suite (`package.json`)
* `@radix-ui/react-accordion`: `1.2.20`
* `@radix-ui/react-alert-dialog`: `1.1.23`
* `@radix-ui/react-aspect-ratio`: `1.1.15`
* `@radix-ui/react-avatar`: `1.2.6`
* `@radix-ui/react-checkbox`: `1.3.11`
* `@radix-ui/react-collapsible`: `1.1.20`
* `@radix-ui/react-context-menu`: `2.3.7`
* `@radix-ui/react-dialog`: `1.1.23`
* `@radix-ui/react-dropdown-menu`: `2.1.24`
* `@radix-ui/react-hover-card`: `1.1.23`
* `@radix-ui/react-label`: `2.1.15`
* `@radix-ui/react-menubar`: `1.1.24`
* `@radix-ui/react-navigation-menu`: `1.2.22`
* `@radix-ui/react-popover`: `1.1.23`
* `@radix-ui/react-progress`: `1.1.16`
* `@radix-ui/react-radio-group`: `1.4.7`
* `@radix-ui/react-scroll-area`: `1.2.18`
* `@radix-ui/react-select`: `2.3.7`
* `@radix-ui/react-separator`: `1.1.15`
* `@radix-ui/react-slider`: `1.4.7`
* `@radix-ui/react-slot`: `1.3.3`
* `@radix-ui/react-switch`: `1.3.7`
* `@radix-ui/react-tabs`: `1.1.21`
* `@radix-ui/react-toast`: `1.2.23`
* `@radix-ui/react-toggle`: `1.1.18`
* `@radix-ui/react-toggle-group`: `1.1.19`
* `@radix-ui/react-tooltip`: `1.2.16`

### 9.3 Development & Tooling Dependencies (`package.json`)
```json
{
  "@electric-sql/pglite": "^0.5.8",
  "@electric-sql/pglite-postgis": "^0.2.8",
  "@electric-sql/pglite-socket": "^0.2.11",
  "@types/node": "22.7.4",
  "@types/react": "19.0.10",
  "@types/react-dom": "19.0.4",
  "@types/three": "0.169.0",
  "eslint": "^9.11.1",
  "eslint-config-next": "16.3.3",
  "typescript": "5.6.3"
}
```

### 9.4 Python Scraper Dependencies (`scripts/crawlers/requirements.txt`)
```text
scrapling==0.4.15
camoufox==0.5.8
curl_cffi==0.16.3
patchright==1.64.1
browserforge==1.2.4
```

---

## 10. NPM Script Matrix & Operational Commands

### 10.1 Development & Server Execution
* `npm run dev`: Boots Next.js development server on port 3001.
* `npm run dev:api`: Runs backend Node API on internal port using `.env.local`.
* `npm run dev:workspace`: Runs unified dev workspace orchestrator.
* `npm run start`: Starts production Next.js instance on port 3001.
* `npm run start:production`: Boots production dual-process supervisor (`scripts/start-production.js`).
* `npm run build`: Executes `next build && node scripts/ensure-nft-manifests.js`.

### 10.2 Database & Data Management
* `npm run db:seed`: Seeds database from static snapshot (`scripts/seed-from-v0.js`).
* `npm run db:import`: Imports live listings into database (`scripts/db-import-live.js`).
* `npm run db:prune`: Prunes expired / concluded auction records (`scripts/db-prune-ended.js`).
* `npm run discovery:migrate`: Executes migration pipeline (`scripts/discovery-migrate.js`).
* `npm run parcels:seed`: Seeds local SQLite parcel database (`scripts/seed-local-parcels.js`).

### 10.3 Scraping & Source Intake
* `npm run scrape`: Executes scraper scheduler loop (`server/scrapers/scheduler.js`).
* `npm run sources:collect`: Runs manual collector across catalog sources.
* `npm run sources:intake`: Dispatches source intake processor.
* `npm run sources:email`: Ingests email notices from configured IMAP inbox.
* `npm run civilview:counties`: Updates CivilView county listings.
* `npm run canary:live`: Executes live canary validation runs across source adapters.

### 10.4 Quality Gates & Testing
* `npm test`: Runs primary test suite verification (`node test/verify.js`).
* `npm run release:gate`: Runs canonical pre-commit release qualification gate.
* `npm run typecheck`: Runs strict TypeScript checking (`tsc --noEmit`).
* `npm run test:db`: Runs PostgreSQL & PGlite migration and lifecycle tests.
* `npm run test:discovery`: Runs discovery engine backend and contract tests.
* `npm run test:scrapers`: Runs scrapers, circuit breakers, and parser suites.
* `npm run test:evidence-truth`: Validates evidence hashing, CORS, and sanitization.

---

## 11. Security, Rate Limiting & Network Hardening

* **Content Security Policy (CSP):** Evaluated per-request in `src/proxy.ts` with dynamically generated cryptographic nonces (`strict-dynamic`, no `'unsafe-inline'` allowed for script tags).
* **Cross-Origin Resource Sharing (CORS):** Refuses to trust the HTTP `Host` header. Only explicitly declared origins in `CORS_ALLOWED_ORIGINS` and `PUBLIC_APP_ORIGIN` are acknowledged.
* **Socket & API Rate Limiting:** Managed in `server/security/api-rate-policy.js`. When operating behind reverse proxies (Render, Cloudflare, Fly, Koyeb), setting `TRUSTED_PROXY_COUNT=1` keys limits strictly on real client IPs derived from sanitized `X-Forwarded-For` chains.
* **Server-Side Request Forgery (SSRF) Defense:** In both `zyte-client.js` and `scrapling-bridge.js`, outbound target URLs are subjected to strict network checks that reject all loopback, local, RFC 1918, link-local, multicast, and cloud metadata (IMDS) addresses.

---
*Report generated and committed to `.planning/codebase/STACK.md`.*
