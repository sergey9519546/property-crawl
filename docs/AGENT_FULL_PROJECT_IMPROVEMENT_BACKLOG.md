# AGENT FULL PROJECT IMPROVEMENT BACKLOG
**For another agent to own end-to-end assessment and implementation**

**Date created:** 2026-09 (based on current state)  
**Updated:** 2026-09-26 after a local improvement pass. This file is untracked. It is a handoff, not a verified closeout.  
**Purpose:** This document captures a complete, evidence-based assessment of the property-crawl project. Another agent should use it to systematically improve the project without repeating investigation. Follow the priorities, verification methods, and rules strictly.

**Core Rule for Executor:** Every claim of improvement must be backed by before/after evidence (tests passing, commands succeeding, health endpoints, git status, etc.). Never weaken checks. Preserve honesty and evidence-first principles.

---

## 1. Project Purpose (One Sentence)
Evidence-first discovery + triage layer for distressed and government-sold property (sheriff sales, trustee sales, HUD/REO, IRS/Treasury/GSA, etc.). "Zillow for distressed property, with an AI that reads the fine print and tells you if each one is actually a deal — and what the catch is."

**Key Strengths to Preserve:**
- Radical honesty: dataMode (demo vs live), source provenance, fail-closed on unverified data.
- Evidence-gated everything: tests, canaries, promotion gates, quality reports.
- Low/zero cost design: email-as-API for legal notices, free enrichment (Census, ArcGIS, FHFA), LLM for parsing instead of brittle scrapers.
- Strong test culture: 100+ test files, verify.js gate, production-e2e, discovery tests.
- Architecture separation: clear v0 (legacy PWA), v1 (Node API), v2 (Next.js UI).
- 16 sources with tiering (A high-trust gov vs B).

**Current State Snapshot (from investigation):**
- ~2093 seed listings in data.js (in-memory fallback when no DB).
- 16 sources defined in CONTEXT.md.
- Two-process runtime: Next UI (3001) proxies to Node API (3000).
- Extensive docs in docs/ (STRATEGY, ULTRAPLAN, PRODUCT_GAPS, OPEN_RESIDUALS, FOOLPROOF_SCRAPE_RESEARCH, etc.).
- Heavy audit trail in audit/.
- Recent CSP improvements for script-src (nonce in src/proxy.ts).
- Many scripts for canary, discovery, sources, tests.

---

## 2. Architecture Map
**Do not mix layers.**

| Layer | Location | Role | Notes |
|-------|----------|------|-------|
| v0 Legacy | index.html + app.js | Static client PWA | Not launched by `npm run dev`. Legacy reference only. |
| v1 API | server/ (plain Node http) | Listings, scrapers, DB client, routes (hunts, document-review, intelligence, etc.) | Core data + collection. |
| v2 UI | src/ (Next.js 16 App Router) | Marketing + workspace UI (sources, hunts, listings, research) | Proxies to API via /api routes or PROPERTY_API_URL. |

**Runtime:**
- `npm run dev` → Next on 3001
- `npm run dev:api` → Node on 3000
- `npm run dev:workspace` → both via runner
- DB: optional Postgres+PostGIS. Falls back to in-memory from data.js.
- Secrets: SCRAPER_ADMIN_TOKEN for operator features (hunts, document review, scrapers). Fails closed without.

**Data Contract:** camelCase in API/UI. Postgres uses snake_case (aliased in server/db/client.js). Risk if not careful.

**Key Integrations:**
- Scrapers: server/scrapers/ + scripts (civilview, federal, email notices, etc.)
- LLM parsing for notices/emails
- Public records enrichment
- Media: property images, Street View (proxied, evidence hierarchy)
- Hunts, Saved Searches, Document Review queue

---

## 3. Investigation Findings

### What Works Well
- **Honesty and evidence:** Health endpoint reports dataMode, documentReviewStore. Source Radar shows real coverage/failures. No silent fallbacks.
- **Test coverage:** Broad suites (scraper-reliability, discovery, intelligence, evidence-truth, etc.). verify.js as main gate. Production boot and e2e tests.
- **Ingestion philosophy:** Email alerts (statutory notices), platform parsers, LLM self-healing, fail-closed.
- **Free stack:** No paid geocoding required. Good use of open data.
- **UI features:** Search (multi-scope), grid+map, evidence dossiers, deal scoring via SCORE_BANDS, hunts with explanations.
- **Docs:** Very detailed (ULTRAPLAN, STRATEGY, FOOLPROOF, audits). Good for agents.

