# Release gate snapshot — 2026-10-21 trust unit (tree `c6e4f08`)

> Committed evidence for PP-05, superseding `release-gate-snapshot-2026-10-21.md`
> (tree `2c99e62`). The live per-run ledger (`reports/release-gate-ledger.json`)
> is gitignored by PP-02 convention and regenerated on every gate run; this
> snapshot preserves the source-bound result for the trust unit.

## Source-bound gate (PP-02): 9/9 PASS, clean tree

Tree: `c6e4f084e79a3729d6b788e43e9867cdaa77d9be` — dirty: false — 2026-10-21

| Gate | Result | ms |
|---|---|---|
| typecheck (`tsc --noEmit`) | PASS | 10324 |
| generated-context (CONTEXT.md current) | PASS | 133 |
| schema-mirrors (byte-identical) | PASS | 58 |
| test-wiring (every test file reachable) | PASS | 117 |
| ops-suites (meta/wiring/contract) | PASS | 12304 |
| scraper-parser (pinned runtime) | PASS | 3085 |
| production-smoke | PASS | 157 |
| next-build (production bundle) | PASS | 26569 |
| production-e2e (25 checks, isolated embedded DB) | PASS | 17146 |

## Suite evidence at this tree

| Suite | Result |
|---|---|
| `npm run test:db` | 135/135 pass |
| `npm run test:discovery` | 74 pass / 16 environment-skipped / 0 fail |
| `npm run test:intelligence` | 633/633 pass |
| `npm run test:evidence-truth` | 598/598 pass |
| `npm run test:ops` | 226/226 pass (context digest, test-wiring, doc-honesty guards) |
| `npm run test:signals` | 24/24 pass |
| `npm run test:enrichment-intelligence` | 49/49 pass |
| `node --test test/listing-serving-gate.test.js` | 11/11 pass |
| `node --test test/fl-dor-cadastral.test.js` | 16/16 pass |

## What this tree resolved

1. **Listing admission gate (class-level).** A court docket filing or a cadastral
   parcel is not a sale listing, and the catalog already said so
   (`status: 'DISCOVERY_ONLY'`) — but nothing enforced it, and 221 records
   (120 `courtlistener` docket filings, 101 `fl-dor-cadastral` parcels) were served
   as actionable listings across `/api/listings`, detail pages, state/county pages,
   hunts, saved-search alerts, and the SEO sitemap. `servesListings()` /
   `isDiscoveryOnlySource()` (`server/sources/catalog.js`) are now enforced at the
   scheduler run selection, the discovery query (`matches()` and the parameter-free
   `pgWhere()` allow-list), both `getListings` branches, and the single-listing 404.
   The gate also refuses uncataloged source keys (e.g. `public-notices-email`), so
   the other registered DISCOVERY_ONLY adapters (`ca-controller-tax-sale`,
   `hud-usps-vacancy`) cannot repeat the incident.
   **Non-destructive:** all 221 records remain in `.cache/live-listings.json` and
   PostgreSQL, and remain visible on the `/sources` Source Radar evidence surfaces.
   Promotion remains a catalog status flip.
2. **Decision-packet fail-closed.** `server/routes/decision-packet.js` previously
   granted role `operator` to any unrecognized credential when no operator token was
   configured. It now fails closed with 503 when the token is unset, mirroring
   hunts/document-review/enrichment; no other route shared the fail-open shape
   (`extractRoleFromToken(..., {allowNull:true})` had exactly one caller).
3. **FL-DOR county attribution.** All 101 stored records carried `county="Collier"`
   while every situs city was in Alachua County: the published layer's `CO_NO`
   encoding is a dataset-specific namespace, not the FDOR tax-admin 1–67 code list
   (documented in `docs/alachua-pilot.md` and the header of
   `server/scrapers/fl-dor-cadastral.js`). County now resolves from the record's own
   situs evidence (census-block FIPS prefix, then a scoped situs-city cross-check)
   with code-vs-situs disagreements resolved to situs and counted. Test-pinned
   against the official 67-county list.
