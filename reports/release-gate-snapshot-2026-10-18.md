# Release gate snapshot — 2026-10-18 (tree `927e8ca`)

> Committed evidence for PP-05. The live per-run ledger
> (`reports/release-gate-ledger.json`) is gitignored by PP-02 convention and is
> regenerated on every gate run; this snapshot preserves the source-bound
> result. No release has happened yet — this is a pre-deploy verification
> record, superseding the earlier snapshot for tree `edc580b`.

## Source-bound gate (PP-02): 9/9 PASS, clean tree

Tree: `927e8caa134289bd9cd426abd7663b54a6d7549e` — dirty: false — 2026-10-18

| Gate | Result | ms |
|---|---|---|
| typecheck (`tsc --noEmit`) | PASS | 2408 |
| generated-context (CONTEXT.md current) | PASS | 124 |
| schema-mirrors (byte-identical) | PASS | 49 |
| test-wiring (every test file reachable) | PASS | 104 |
| ops-suites (meta/wiring/contract) | PASS | 5364 |
| scraper-parser (pinned runtime) | PASS | 2988 |
| production-smoke | PASS | 116 |
| next-build (production bundle) | PASS | 7682 |
| production-e2e (25 checks, isolated embedded DB) | PASS | 18167 |

## Why this tree was created & what it resolved

Following a rigorous end-to-end audit and execution of the Playwright UI suite (`test/run-ui-suite.js`):

1. **Watchlist Honesty Contract Alignment (`src/components/listings/listing-watchlist-toggle.tsx`)**:
   - Re-established the strict separation between local client storage (feed card) and the operator-gated server alert storage (`/api/alerts`).
   - On the property detail page, a signed-out visitor clicking "Save to watchlist" requests operator unlock rather than falsely presenting as saved in browser storage, satisfying the honesty contract and passing `test_detail_mobile_content_and_media_controls_are_not_clipped`.

2. **Accessible Dialog Name Alignment (`src/components/site/video-modal.tsx`)**:
   - Updated the header element (`#walkthrough-title`) of the interactive underwriting walkthrough modal to provide the accessible name "Listing record" along with the descriptive subtitle, ensuring screen readers and Playwright locators (`get_by_role("dialog", name="Listing record")`) cleanly identify the modal in `test_preview_opens_as_an_accessible_escape_closeable_dialog`.

3. **Playwright UI End-to-End Suite**:
   - `test/run-ui-suite.js` completed with exit code 0: 56/56 tests passing in `next_ui_e2e_test.py` and 1/1 passing in `detail_media_recovery_e2e_test.py`.

## What this snapshot does not claim

- The full verifier (`npm test`) and the real-PostgreSQL battery were **not**
  re-run on this tree; their last recorded results are the 2026-10-10 ones in
  the prior snapshot.
- No public deployment exists. Live-host HTTPS CSP, deployed-instance
  persistence and the PP-05 release claim remain blocked on the deploy step
  (`RENDER_DEPLOY_HOOK_URL` / `DEPLOY_SMOKE_URL` repo secrets).
- Google Maps key restriction, custom domain DNS, and legal review of `/privacy` `/terms`
  remain blocked on external owners.
