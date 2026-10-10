# Release gate snapshot — 2026-10-10 (tree `d470b20`)

> Committed evidence for PP-05. The live per-run ledger
> (`reports/release-gate-ledger.json`) is gitignored by PP-02 convention and is
> regenerated on every gate run; this snapshot preserves the source-bound
> result the deploy pipeline will ship. No release has happened yet — this is
> the pre-deploy verification record.

## Source-bound gate (PP-02): 9/9 PASS, clean tree

Tree: `d470b20940bf8486fe5e4d34df81a23010b3b24e` — dirty: false — 2026-10-10T11:41:29Z

| Gate | Result | ms |
|---|---|---|
| typecheck (`tsc --noEmit`) | PASS | 2318 |
| generated-context (CONTEXT.md current) | PASS | 178 |
| schema-mirrors (byte-identical) | PASS | 47 |
| test-wiring (every test file reachable) | PASS | 152 |
| ops-suites (meta/wiring/contract) | PASS | 8268 |
| scraper-parser (pinned runtime) | PASS | 3101 |
| production-smoke | PASS | 115 |
| next-build (production bundle) | PASS | 15496 |
| production-e2e (25 checks, isolated embedded DB) | PASS | 25663 |

## Full verification battery the same day (2026-10-10)

- Full verifier `npm test`, default config: **50/50 suites**, 18 PG-gated
  skips reported honestly.
- Full verifier with a real PostgreSQL server configured
  (`DISCOVERY_TEST_DATABASE_URL` → loopback PostGIS 16, provisioned via
  `npm run discovery:local -- up`): **50/50 suites**, 17 of the 18 gated tests
  executing (the 18th is the optional-live-endpoint test, gated on a live
  endpoint, not a database).
- `test:db` **78/78** including the live PG round-trip; `test:discovery`
  **86/86** including row-lock job-ownership fencing; `test:discovery:operations`
  **102/102**; `discovery:soak` complete with zero failures on its own
  ephemeral schema.
- `test:production-e2e:db` **24/24** with `dataMode=postgres
  documentReviewStore=postgres` through the full production stack.
- Backup/restore on the real persistence layer: `db:seed` 2091 listings →
  `pg_dump` 6.3 MB → `DROP DATABASE` → restore → **2091 listings / 35 tables**
  → `test:db` 78/78 against the restored store.
- Production CSP over a real TLS boot (self-signed terminator,
  `x-forwarded-proto: https` — the same header a Render/Koyeb edge sends):
  `script-src 'self' 'nonce-…' 'strict-dynamic'` with no `unsafe-inline`;
  `upgrade-insecure-requests` present over HTTPS and absent over HTTP.

## Fixed in this verification pass (all covered by the suites above)

1. `type`/`program` facets did not fold blank strings into the `unknown`
   sentinel while the filter did (`server/discovery/query.js` — both sides now
   name the same `nullif(...,'')` literal).
2. `test/discovery-documents-pg-parity.test.js` built its fixture against
   `public` on a shared server (FK-blocked drop, latent data-destruction
   hazard) — now an ephemeral scratch schema.
3. Seeder split-brain regression (`scripts/seed-from-v0.js`): listing writes
   went through the singleton client (`.env.local` `PROPERTY_DB=embedded`
   routing) while sources committed to `DATABASE_URL` — now bound to the open
   transaction client.
4. Two guard tests hardcoded the no-database expectation without scrubbing the
   full env chain — fixed to pass in both configurations.

## What this snapshot does not claim

- No public deployment exists. "Production HTTPS CSP on the live host",
  "production persistence on the deployed instance" and the PP-05 release
  claim itself remain blocked on the interactive deploy step (Render Blueprint
  + `RENDER_DEPLOY_HOOK_URL` / `DEPLOY_SMOKE_URL` repo secrets; the deploy
  workflow is wired and no-ops cleanly until then).
- The Google Maps key restriction is not applied: the key's GCP project is not
  among the six projects administrable from this machine's two authenticated
  gcloud accounts (re-checked 2026-10-10).
- Legal review of `/privacy` `/terms` has not happened.