4. **Documentation corrections.** `memory/facts.md` (8 signals / 6 weighted
   components, 0–99 clamp, no silent in-memory fallback, 50 scraper modules, seed
   2130, refreshed residual list), `AGENTS.md` (boot paragraph and the 16-type
   property list), the `deal-scoring` skill (eight signals, 0–99, bands cross-ref),
   and the `COMPLETION_CHECKLIST` facts table (evaluator, admission gate,
   decision-packet rows). The 2026-10-21 snapshot's title/body tree mismatch was
   fixed.
5. **Test wiring.** Two orphan test files created by the observation-store cutover
   (`test/db/embedded-pg-boot.test.js`, `test/db/auction-calendar-native.test.js`)
   are now reachable from `test:db`, satisfying the test-wiring gate.

## Production deployment and the migration-ledger incident (2026-10-22)

Pushed and deployed: `064a695` → `c6e4f08` (trust unit) → `9b98fd1` (docs) →
`d197a1d` (migration-ledger fix). The live service runs `d197a1d`.

**Incident.** The first deploy of the trust unit brought code referencing
`listings.triage_priority` and `source_observations` while production's database
had neither: `/api/listings` returned `column "triage_priority" does not exist`
and health reported `relation "source_observations" does not exist`. Root cause
(VERIFIED): the live Render service was created without `AUTO_MIGRATE` (the key
exists in `render.yaml` but was never synced to the running service), so
auto-migration had never run; and once `AUTO_MIGRATE=1` was set, migration
`024_materialized_views_and_spatial.sql` blocked everything after it — the file
was edited in place after production had applied it (`0f9bcc8`, `51e034c`), and
the migrator threw on the digest mismatch, aborting the run before 025-027.
Resolution: `AUTO_MIGRATE=1` set on the service, and the migrator now re-records
a drifted digest and continues (`d197a1d`, guard tests
`test/db/migration-ledger-drift.test.js`). Both exposures lasted ~40 minutes; the
public listing endpoint was erroring during that window.

**Verified after the fix** (2026-10-22): `/api/health` → `dataMode=postgres`,
`observationStore=postgres`, no store error; `GET /api/listings` returns listings;
`GET /api/listings?source=courtlistener` → `total=0`;
`GET /api/listings?source=fl-dor-cadastral` → `total=0`;
`GET /api/listings?source=servicelink` → `total=7498` (positive control intact).

**Open landmine — do not sync the Render blueprint to the live service as-is.**
`render.yaml` declares `PROPERTY_DB: embedded`, and the boot path uses the
embedded engine *instead of* `DATABASE_URL` whenever that variable is set
(`server/server.js:395`, `scripts/discovery-migrate.js:32`). The live service
correctly has no `PROPERTY_DB` and uses external PostgreSQL. A blueprint sync
would set it, make production serve an empty embedded database, and ignore the
real one. `PROPERTY_DB`/`AUTO_MIGRATE` divergence between `render.yaml` and the
live service is a decision for the owner, not a unilateral edit.

## Not resolved by this tree (recorded so the next session starts from evidence)

- **Valuation input at scale.** The bid-to-value ratio component (30% of
  `triagePriority`) still resolves for ~0 of the live inventory; the measured
  actionable distribution remains flat (2,017 listings at 20, 58 at 30). The
  assessor-roll harvest and the enrolled-county registry are the installed path —
  re-measure the ratio-component resolution after production collection cycles
  (`reports/triage-resolution-baseline-2026-10-21.md`).
- **Stored FL-DOR county labels.** The 101 stored records keep the pre-fix
  `county: "Collier"` value; the serve gate hides them from listings, and the fix
  applies to future scrapes. A backfill was deliberately not performed (non-destructive).
- **Document review queue** now excludes gated records via `getListings` — a
  deliberate consequence of the gate, not a regression of the evidence contract.
- **Scrapy-ingest Postgres path** writes `db.createListing(item)` without the
  `validateListingForIngestion` gate (provenance/fixture checks) and swallows per-item
  failures; the response's `accepted` count comes from a live-store merge that is not
  served in Postgres mode. Not fixed here.
- **Stripe billing** verifies signatures correctly but persists nothing (no receipt,
  fulfillment, or dispute record). Billing remains deliberately non-functional.
- **Zyte SSRF filter** accepts IPv6-mapped IPv4 loopback/private literals
  (`https://[::ffff:127.0.0.1]/`). Impact is bounded and there are currently zero
  production callers.
