# Release gate snapshot — 2026-10-18 (tree `ea00285`)

> Committed evidence for PP-05. The live per-run ledger
> (`reports/release-gate-ledger.json`) is gitignored by PP-02 convention and is
> regenerated on every gate run; this snapshot preserves the source-bound
> result. No release has happened yet — this is a pre-deploy verification
> record, superseding the earlier snapshot for tree `927e8ca`.

## Source-bound gate (PP-02): 9/9 PASS, clean tree

Tree: `ea002857d6a1c2eb2f0b50bb2c44d05e1ff2f1a2` — dirty: false — 2026-10-18

| Gate | Result | ms |
|---|---|---|
| typecheck (`tsc --noEmit`) | PASS | 4203 |
| generated-context (CONTEXT.md current) | PASS | 134 |
| schema-mirrors (byte-identical) | PASS | 97 |
| test-wiring (every test file reachable) | PASS | 134 |
| ops-suites (meta/wiring/contract) | PASS | 20908 |
| scraper-parser (pinned runtime) | PASS | 3372 |
| production-smoke | PASS | 105 |
| next-build (production bundle) | PASS | 18887 |
| production-e2e (25 checks, isolated embedded DB) | PASS | 19246 |

## Why this tree was created & what it resolved

Following a rigorous end-to-end audit, multi-agent swarm verification, and crawler tooling audit:

1. **Unbrowse Crawler Tooling & Consent Hardening (`scripts/crawler-tools-unbrowse.cjs`)**:
   - Fixed `inspectInstallation()` logic bug where `setupReady` returned `tosAccepted` without confirming `installed`. Updated to `Boolean(installed && tosAccepted)`.
   - Verified globally installed Unbrowse v11.4.1 runtime and executable wrapper (`bin/unbrowse-wrapper.mjs`) alongside local workspace consent (`.cache/crawler-tools/unbrowse/config.json`).
   - Verified `node scripts/crawler-tools-unbrowse.cjs doctor` returns `installed: true, setupReady: true, tosAccepted: true`, and all 35 tests pass in `test/crawler-tools-unbrowse.test.js` and `test/unbrowse-http.test.js`.

2. **Swarm Multi-Agent Capability Graph Alignment (`scripts/swarm/executor.js`)**:
   - Expanded the swarm executor allowlist to cover `compute_deal_score` (`test/score-bands.test.mjs`), `enrich_public_records` (`test/public-records.test.js`), and `evaluate_opportunity_signals` (`test/signals.test.js`).
   - Ran all 6 swarm execution strategies (`testing`, `analysis`, `research`, `maintenance`, `canary`, `optimization`) in real execution mode across 9 agent personas (`coordinator`, `developer`, `researcher`, `analyzer`, `tester`, `reviewer`, `documenter`, `monitor`, `specialist`) — **46/46 tasks passed** with zero failures.

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
