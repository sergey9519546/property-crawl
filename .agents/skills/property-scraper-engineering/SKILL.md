---
name: property-scraper-engineering
description: |
  Patterns and best practices for building resilient government auction scrapers,
  county docket crawlers, circuit breaker protection, cadastral APN resolution,
  verbatim citation span verification, and anti-poisoning data gates.
license: MIT
metadata:
  version: v2
  domain: data-engineering
---

# Property Scraper Engineering Skill

Use this skill when building, auditing, or repairing scrapers, normalizers, enrichment adapters, or legal-notice parsers (`server/scrapers/*`, `server/enrichment/*`, `server/ai/notice-parser.js`, `server/public-records/*`).

## Core Engineering & Legal Directives

1. **Zero Legal/ToS/Robots Violations (Fail-Closed Policy)**:
   - **Never bypass CAPTCHAs or challenge walls** (`landbank`, `ca-controller-tax-sale`, Cloudflare 403/turnstiles must fail closed via `ScraperCircuitBreaker`).
   - **Respect `robots.txt`**: `gsa` disallows `/our-listing` in `realestatesales.gov/robots.txt`; keep `gsa` fail-closed until publisher `robots.txt` or an official API changes.
   - **Respect Press Association ToS (`docs/STRATEGY.md` Hack #1)**: Never bot-scrape statewide public notice portals (`publicnoticeillinois.com`, `floridapublicnotices.com`, etc.) that impose liquidated damages ($10,000/incident in IL). Ingest via Email-as-API (`server/scrapers/email-intake.js`).
   - **Respect Map Provider ToS**: Never feed Google Maps Street View imagery into AI/ML models or scrape undocumented tile endpoints.

2. **Circuit Breaker & Anti-Poisoning Enforcement**:
   - Wrap all external network requests in `ScraperCircuitBreaker` (`server/scrapers/circuit-breaker.js`).
   - Never overwrite existing database records or listing registries with 0-byte, 403, or client-rendered empty SPA shell payloads (`looksLikeClientRenderedShell` + `applyEmptyInventoryHonesty`).
   - Control-test per-record detail URLs before promoting or modifying a collector (`docs/COMPLETION_CHECKLIST.md`: e.g., CivilView detail routes return HTTP 200 and require per-record fetches; ServiceLink detail routes return HTTP 404 when unauthenticated and must rely on grid JSON).

3. **Schema Normalization & Deterministic Parcel Identity (`server/scrapers/normalization.js`, `server/enrichment/arcgis-parcels.js`)**:
   - All listings standardize into the canonical camelCase listing contract (`id`, `source`, `state`, `county`, `city`, `zip`, `address`, `lat`, `lng`, `openingBid`, `estLow`, `estHigh`, `assessed`, `saleDate`, `plaintiff`, `defendant`, `attorney`, `judgment`, `occupancy`, `deposit`, `photo`, `sourceUrl`, `raw`, `parcelKey`, `triage`).
   - **Canonical `parcelKey` (`${countyFips}-${normalizedApn}`)**:
     - `extractRawApn(raw)` checks structured fields first (`apn`, `parcelId`, `parcelNumber`, `taxId`, `pin`, `folio`, `strap`, `alternateKey`), then mines labeled prose patterns (`Parcel ID / APN / PIN / Tax Map / Folio / Block X Lot Y`) from `raw.legalDescription`, `raw.description`, `raw.noticeText`, `raw.remarks`, and `raw.summary`.
     - `extractCountyFips(raw, fallbackState)` resolves 5-digit county FIPS codes across structured fields or the 60+ county fallback registry (`COUNTY_FIPS_LOOKUP`, mirrored in `server/routes/listings.js`).
     - **Address-to-ArcGIS Cadastral Parcel Bridge (`resolveCadastralParcelIdentity` in `server/enrichment/arcgis-parcels.js`)**: When a foreclosure notice publishes a street address + county/coordinates but omits the APN, query the county's public ArcGIS REST Assessor layer (`queryParcelByAddress` / `queryParcelByPoint`) to recover the official assessor `apn`, `countyFips`, and `parcelKey` (`resolvedVia: 'arcgis_cadastral_address' | 'arcgis_cadastral_point'`), plus assessed value and lot dimensions. Never fabricate a `parcelKey` when neither publisher APN nor cadastral match is available.
     - **FL-DOR Cadastral Situs Rule (`server/scrapers/fl-dor-cadastral.js`)**: Attribute Florida counties from the record's own situs evidence (`PHY_CITY` / situs fields), never from `CO_NO` last-resort fallback.

4. **OCR Cleaning & Verbatim Span Verification (`server/ai/notice-parser.js`)**:
   - Pass raw legal notices through `normalizeOcrText` to repair OCR letter-for-number substitutions (`$12O,OOO` -> `$120,000`) and hyphenated line breaks.
   - **Verbatim Character-Span Citations (`verifyVerbatimSpan`, `evidenceSpans`, `confidence_score`)**:
     - Every extracted field (`plaintiff`, `defendant`, `caseNumber`, `apn`, `address`, `saleDate`, `openingBid`, `judgmentAmount`) must be verified against the normalized notice text via `verifyVerbatimSpan(fullText, candidateQuote, fallbackValue)`.
     - Confirmed substrings emit `{ quote, startChar, endChar, verified: true }` in `evidenceSpans` and boost deterministic `confidence_score` (`0.00–1.00`); unverified quotes degrade cleanly to `verified: false` (never hallucinate character offsets).
     - `src/components/workspace/review-split-pane.tsx` renders interactive `VERIFIED CHAR A–B` badges that scroll and highlight the exact verbatim substring in the left-pane source notice.

5. **Enrichment Proxy Security Boundary (`src/app/api/enrichment/`)**:
   - Cached enrichment reads (`GET /api/enrichment` and `GET /api/enrichment/:id`) are public (`proxyPropertyApi`).
   - Live outbound enrichment refreshes (`POST /api/enrichment/:id/refresh`) trigger external adapter requests and require an authenticated operator session (`proxyPrivatePropertyApi`).
