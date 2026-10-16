# Release gate snapshot — 2026-10-16 (tree `a58b544`)

> Committed evidence for PP-05. The live per-run ledger
> (`reports/release-gate-ledger.json`) is gitignored by PP-02 convention and is
> regenerated on every gate run; this snapshot preserves the source-bound
> result. No release has happened yet — this is a pre-deploy verification
> record, superseding `release-gate-snapshot-2026-10-15.md` (tree `f7c413c`).

## Source-bound gate (PP-02): 9/9 PASS, clean tree

Tree: `a58b544fbb701c561409693a0758c8eb3184d928` — dirty: false — 2026-10-16

| Gate | Result | ms |
|---|---|---|
| typecheck (`tsc --noEmit`) | PASS | 9073 |
| generated-context (CONTEXT.md current) | PASS | 295 |
| schema-mirrors (byte-identical) | PASS | 161 |
| test-wiring (every test file reachable) | PASS | 268 |
| ops-suites (meta/wiring/contract) | PASS | 27385 |
| scraper-parser (pinned runtime) | PASS | 13037 |
| production-smoke | PASS | 311 |
| next-build (production bundle) | PASS | 49427 |
| production-e2e (25 checks, isolated embedded DB) | PASS | 34413 |

## Why this tree was created & what it resolved

Following the comprehensive component audit, skills verification, and invariant alignment:

1. **Deal Score Formula & Taxonomy Alignment**: `src/components/site/fastest-way.tsx` had inverted ratio logic and ad-hoc tier labels. Realigned to canonical formula `Math.round((1 - ratio) * 130)` clamped 1–99, importing authoritative `bandForScore` / `SCORE_BANDS` (`Elite`, `Strong`, `Fair`, `Thin`) from `@/lib/score-bands`.
2. **Elimination of Mock Listing IDs**: `src/components/site/second-look-showcase.tsx` previously hardcoded non-existent IDs (`fannie-12345`, `USDA-MS-6274`, `HUD-GA-450`). Cleaned to null listing IDs with truthful cadastral and statutory audit context until live records bind.
3. **Nationwide Inventory Copy Honesty**: `src/components/site/hero.tsx` previously claimed 10,011 records. Replaced with truthful "2,100+ public records in nationwide database" matching authoritative seed count (2,130).
4. **Source Promotion Copy Alignment**: `src/app/[slug]/page.tsx` previously described IRS and GSA as promoted official collectors. Realigned with project policy: Treasury, USDA, and HUD (OH/NJ) are promoted; GSA and IRS remain unpromoted per policy limits.
5. **Cross-Platform CRLF Frontmatter Parser**: In `scripts/gen-skills-index.js`, frontmatter regex `/^---\n/` and line splitting on `\n` failed on Windows CRLF (`\r\n`), leaving skill index descriptions empty. Upgraded to handle both CRLF and LF, regenerating `.agents/skills-index.json` with full descriptions, domains, and trigger keywords.
6. **Agent Manager Working Tree Cleanliness**: Pruned retired worktree entry from `.kilo/agent-manager.json` to ensure clean working tree status across runs.

## What this snapshot does not claim

- The full verifier (`npm test`) and the real-PostgreSQL battery were **not**
  re-run on this tree; their last recorded results are the 2026-10-10 ones in
  the prior snapshot.
- No public deployment exists. Live-host HTTPS CSP, deployed-instance
  persistence and the PP-05 release claim remain blocked on the deploy step
  (`RENDER_DEPLOY_HOOK_URL` / `DEPLOY_SMOKE_URL` repo secrets).
- Google Maps key restriction, custom domain DNS, and legal review of `/privacy` `/terms`
  remain blocked on external owners.
