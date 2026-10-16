# Release gate snapshot — 2026-10-15 (tree `f7c413c`)

> Committed evidence for PP-05. The live per-run ledger
> (`reports/release-gate-ledger.json`) is gitignored by PP-02 convention and is
> regenerated on every gate run; this snapshot preserves the source-bound
> result. No release has happened yet — this is a pre-deploy verification
> record, superseding `release-gate-snapshot-2026-10-14.md` (tree `dc2e545`).

## Source-bound gate (PP-02): 9/9 PASS, clean tree

Tree: `f7c413c93ee4d70008996546401352e0b158a887` — dirty: false — 2026-10-15

| Gate | Result | ms |
|---|---|---|
| typecheck (`tsc --noEmit`) | PASS | 2116 |
| generated-context (CONTEXT.md current) | PASS | 133 |
| schema-mirrors (byte-identical) | PASS | 73 |
| test-wiring (every test file reachable) | PASS | 120 |
| ops-suites (meta/wiring/contract) | PASS | 8275 |
| scraper-parser (pinned runtime) | PASS | 3548 |
| production-smoke | PASS | 133 |
| next-build (production bundle) | PASS | 8501 |
| production-e2e (25 checks, isolated embedded DB) | PASS | 18906 |

## Why this tree was created & what it resolved

Following the full codebase TODO audit and verification loop:

1. **Discovery Calendar Type Error**: `src/components/listings/discovery-workbench.tsx` accessed `.total` on `AuctionCalendarResponse`. The API server emits `{ weeks, dropped, scanned, ... }` without a top-level `total`. Added `calendarDatedTotal()` to `src/lib/intelligence-client.ts` to derive the dated count from weeks without runtime or type failures.
2. **Dynamic Route Orphan Detection**: `scripts/inventory.js` collapsed route segments starting with `[` into empty strings, flagging valid nested dynamic routes like `/api/listings/[id]/assessor` as orphaned. Upgraded the regex generation to replace `[...]` with `[^/`]+`.
3. **Detail Media Pre-Consent Street View Filter**: `test/detail_media_recovery_e2e_test.py` tested pre-consent Street View dormancy by checking all requests to `/api/property-image`, which falsely collided with concurrent Panoramax alternatives. Scoped dormancy assertions specifically to Street View modes (`mode=walkthrough|image|metadata`) and added `.first` on the status selector.
4. **Deferred Atlas Map Mount Timing**: `test/next_ui_e2e_test.py` had a flaky 15-second timeout waiting for `#storyteller-deal-map` canvas due to raw DOM scrolling failing to trigger the `DeferredOpportunityAtlas` IntersectionObserver. Switched to `self.reveal_deferred_atlas()`.
5. **Interactive Terminal Alert Auth**: Documented in `docs/COMPLETION_CHECKLIST.md` that `/api/alerts/matches` badge polling now gates on `authenticated === true`.

## What this snapshot does not claim

- The full verifier (`npm test`) and the real-PostgreSQL battery were **not**
  re-run on this tree; their last recorded results are the 2026-10-10 ones in
  the prior snapshot.
- No public deployment exists. Live-host HTTPS CSP, deployed-instance
  persistence and the PP-05 release claim remain blocked on the deploy step
  (`RENDER_DEPLOY_HOOK_URL` / `DEPLOY_SMOKE_URL` repo secrets).
- Google Maps key restriction, custom domain DNS, and legal review of `/privacy` `/terms`
  remain blocked on external owners.
