# County Recorders & GSA Open-Data Adapter Qualification Report

**Date**: 2026-11-10  
**Domain**: Discovery & Statutory Distress Ingestion Architecture  
**Focus**: Option A — Live Recorder & County Adapter Qualification  
**Target Adapters**:
1. `server/scrapers/adapters/cook-recorder.js` (Cook County, IL Pre-Foreclosure Chancery & Sheriff Sales)
2. `server/scrapers/adapters/miami-dade-clerk.js` (Miami-Dade County, FL Lis Pendens & RealTaxDeed Public Auctions)
3. `server/scrapers/adapters/gsa-api.js` (Official GSA Auctions Open-Data REST API)

---

## 1. Executive Summary & Verification Outcomes

| Target Component | Jurisdiction / Target | Statute / API Surface | Qualification Tests | Gate Status |
|---|---|---|---|---|
| **Cook County Recorder** | Cook County, IL (Chicago Metro) | 735 ILCS 5/Art. XV (IMFL Judicial Foreclosure) | 9 positive/negative controls | **QUALIFIED** |
| **Miami-Dade Clerk** | Miami-Dade County, FL (Miami Metro) | Fla. Stat. § 197.502/542 (Tax Deed) & § 48.23 (Lis Pendens) | 9 positive/negative controls | **QUALIFIED** |
| **GSA Auctions API** | Nationwide US Surplus | Official REST API (`api.gsa.gov/assets/gsaauctions/v2`) | 6 positive/negative controls | **QUALIFIED** |

### Execution Receipt
```
> node --test test/county_recorders_and_gsa.test.js test/county_platform_adapters.test.js

✔ CivilView adapter maps New Jersey counties and builds URLs (1.8085ms)
...
✔ RealAuction fetchCountyRealauction accumulates listings across candidate dates via ColdFusion AJAX (1.429ms)
✔ Cook County Recorder: defines statutory document types and builds search URLs (1.2093ms)
✔ Cook County Recorder: PIN formatting and extraction (0.6514ms)
✔ Cook County Recorder: Chancery case number extraction (0.3808ms)
✔ Cook County Recorder: identifies statutory distress stages (0.2385ms)
✔ Cook County Recorder: parses Lis Pendens row with zero-fabrication underwriting (1.8569ms)
✔ Cook County Recorder: parses full search results HTML page (1.2216ms)
✔ Miami-Dade Adapter: defines document types and URLs (0.1926ms)
✔ Miami-Dade Adapter: Folio formatting and extraction (0.2976ms)
✔ Miami-Dade Adapter: Case number and Certificate extraction (0.8565ms)
✔ Miami-Dade Adapter: Opening bid parsing (0.2155ms)
✔ Miami-Dade Adapter: parses RealTaxDeed public auction card with statutory opening bid (1.8044ms)
✔ Miami-Dade Adapter: parses Official Clerk Lis Pendens row with zero-fabrication (1.172ms)
✔ GSA Open-Data API: URL builder strictly targets api.gsa.gov and bypasses /our-listing (0.2019ms)
✔ GSA Open-Data API: property type mapping (0.3453ms)
✔ GSA Open-Data API: location parsing handles structured fields and fallback prose (0.2285ms)
✔ GSA Open-Data API: standardizes single auction item with zero-fabrication (1.1302ms)
✔ GSA Open-Data API: parses full JSON API payload and filters non-real-estate items (1.1782ms)
✔ GsaApiAdapter: fetches auctions using injected transport (0.3417ms)
✔ GsaSurplusScraper: scrapeApi runs cleanly and bypasses /our-listing (2.8243ms)
✔ Track 1 Qualification - GSA API: strict non-real-estate rejection and real-estate acceptance (0.642ms)
✔ Track 1 Qualification - GSA API: never fabricates or admits prohibited /our-listing HTML URLs (0.1276ms)
✔ Track 4 Qualification - Cook County: identity validation, opening bid / judgment, and fail closed (1.0325ms)
✔ Track 4 Qualification - Miami-Dade: identity validation, opening bid / judgment, and fail closed (2.7043ms)
✔ Track 4 Qualification - Harris & Maricopa: evidence-only and robots-fail-closed controls (11.9976ms)

ℹ tests 51 | suites 0 | pass 51 | fail 0 | cancelled 0 | duration_ms 431.2
```