### What Is Broken or Fragile
- **CSP residual:** script-src improved (nonce + strict-dynamic in proxy.ts, test/content-security-policy.test.js wired to verify.js 1d). But `style-src 'unsafe-inline'` remains (React inline styles). Not browser-verified in all passes. upgrade-insecure-requests correctly HTTPS-only.
- **Live DB contract:** No recent verified round-trip for listings with DATABASE_URL (bidSpread, timestamps, camelCase projection). db.test.js has gaps for PG.
- **Source promotion honesty:** treasury/usda/hud@OH,NJ promoted. gsa, irs, nationwide HUD explicitly **not** promoted (and must not be faked to clear checklists). Robots.txt/empty canaries do not override.
- **Dev/ops friction:** Two-process startup. Many scripts. ~60 files sometimes dirty/uncommitted in sessions. Legacy v0 PWA pollutes root.
- **Test gate completeness:** Playwright/UI regression tests exist but often not in main `npm test` / verify gate (flaky noted). Some suites use experimental flags.
- **Unverified claims risk:** Opening-bid coverage must stay page-scoped. As of 2026-09-26 the working tree wires `summarizeInventoryHonesty` into `discovery-workbench.tsx` and labels `N on this page` separately from search matches. That is local and uncommitted. Do not treat HEAD `0222d71` as having this UI: that commit replaced the workbench with a 62-byte placeholder.
- **Complexity:** Split server/Next with aliases (@server). Many overlapping scripts (discovery-*, sources-*, canary-*). Audit artifacts accumulate.

### What Is Missing
- Full CSP close-out path (or explicit residual with plan).
- Reliable one-command full dev experience with clear DB vs demo.
- Browser-level verification for security policies and key UX flows.
- Promotion of additional high-value sources only after canary + gate.
- Simplified maintenance: perhaps consolidate legacy or document removal plan.
- Better handling of operator setup (secrets, volumes) in docs.
- End-to-end live PG + production-like verification in more scenarios.

### Unnecessary Complexity
- Legacy static PWA left in root without clear deprecation.
- Duplicated concerns between server/ and src/ (some scrapers/intel paths).
- Over-abundance of scripts without a clear "core dev loop" vs "ops" split.
- Residuals tracked across multiple docs (PRODUCT_GAPS, OPEN_RESIDUALS, GAP_CLOSEOUT, ULTRAPLAN) — risk of drift.

### Operating Environment Issues
- Docker compose variants (base44, discovery, main).
- Next config has special distDirs for verify/preview.
- Requires specific env for full features (IMAP for email, GOOGLE for maps, etc.).
- Preview origins and allowedDevOrigins for Base44.

---

## 4. Evidence-Based Improvement Backlog

Prioritized by: **User Value + Severity + Reliability Impact + Effort** (high value/low effort first where possible). All changes must preserve existing strengths and intended behavior.

**Verification Rule:** For every item, define "done" with concrete commands/tests/evidence. Run before/after. Update relevant docs (PRODUCT_GAPS, etc.). Regenerate CONTEXT if data changes.

### P0 — Critical Reliability & Honesty (Do First)
1. **Complete CSP close-out or explicit residual**
   - Better: Either remove `style-src 'unsafe-inline'` safely (if possible via CSS modules or nonce-able styles) or document it as tracked residual with concrete path. Ensure full policy (including fonts) is enforced and tested.
   - Verify: Run `node --test test/content-security-policy.test.js`, full `npm test`, production-boot test. Load in browser if possible and inspect CSP headers. Update OPEN_RESIDUALS.md + PRODUCT_GAPS.md.
   - Effort: Medium. Depends on React/Next constraints.
   - Current: Script done, style open.

2. **Verify and harden live Postgres listing contract**
   - Better: Confirmed round-trip for listings (insert/read, bidSpread, timestamps, full camelCase shape) with DATABASE_URL.
   - Verify: `npm run test:db` with PG, `npm run test:production-e2e:db`, quality report. Add explicit test if missing.
   - Effort: Medium (needs DB env).
   - Note: Do not fake; only if DB available.

3. **Clean git state and session hygiene**
   - Better: No uncommitted "session work" left behind. All changes committed or properly stashed with notes.
   - Verify: `git status` clean after work. Update AGENTS.md if needed.
   - Effort: Low.
   - 2026-09-26 status: **not closed.** Working tree still has the workbench restore, CSP boot-test update, page-scoped result copy, and this backlog. Do not commit `verify-out.txt` or a `.next-verify` rewrite of `next-env.d.ts`.

### P1 — Data, Collection & Quality
4. **Careful source expansion (gsa, irs, hud scopes)**
   - Better: Only promote after clean canary runs + promotion:gate. Never nationwide sweeps without evidence.
   - Verify: `npm run canary:live`, `npm run canary:promote`, `npm run promotion:gate`, update reports and PRODUCT_GAPS. Source Radar shows correct scopes.
   - Effort: High (real collection time). Do **not** promote just to clear list.
   - Current: Explicitly blocked in residuals.

5. **Strengthen inventory honesty and volume reporting**
   - Better: All UI/API claims are strictly scoped (current page or declared scope only). No invented fractions.
   - Verify: `test/inventory-honesty.test.mjs`, listing pipeline reports, health endpoint.
   - Effort: Low (recent fixes exist; audit for drift).

6. **Improve canary + discovery reliability**
   - Better: More robust failure reporting, soak tests passing consistently.
   - Verify: `npm run canary:live`, `npm run discovery:soak`, quality:report.

