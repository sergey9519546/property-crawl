# Release gate snapshot — 2026-10-16 (tree `edc580b`)

> Committed evidence for PP-05. The live per-run ledger
> (`reports/release-gate-ledger.json`) is gitignored by PP-02 convention and is
> regenerated on every gate run; this snapshot preserves the source-bound
> result. No release has happened yet — this is a pre-deploy verification
> record, superseding the earlier snapshot for tree `20cf0cf`.

## Source-bound gate (PP-02): 9/9 PASS, clean tree

Tree: `edc580bb8ca97c5f5f6950bd0a14accd68a9d2c9` — dirty: false — 2026-10-16

| Gate | Result | ms |
|---|---|---|
| typecheck (`tsc --noEmit`) | PASS | 2124 |
| generated-context (CONTEXT.md current) | PASS | 118 |
| schema-mirrors (byte-identical) | PASS | 47 |
| test-wiring (every test file reachable) | PASS | 97 |
| ops-suites (meta/wiring/contract) | PASS | 4193 |
| scraper-parser (pinned runtime) | PASS | 2427 |
| production-smoke | PASS | 91 |
| next-build (production bundle) | PASS | 7342 |
| production-e2e (25 checks, isolated embedded DB) | PASS | 17383 |

## Why this tree was created & what it resolved

Following an exhaustive end-to-end audit of all pages, components, and user workflows:

1. **Dynamic Data Binding in Storyteller (`src/components/site/storyteller.tsx`)**:
   - *Stage 3 (Underwrite)*: Previously, `assumed`, `repairs`, `carry`, and `profit` defaulted to `0`, causing the panel to display "Not entered", empty progress bars, and `—` for Bid Ceiling on initial inspection. Now automatically initializes conservative baseline underwriting assumptions whenever an active `openingBid` is present (`assumed = round(1.5 * opening)`, `repairs = round(0.15 * opening)`, `carry = round(0.05 * opening)`, `profit = round(0.15 * opening)`), with dynamic slider ranges that scale to property value.
   - *Stage 4 (Act)*: Previously had `<MemoMetric label="Bid ceiling" value="—" />` hardcoded. Now synchronizes `modeledCeiling` across `PublishedListingContext` so that user adjustments in the Underwrite stage or the computed walk-away number dynamically flow directly into the Act stage's Acquisition Review memo.

2. **Previous Improvements Retained**:
   - Working Dual-Mode Watchlist Storage (`src/components/listings/listing-watchlist-toggle.tsx`, `src/components/listings/discovery-workbench.tsx`).
   - Verified Record Bindings in Second Look Showcase (`src/components/site/second-look-showcase.tsx`).
   - Mega-Menu Deep Routing (`src/components/site/site-header.tsx`).
   - Interactive Underwriting Walkthrough Simulator (`src/components/site/video-modal.tsx`).

## What this snapshot does not claim

- The full verifier (`npm test`) and the real-PostgreSQL battery were **not**
  re-run on this tree; their last recorded results are the 2026-10-10 ones in
  the prior snapshot.
- No public deployment exists. Live-host HTTPS CSP, deployed-instance
  persistence and the PP-05 release claim remain blocked on the deploy step
  (`RENDER_DEPLOY_HOOK_URL` / `DEPLOY_SMOKE_URL` repo secrets).
- Google Maps key restriction, custom domain DNS, and legal review of `/privacy` `/terms`
  remain blocked on external owners.
