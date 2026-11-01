# Recorder qualification and hosted durability — 2026-10-31

Dated implementation/evidence receipt. The active acceptance queue remains in
[`docs/COMPLETION_CHECKLIST.md`](../docs/COMPLETION_CHECKLIST.md).
Readbacks below occurred on 2026-11-01 UTC / 2026-10-31 PDT. Later tracks remain held.

## Recorder results

The [official Harris inquiry](https://www.cclerk.hctx.net/Applications/WebSearch/FRCL_R.aspx)
is a stateful WebForms query, not a listing feed. Its published year/month
controls require a refreshed form state before the requested month is searched.
The old parser expected invented CSS classes and `/details?id=` links.

`server/scrapers/adapters/harris-clerk-query.js` now submits the actual controls,
checks robots through the caller's circuit-breaker transport, retains the query
scope and publisher total, bounds pagination, and refuses stale/repeated pages,
missing state and unverified result shells. Query cookies stay within one query.
`harris-clerk-foreclosure.js` recognizes captured grid document IDs and the
publisher's actual `ViewECdocs.aspx?ID=...` links. Sale/file dates come from
separate published columns; invalid calendar dates remain unknown.

Two final bounded runs used the actual `TrusteeSaleScraper` implementation at
02:17:04 and 02:17:06 UTC. Each run:

- Requested Harris, sale month November 2026, page cap **1**.
- Observed **840** published query results and retained **38** document rows
  with captured links from that page. These are partial query results.
- Fetched the captured `FRCL-2026-5654` link: HTTP **200**,
  `Application/pdf`, valid PDF signature, original binary bytes retained.
- Emitted **0 listings** and reported `outcome=evidence_only`,
  `queryComplete=false`, `listingQualified=false`, `complete=false`.
- Retained the index, parsed references and original PDF in a **40-entry**
  local ledger; restored the archive into a separate new directory and compared
  the complete original PDF bytes plus ledger head.

The scanned two-page PDF has no usable embedded text. The grid supplies no
property address, parcel ID or bid. Document/OCR review and complete scope
qualification remain necessary before listing admission or source promotion.
These two transport/evidence controls are **not two clean listing-promotion
canaries**. The reduced test fixture is labelled as two captured rows from a
partial page, not complete inventory.

| Run | Archive SHA-256 | Restored ledger head |
|---|---|---|
| 1 | `8f729630b4204535ad20bf8279df4c6f233aaf24d050fc14faff9e55b8693fe5` | `d58b71b0f4c6b9f2227b9ff80e5d6bebe253883673cb8a2f2c3c01a477986fd6` |
| 2 | `cbc5a7b2d5adda6cdde1e959e0a82610681e5e0d522de287295422956dac4482` | `63e0ebdc248b36ad7d6a206ac1b3ed1a5c44187b411e6955596c8efeffc15e01` |

Local machine receipts: `.cache/qualify-harris-final.json` and its referenced
capture/archive directories. Nothing was promoted or written into hosted inventory.

**Maricopa remains blocked:** the ordinary crawler's `/robots.txt` request
returned **403**. No identity change, challenge bypass or substitute endpoint
was used. The runtime collector now checks policy before a search and preserves
a failed run as failed. It previously overwrote failed outcomes with `empty`.
The unblocking evidence is a policy-permitted official access path or publisher
authorization followed by a successful robots/access check and captured query
and exact-record controls. A fabricated fixture is not that evidence.

## Actual hosted state

Authenticated Render readbacks established:

- Existing service `srv-dbbc3vgm7kps73eehimg`, Oregon, **free**, one instance,
  native main-branch auto-deploy. No persistent disk was observed/configured.
- Existing database `dpg-dbbc8su7bikc73819uo0-a`, **free**, PostgreSQL **16.15**,
  available, expiry **2026-11-19T01:31:31Z**.
- A TLS-verified **read-only transaction** read **11,382 listings** and
  **0 rows in `discovery_snapshots`**. This is not a count of every other
  historical observation store.
- Latest earlier deploys at `1203730` and `4d63434` were `update_failed`.
  Logs showed the database passing its functional probe and Next reporting
  ready, followed by the orchestrator's UI health timeout and stack shutdown.
- A concurrent session committed/pushed the shared implementation as
  `519d46a3ae35c1a1d21c805d35792f0ed9b2d8cb`. That commit was preserved.
  Render deployment `dep-dbja21vavr4c73bsi3p0` reached **live** at the
  02:20:24 UTC readback. Public `/api/health` returned **200**, `dataMode=postgres`,
  `postgresReachable=true`, and the exact same `release.commit`. Readiness
  returned **200**; the public listing response returned **11,161** admitted
  records (one requested). Anonymous document-review returned **401**. The
  home page returned **200** with a nonce-based CSP header.

The deployed evidence health explicitly reports **ephemeral_filesystem**,
`mountVerified=false`, `backupVerified=false`, zero retained entries at that
readback, and no requirement for a durable mount. Startup/SHA acceptance is
closed for this deploy; persistence and recovery acceptance remain open.

Raw readback metadata is sanitized in `.cache/qualify-blockers-probe.json`,
`.cache/qualify-render-diagnosis.json` and `.cache/qualify-hosted-latest.json`.
API/database credentials were neither printed nor committed.

Render documents that [free services have ephemeral storage and free Postgres
expires](https://render.com/docs/free). A [persistent disk requires a paid
service](https://render.com/docs/disks). A configured directory alone cannot
close this blocker.

## Implemented durability/startup preparation

- Production health probes allow a slow cold proxy request to complete within
  a bounded 120-second overall deadline, rather than repeatedly cancelling at
  1.5 seconds. HTTP/connection failures still fail closed.
- The two-process orchestrator defers its first expensive ingestion cycle by
  90 seconds. Direct-server boot delay remains configurable and bounded.
- `/api/health.release.commit` reports a valid injected 40-character release
  SHA or null, enabling deployed-SHA readback.
- `server/discovery/evidence-storage.js` verifies the actual Linux mount table,
  path containment and resolved paths. Overlay/tmpfs/ramfs mounts cannot certify
  persistence. When `PROPERTY_REQUIRE_DURABLE_EVIDENCE=1`, absent/unverified
  storage blocks boot and evidence writes. Health distinguishes ephemeral,
  local and observed mounted storage, and always leaves `backupVerified=false`
  unless separate recovery evidence exists.
- `scripts/evidence-backup.js` captures a writer-locked, chain-verified archive
  of every referenced immutable raw/Markdown file. It verifies digests and
  ledger head, refuses corrupt/missing/extra/unsafe files and archive overwrite,
  and restores only into a newly reserved isolated directory. It never restores
  over a live store. Interrupted restores leave their new directory for review.
- [`ops/render-durability-plan.json`](../ops/render-durability-plan.json)
  contains the exact existing resource IDs, API requests and environment changes:
  Starter web service, `basic_256mb` database, 1 GB disk at `/app/.cache`, durable
  evidence guard, pinned deployment, restart/readback and off-host restore checks.
  Plan enums were checked against the current official Render OpenAPI schema.
  The proposed base compute/storage approval cap is **$20/month**; metered usage
  is separate and the current quote must fit before any paid mutation.

**No paid hosting change has been applied by this pass.** The plan preserves
database contents and all operator/session credentials. No workspace pricing
upgrade, disk autoscaling, source promotion or later-track implementation is
included. Hosted redeploy survival and disaster recovery are still unaccepted.

## Database backup approval boundary

Official PostgreSQL 16.15 client binaries were downloaded into the workspace
cache, without installing a service. The prepared export uses `pg_dump` custom
format against a shared repeatable-read snapshot, TLS identity verification,
private ignored `.secrets/hosted-backups/`, SHA-256, and `pg_restore` readback.
A successful archive read is not a successful restore into another database.

Automatic approval review **rejected the full database export** because the
user had not explicitly authorized the potentially sensitive full database
payload and local destination. The export was not executed, and no workaround
was attempted. Explicit approval for that payload/destination is pending.
The production data must not be used as the destructive acceptance-test target.

A later read-only privilege check established `rolcreatedb=true`. A separate
brand-new database can therefore host acceptance tests on the existing instance
without a paid resource or any copied production rows. The test wrapper records
its random database name and removes only that exact test database after the
run. It never sets the production database as the test target. This does not
authorize or perform the rejected full database export.

## Verification

- Full verifier: **50/50 suites**, zero failures; **18** external-PostgreSQL
  tests remain skipped (16 backend, 2 operations).
- Recorder/hosted-durability controls plus adapter controls: **22/22**.
- Meta guards: **177/177**, zero skipped.
- Explicit remainder coverage runner: **2006/2006**, zero skipped; three older
  Python files are surfaced as not executed by this runner.
- Release gate: **9/9**, clean/source-bound to `519d46a3ae35c1a1d21c805d35792f0ed9b2d8cb`,
  including the production build and 25-check embedded-database full-stack E2E.
  These release checks do not substitute for the skipped external database tests.

Receipts: `.cache/qualify-full-verification.log`, `.cache/qualify-controls.log`,
`.cache/qualify-meta.log`, `.cache/qualify-coverage.log`, `.cache/qualify-release.log`,
and `reports/release-gate-ledger.json`. Documentation changes after that release
receipt are checked separately. Final completion/documentation gate outcomes
are appended after execution.