### P2 — Usability, DevEx & Maintainability
7. **Simplify developer startup**
   - Better: Clear single-command path (`npm run dev:workspace`) that works reliably. Better docs for DB vs demo mode. Reduce two-process pain.
   - Verify: `npm run workspace:ready` passes cleanly. New contributor can boot and see listings + sources in <5 min.
   - Effort: Medium. Consider improving workspace-runner.js.

8. **Address legacy v0 PWA**
   - Better: Either remove root index.html/app.js (if truly unused) or clearly mark as deprecated with migration note.
   - Verify: Search for references, update README/AGENTS.md. No broken links.
   - Effort: Low-Medium.

9. **Consolidate residual tracking**
   - Better: Single source of truth for open items (e.g. enhance PRODUCT_GAPS.md or create one master). Reduce drift between ULTRAPLAN / OPEN_RESIDUALS / GAP_CLOSEOUT.
   - Verify: All docs agree on status after changes. Cross-references accurate.

10. **Expand main test gate**
    - Better: Bring stable Playwright/UI tests into `npm test` / verify.js where possible (mark flaky explicitly).
    - Verify: `npm test` runs more coverage without increasing flakiness. Update test/verify.js.
    - Effort: Medium.

### P3 — Architecture & Long-term
11. **Reduce layer duplication**
    - Better: Clearer boundaries or shared types between server/ and src/. Minimize @server alias hacks if possible.
    - Verify: Typecheck clean, fewer cross-import surprises.

12. **Documentation and onboarding polish**
    - Better: README + AGENTS.md point to this backlog. Quickstart for "I want to add a source" or "I want to run full tests".
    - Verify: New agent can follow without re-investigating everything.

13. **Performance / scale (listings, hunts)**
    - Better: Measure and improve query perf, live store caps, hunt ranking.
    - Verify: Existing benchmarks + new measurements.

---

## 5. Execution Process for the Agent (Follow This)
1. **Start here:** Read this document + CONTEXT.md + AGENTS.md + docs/STRATEGY.md + docs/ULTRAPLAN.md + docs/PRODUCT_GAPS.md + docs/OPEN_RESIDUALS.md.
2. **Investigate further if needed:** Use list_dir/read_file on src/, server/, test/, scripts/. Run `npm run workspace:ready`, `npm test`, health checks.
3. **Build/update backlog:** Keep this doc current. Add findings with evidence.
4. **Prioritize & implement:** Work P0 → P1. Make changes with write_file. Always prefer minimal, targeted edits.
5. **Verify rigorously:**
   - Run relevant `npm run test:*` and `node test/verify.js`
   - Check `/api/health`, Source Radar, listings endpoints.
   - `npm run quality:report`, `npm run promotion:gate`
   - `git status`, typecheck, build.
   - For data changes: `node scripts/gen-context.js --check`
6. **Update docs:** After every significant change, update PRODUCT_GAPS.md, OPEN_RESIDUALS.md, this backlog, and any affected README/AGENTS.
7. **Never:**
   - Promote unverified sources to "close" items.
   - Weaken tests or hide failures.
   - Claim browser verification without actually testing in a browser.
   - Invent data volumes or coverage.
8. **Finish:** Provide short summary of what improved + evidence + explicit list of deferred items.

**Tools to use:** list_dir, read_file, write_file. Run tests via run_terminal only for verification (single commands).

---
2026-09-26 — do not claim closed without evidence)
- CSP `style-src 'unsafe-inline'`
- Live Postgres full listing round-trip (`DISCOVERY_TEST_DATABASE_URL` unset here; verify.js suites 3i/3j fail closed)
- gsa, irs, nationwide HUD promotion (intentionally not done)
- Nonce CSP browser verification (unit tests only; no browser load in this pass)
- Uncommitted work hygiene: workbench restore + CSP test drift + page-scoped copy are local
- Playwright tests not fully gated
- Operator-only features (secrets, volumes, domains)

### Checked on 2026-09-26
- Only untracked file: this backlog. No other new source files.
- No remaining `[content omitted after successful execution]` placeholder in the workspace search.
- `npx tsc --noEmit -p tsconfig.json` exit 0 after the workbench restore.
- `node --test test/production-boot.test.js test/content-security-policy.test.js`: 26 pass.
- `node --experimental-strip-types --test test/inventory-honesty.test.mjs test/discovery-workbench-chips.test.mjs`: 7 pass.
- Full `npm test` was not green. Do not skip 3i/3j to claim it is.
- Operator-only features (secrets, volumes, domains)

See docs/OPEN_RESIDUALS.md, docs/PRODUCT_GAPS.md, docs/GAP_CLOSEOUT_2026-09-20.md for latest.

---

## 7. What Success Looks Like
- All P0 items have passing evidence.
- A new agent can clone, boot, run full gate, and understand open work from docs alone.
- Product remains brutally honest about data sources and limitations.
- Complexity reduced where it doesn't add value.
- Tests and docs stay in sync with reality.

**This document is the handoff.** Update it as you work. Do not delete history of decisions.

---

*Generated for agent handoff. Regenerate or extend after major structural changes.*
