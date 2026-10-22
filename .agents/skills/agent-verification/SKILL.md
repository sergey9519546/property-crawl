---
name: agent-verification
description: |
  Proportional verification gate, evidence-cited completion, control-test discipline,
  and drift detection for the property-crawl agent system. Use this when the agent
  must verify its own output before claiming completion.
license: MIT
metadata:
  version: v2
  domain: agent-system
---

# Agent Verification Skill

Use this skill when verifying any code, schema, scraper, UI, or agent-system change before claiming completion.

## Blueprint Verification Principles & Derived Heuristics

1. **Evidence-First, Control-Tested Completion (`docs/COMPLETION_CHECKLIST.md`)**:
   - Never claim a bug is fixed or a feature works based on static inspection or index-only checks. Every change must be verified against runtime behavior and a control test (e.g., testing both positive and negative cases, verifying stripped vs unstripped API payloads, verifying public `GET` vs operator-gated `POST` routes).
   - If a blocker is encountered, diagnose the root cause first:
     - If solvable within repo scope ($0 added spend, no paid CI, license-compatible, robots/ToS-compliant), implement and test the direct fix.
     - If genuinely blocked by an external system outside repo control (e.g., `realestatesales.gov/robots.txt`, live county WAF/CAPTCHA, operator deployment credentials), fail closed, complete all unblocked work, and document the exact external blocker and minimal unblocking action.

2. **Proportional Verification Gate (`scripts/verify-gate.js`)**:
   `scripts/verify-gate.js` classifies changes by blast radius and runs the proportionate suite:

| Change type | Detection | Gate suites | Max duration |
|---|---|---|---|
| `trivial` | docs, README, standalone test files | `test/suite.test.js` (fast unit) | 5s |
| `scraper` | `server/scrapers/*`, `server/ai/*`, `test/scrapers*` | module-load + scrapers + unit + telemetry + list-payload/underwriting-truth | 60s |
| `schema` | `data.js`, `server/db/*`, `CONTEXT.md`, `package.json` | sync + context drift + db contract | 15s |
| `runtime` | `server/*`, `src/*`, `index.html`, `app.js`, deploy files | module-load + server + unit + hardening + list-payload/underwriting-truth | 60s |
| `agent` | `.kilo/*`, `.agents/*`, `memory/*`, `scripts/hooks/*`, `scripts/verify-gate.js` | agent-system + commands + agents + capability-graph + skills-index + context drift | 30s |
| `full` | pre-merge or fallback when `git` is unavailable | full `test/verify.js` | 30min |

3. **Cross-Layer & Release Gate Discipline**:
   - When a change spans multiple categories (e.g., `agent` + `runtime` + `scraper`), `classifyChange` picks the highest-precedence category (`agent > schema > scraper > runtime > trivial`). Therefore, before finalizing any multi-layer change, explicitly run:
     - `npm run test:meta-guards` (verifies `list-response-payload.test.mjs`, `underwriting-truth.test.mjs`, `verify-gate-classify.test.js`, `verify-test-coverage-guard.test.js`, `release-gate.test.js`)
     - `node scripts/verify-test-coverage.js` (executes every unreferenced test file in `test/`)
     - `npm run release:gate` (runs all 9 release gates end-to-end including `next-build` and `production-e2e`)

4. **Critical Working-Method Guards (Learned from Real Regressions)**:
   - **Grid-Mounted Component Payload Guard (`test/list-response-payload.test.mjs`)**: `GET /api/listings` strips `raw`, `provenance.sourceFields`, and `provenance.statusHistory` from grid items. Never reference `listing.raw` in `src/components/terminal/bidding-simulator.tsx`, `src/components/listings/discovery-card.tsx`, or any grid-mounted component.
   - **CRLF Edit Target Guard**: Several files on Windows (`server/intelligence/dossier.js`, `server/intelligence/signals.js`, `server/scrapers/normalization.js`, `server/routes/listings.js`, `src/components/listings/property-intelligence.tsx`, `src/components/research/research-case.tsx`, `AGENTS.md`) use CRLF (`\r\n`) line endings. When using `edit_file` on CRLF files, always use single-line `Target` strings or `write_file` with `Overwrite: true` so multi-line LF targets do not fail to match.

## Evidence-Cited Completion

On finishing any task, emit a machine-readable completion block via `npm run verify:gate`:

```
=== COMPLETION GATE ===
Change type: runtime
Gate: module load + server + unit + hardening
Files changed: 4
Suites run: 5
All passed: true

Evidence:
  node scripts/verify-module-load.js --changed: PASS (exit 0, 180ms)
  node test/server.test.js: PASS (exit 0, 1200ms)
  node test/suite.test.js: PASS (exit 0, 52ms)
  node test/hardening.test.js: PASS (exit 0, 140ms)
  node --test test/list-response-payload.test.mjs test/underwriting-truth.test.mjs: PASS (exit 0, 380ms)
=== END COMPLETION GATE ===
```

**Refuse to certify "done" on any failure.** Report the fail-path truthfully with the error output, not a reassurance.

## Drift Gates

| Artifact | Generator | Drift test |
|---|---|---|
| `CONTEXT.md` | `scripts/gen-context.js` | `test/context.test.js` (`node scripts/gen-context.js --check`) |
| `.agents/skills-index.json` | `scripts/gen-skills-index.js` | `node scripts/gen-skills-index.js --check` |
| `server/db/schema.sql` ↔ `src/lib/db/schema.sql` | `npm run schema:sync` | `npm run schema:check` |
| `data.js` SOURCES ↔ `src/` SOURCES | — | `test/sync.test.js` |

## Pre-Completion Hook

`.kilo/hooks/hooks.json` wires a `Stop` event hook that runs `scripts/hooks/pre-completion.js`, which delegates directly to `scripts/verify-gate.js` (`discoverChangeType`, `getGate`, `runGate`) so the hook and CLI gate never drift apart.