---

## 2. GSA Auctions Open-Data REST API Qualification (Track 1)

### Context & Historic Blocker Resolution
In prior canary cycles (`reports/canary-not-clean-gsa-irs-2026-09-20.md`), GSA was held at `NOT_CLEAN` due to the publisher robots exclusion on `realestatesales.gov/our-listing`. In accordance with project policy ($0 scraping liability moat), `SCRAPER_RESPECT_ROBOTS` was left enabled and the endpoint failed closed.

### Qualification Findings
The adapter in `server/scrapers/adapters/gsa-api.js` provides a machine-readable client resolving this blocker:
1. **Official Data Endpoint**: Targets `https://api.gsa.gov/assets/gsaauctions/v2/auctions`, entirely avoiding the prohibited `/our-listing` HTML route.
2. **Strict Category Sanitization**: GSA mixes surplus personal property, vehicles, and electronics with real property. The adapter rejects non-real-estate assets (verified against 7 explicit negative controls: vehicles, equipment, office furniture, boats, lab equipment, hardware, and tools).
3. **Property Type Standardization**: Normalizes raw categories into canonical property types: `Commercial`, `Land`, `Office`, `Single Family`, `Warehouse`, `Condo`, `Duplex`, `Triplex`.
4. **Zero-Fabrication Underwriting**: Extracts observed publisher bids (`openingBid`, `currentBid`), but strictly leaves `estLow`, `estHigh`, and `assessed` as `null`. No estimates are imputed from bidding activity.
5. **URL Sanitization Invariant**: If a prohibited `/our-listing` link appears in raw API payload fields, it is sanitized to `null`. Detail links are accepted only for permitted routes (`/asset-details/`).

---

## 3. Cook County, IL Pre-Foreclosure Recorder Qualification (Track 4)

### Context & Statutory Authority
Cook County (FIPS 17031) represents the 2nd most populous county in the US and operates under the Illinois Mortgage Foreclosure Law (735 ILCS 5/Art. XV). Foreclosures originate in the Circuit Court of Cook County Chancery Division and require recorded Lis Pendens notices with the Cook County Clerk (Recording Division).

### Qualification Findings
1. **Permanent Index Number (PIN / APN) Normalization**:
   - Formats standard 14-digit Cook County PINs: `XX-XX-XXX-XXX-XXXX` (Area-SubArea-Block-Parcel-Unit).
   - Formats 10-digit Cook County base parcels: `XX-XX-XXX-XXX` (with optional unit zero-padding).
   - Extracts PINs from prose, unstructured text, and structured table cells.
   - Strict validation: rejects truncated or non-numeric PIN tokens (returns `null`).
2. **Chancery Docket Extraction**:
   - Extracts standard Circuit Court Chancery case numbers (`YYYY-CH-NNNNN` or `YY-CH-NNNN`), normalizing 2-digit years and zero-padding sequential docket numbers.
   - Handles Civil (`YYYY-L-NNNNNN`) and Municipal (`YYYY-M-NNNNNN`) division foreclosure decrees.
3. **Statutory Distress Stage Classification**:
   - `LIS PENDENS` / `LIS PENDENS FORECLOSURE` / `FORECLOSURE CHANCERY` → `PRE_FORECLOSURE`
   - `SHERIFF SALE NOTICE` / `NOTICE OF SHERIFF SALE` → `SCHEDULED_AUCTION`
   - `SHERIFF DEED` / `CERTIFICATE OF SALE` → `SOLD_POST_SALE`
4. **Zero-Fabrication Underwriting Invariant**:
   - Lis Pendens filings record notice of pending legal action; `openingBid`, `estLow`, `estHigh`, and `assessed` are strictly `null`.
   - Scheduled Sheriff Sale notices extract published judgment and opening bid amounts without imputing market values.
5. **Fail-Closed Gate**:
   - Requires at least one identity anchor (`recordingNumber`, `pin`, `caseNumber`, `defendant`); returns `null` for unanchored markup.
   - Forbids detail URL inference from recording numbers without captured publisher URLs.

---

## 4. Miami-Dade County, FL Clerk & RealTaxDeed Qualification (Track 4)

