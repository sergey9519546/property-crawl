# Release gate snapshot — 2026-10-14 (tree `dc2e545`)

> Committed evidence for PP-05. The live per-run ledger
> (`reports/release-gate-ledger.json`) is gitignored by PP-02 convention and is
> regenerated on every gate run; this snapshot preserves the source-bound
> result. No release has happened yet — this is a pre-deploy verification
> record, superseding `release-gate-snapshot-2026-10-10.md` (tree `d470b20`).

## Source-bound gate (PP-02): 9/9 PASS, clean tree

Tree: `dc2e54539cf94f925e73341e8158cc30add3e183` — dirty: false — 2026-10-14

| Gate | Result | ms |
|---|---|---|
| typecheck (`tsc --noEmit`) | PASS | 2373 |
| generated-context (CONTEXT.md current) | PASS | 140 |
| schema-mirrors (byte-identical) | PASS | 109 |
| test-wiring (every test file reachable) | PASS | 128 |
| ops-suites (meta/wiring/contract) | PASS | 8115 |
| scraper-parser (pinned runtime) | PASS | 9921 |
| production-smoke | PASS | 442 |
| next-build (production bundle) | PASS | 52654 |
| production-e2e (25 checks, isolated embedded DB) | PASS | 27881 |

## Why the gate was red before this tree

Between `d470b20` and `59a0991` two regressions landed, and the gate caught both:

1. `373e0d1` added `test/compare-selection.test.js`,
   `test/db/canonical-status.test.js` and `test/listing-status.test.mjs`
   without wiring them into any runner — `test-wiring` and `ops-suites`
   failed. They are now in `test:intelligence`, `test:db` and
   `test:source-integrity` respectively (each passed in isolation, 8/8,
   before wiring).
2. The scheduled scraper refresh `77c9045` raised the `data.js` seed from
   2091 to 2130 listings; the hand-cited checklist count drifted and
   `test/docs-checklist-honesty.test.js` failed. Transcribed from
   `gen-context` and `CONTEXT.md` regenerated.

## What this snapshot does not claim

- The full verifier (`npm test`) and the real-PostgreSQL battery were **not**
  re-run on this tree; their last recorded results are the 2026-10-10 ones in
  the prior snapshot.
- No public deployment exists. Live-host HTTPS CSP, deployed-instance
  persistence and the PP-05 release claim remain blocked on the deploy step
  (`RENDER_DEPLOY_HOOK_URL` / `DEPLOY_SMOKE_URL` repo secrets).
- Google Maps key restriction and legal review of `/privacy` `/terms` are
  unchanged: not done.
