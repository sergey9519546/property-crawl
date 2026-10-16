# Release gate snapshot — 2026-10-16 (tree `20cf0cf`)

> Committed evidence for PP-05. The live per-run ledger
> (`reports/release-gate-ledger.json`) is gitignored by PP-02 convention and is
> regenerated on every gate run; this snapshot preserves the source-bound
> result. No release has happened yet — this is a pre-deploy verification
> record, superseding the earlier snapshot for tree `a58b544`.

## Source-bound gate (PP-02): 9/9 PASS, clean tree

Tree: `20cf0cf43530417d4fd4375d1bcd5764d8bab82c` — dirty: false — 2026-10-16

| Gate | Result | ms |
|---|---|---|
| typecheck (`tsc --noEmit`) | PASS | 3750 |
| generated-context (CONTEXT.md current) | PASS | 176 |
| schema-mirrors (byte-identical) | PASS | 76 |
| test-wiring (every test file reachable) | PASS | 154 |
| ops-suites (meta/wiring/contract) | PASS | 5754 |
| scraper-parser (pinned runtime) | PASS | 3665 |
| production-smoke | PASS | 129 |
| next-build (production bundle) | PASS | 12065 |
| production-e2e (25 checks, isolated embedded DB) | PASS | 20442 |

## Why this tree was created & what it resolved

Following an exhaustive audit of all pages, components, and marketing promises to eliminate copy pretending to be functionality and replace it with real working features:

1. **Working Dual-Mode Watchlist Storage**:
   - `src/components/listings/listing-watchlist-toggle.tsx`: Previously, unauthenticated public visitors on listing detail pages were blocked by `session.requestUnlock()`, prompting for an operator key when clicking "Save to watchlist". Now uses dual-mode storage: persists to `localStorage` (`perfectproperty:saved-listings`) when unauthenticated, and syncs with `/api/alerts` when authenticated as operator.
   - `src/components/listings/discovery-workbench.tsx`: Added dual-mode `localStorage` reading and updating so bookmarked properties persist across pages. Added an interactive `Watchlist (${saved.size})` view filter toggle to the toolbar with helpful empty state guidance and clear buttons.
2. **Verified Record Bindings in Second Look Showcase**:
   - `src/components/site/second-look-showcase.tsx`: The three demonstration items previously had `listingId: null`, leading to dead ends. Bound each scenario to verified records in `data.js`: Cuyahoga OH sheriff sale (`HUD-412-652610`), Florida cadastral update (`TRSY-27-66-110`), and Texas trustee adjustment (`TRSY-26-66-189`). Now "Inspect property record" and "Reproducible packet" route directly to real listing and research export pages.
3. **Mega-Menu Deep Routing**:
   - `src/components/site/site-header.tsx`: Replaced generic `/listings` and dead anchor links in the Solutions navigation with deep-linked views (`/listings?view=grid&sort=score` for Acquisitions, `/research` for Disposition, `/listings?hasDocuments=true&minQuality=50` for Underwriting, and `/research#dossier` for Capital).
4. **Interactive Underwriting Walkthrough Simulator**:
   - `src/components/site/video-modal.tsx`: Transformed the hero walkthrough modal from a static single-card text container into an interactive 4-stage Underwriting Walkthrough Simulator (Stage 1: Statutory Notice Capture & OCR -> Stage 2: Fine-Print Legal & Docket Extraction -> Stage 3: Title Priority & Redemption Risk -> Stage 4: Cash-to-Close Basis & Triage Verdict). Includes scenario switching across verified properties, interactive stage navigation, and direct inspection links.

## What this snapshot does not claim

- The full verifier (`npm test`) and the real-PostgreSQL battery were **not**
  re-run on this tree; their last recorded results are the 2026-10-10 ones in
  the prior snapshot.
- No public deployment exists. Live-host HTTPS CSP, deployed-instance
  persistence and the PP-05 release claim remain blocked on the deploy step
  (`RENDER_DEPLOY_HOOK_URL` / `DEPLOY_SMOKE_URL` repo secrets).
- Google Maps key restriction, custom domain DNS, and legal review of `/privacy` `/terms`
  remain blocked on external owners.