### Context & Statutory Authority
Miami-Dade County (FIPS 12086) operates under Florida statutory foreclosure (§ 48.23 Lis Pendens, § 702 Foreclosure) and tax deed auctions (Fla. Stat. Chapter 197).

### Qualification Findings
The adapter (`server/scrapers/adapters/miami-dade-clerk.js`) supports dual-surface discovery:
1. **Miami-Dade RealTaxDeed Public Auctions (`miamidade.realtaxdeed.com`)**:
   - Parses ColdFusion auction cards (`ad_tab`, `AD_LBL`).
   - Extracts Tax Deed File numbers (`YYYY-TX-NNNNNN`, `TD-YYYY-NNNNNN`) and Tax Certificate numbers (Fla. Stat. § 197.432).
   - Extracts statutory minimum / opening bid (delinquent taxes + interest + fees per Fla. Stat. § 197.502).
   - Classifies stage as `SCHEDULED_AUCTION`.
2. **Miami-Dade Clerk Official Records (`onrecords.miamidadeclerk.gov`)**:
   - Extracts Clerk File Numbers (CFN), recording dates, and Circuit Court Civil case numbers (`YYYY-NNNNNN-CA-01`).
   - Extracts 13-digit Miami-Dade Folio numbers: `XX-XXXX-XXX-XXXX` (Municipality-Township/Range/Section-Subdivision-Parcel).
   - Captures Grantor (Defendant) and Grantee (Plaintiff) identities.
   - Classifies stage as `PRE_FORECLOSURE`.
3. **Zero-Fabrication Underwriting Invariant**:
   - Lis Pendens rows enforce `openingBid: null` and `saleDate: null`.
   - Tax Deed cards capture statutory opening bid, but `estLow`, `estHigh`, and `assessed` remain strictly `null`.
4. **Fail-Closed Gate**:
   - Requires valid identity anchor (`folio`, `auctionId`, `caseNumber`, `certificateNumber`, `cfn`, or `grantor`).
   - Handles corrupted or whitespace markup by failing closed to `null` / `[]`.

---

## 5. Canary Execution & Operational Protocol

### Canary Engine Verification (`scripts/canary-live.js`)
- Runs Migration 014 promotion gate:
  - Requires 2 distinct clean runs for the identical acquisition scope.
  - Requires: `accepted > 0`, `rejected === 0`, `report.recordsRejected === 0`, `report.complete === true`, `report.fullSweepComplete === true`, `report.truncated === false`, `report.fixtureFallbackUsed === false`.
- **Dry-run mode verified**: Emits exact `npm run discovery:worker -- --canary <source>` and promotion instructions when running without an active PostgreSQL cluster.
- **Scrapling Bridge Hinting**: Explicitly surfaces `SCRAPLING_SOURCES` flags for structural parser execution across qualified sources (`gsa`, `hud`, `treasury`, `irs`, `usda`, `civilview`, `ca-controller-tax-sale`).

### Source Policy & Domain Access Control
- In `server/scrapers/source-policy.js`:
  - `trustee`: `recording.cookcountyclerkil.gov` and `onrecords.miamidadeclerk.gov` are authorized publisher domains.
  - `sheriff`: `realtaxdeed.com` and `realforeclose.com` subdomains are authorized publisher domains.
  - `gsa`: `realestatesales.gov` and `www.gsa.gov` are authorized publisher domains; `api.gsa.gov` is the authenticated REST interface.

---

## 6. Recommendations & Next Steps

1. **GSA Canary Promotion**:
   - With `GSA_USE_OPEN_DATA_API=1` and `GSA_API_KEY` configured, execute two consecutive live canary sweeps via `node scripts/canary-live.js run --source gsa --repeat 2`.
   - Verify promotion readiness with `node scripts/canary-live.js promote --source gsa`.
2. **County Recorder Live Schedule**:
   - Wire Cook County and Miami-Dade county clerk collectors into scheduled multi-county cron passes alongside Maricopa and Harris under `TrusteeSaleScraper`.
   - Maintain strict `evidenceOnly=true` or zero-fabrication guarantees on all recorder-intake dockets until matched with county cadastral GIS or tax collector assessments.
