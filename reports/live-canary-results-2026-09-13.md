# Live canary results — 2026-09-13

Direct adapter execution in demo mode (no PostgreSQL). Each adapter was called
via `scrapeFeed()` with a bounded record budget. Results are source-observed
facts, not promotion evidence — Migration 014 requires two clean durable runs
through the discovery worker with PostgreSQL before any source promotes.

---

## FL DOR statewide cadastral — PASS

| Metric | Value |
|---|---|
| Budget | 20 records |
| Publisher features fetched | 36 |
| Accepted | 20 |
| Rejected | 16 (missing situs address or parcel ID — correct) |
| Pages | 4 |
| parcelKey coverage | 20/20 |
| sourceUrl coverage | 20/20 (exact ArcGIS feature URLs) |
| Provenance coverage | 20/20 (`origin: live`, `observed: true`) |
| Counties observed | 12021 (Alachua) |
| Sample | `2601 NE 160TH LN, GAINESVILLE, FL 32609` → `12021-07702000000` |

**Endpoint**: `services9.arcgis.com/Gh9awoU677aKree0/.../Florida_Statewide_Cadastral/FeatureServer/0`

**Assessment**: Adapter works end-to-end against live ArcGIS. Field mapping,
pagination, parcelKey computation, and provenance all verified with real data.
Ready for durable canary runs once PostgreSQL is available.

---

## CourtListener / RECAP — PASS

| Metric | Value |
|---|---|
| Budget | 10 records |
| Publisher results | 20 |
| Accepted | 10 |
| Rejected | 0 |
| Pages | 1 (cursor pagination) |
| raw coverage | 10/10 |
| docketNumber coverage | 10/10 |
| States observed | CA, DC, FL, IL, LA, MO, SC, TX |
| Sample | `courtlistener-74783714` — POWER THE FUTURE v. OFFICE OF MANAGEMENT AND BUDGET (DC) |

**Endpoint**: `courtlistener.com/api/rest/v4/search/?q=foreclosure&type=r`

**Assessment**: Adapter works end-to-end against live CourtListener API. Cursor
pagination, state extraction, provenance (docket number, court, parties,
attorneys, cause, PACER case ID) all verified. Rate limiting observed (1 req/sec).
Ready for durable canary runs.

---

## CA Controller tax-sale — FAIL CLOSED (expected)

| Metric | Value |
|---|---|
| HTTP status | 403 Forbidden |
| Response | Cloudflare challenge page ("Just a moment...") |
| Error code | `UPSTREAM_FORBIDDEN` |
| Circuit breaker | `CIRCUIT_BREAKER_TRIPPED` |
| haltScraper | false (retryable) |

**Endpoint**: `sco.ca.gov/boe_tax_sales.html`

**Assessment**: The SCO website is behind Cloudflare bot protection. The adapter
correctly fails closed — no records ingested, circuit breaker trips, error
recorded. This is the designed behavior. Live canaries will continue to fail
until the page is reachable without a challenge (or until we have a legitimate
access path). The adapter is built to the published directory contract and
fixture HTML; it will work once access is resolved.

---

## Next steps for promotion (Migration 014)

Each source needs **two distinct clean durable canary runs** through the
discovery worker with PostgreSQL before promotion:

```powershell
# Requires DATABASE_URL and DISCOVERY_MODE=advanced
$env:SCRAPER_BACKGROUND_ENABLED='0'
node --env-file=.cache/discovery-runtime/test.env scripts/discovery-worker.js --canary fl-dor-cadastral --once
node --env-file=.cache/discovery-runtime/test.env scripts/discovery-worker.js --canary fl-dor-cadastral --once
# Repeat for courtlistener
```

Gate-clean criteria per run:
- Sole requested source
- Zero source/observation errors
- Accepted ≥ 1 record, rejected = 0
- `complete=true`, `fullSweepComplete=true`, `truncated=false`
- Exact acquisition scope persisted
- Terminal checkpoint empty with matching scope hash

CA Controller cannot be promoted until Cloudflare access is resolved.
