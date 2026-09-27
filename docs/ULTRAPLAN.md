# ULTRAPLAN — property-crawl remaining work
**Date:** 2026-09-20 · **Scope:** everything still open after the strict multi-audit session · **Mode:** evidence-gated; no “closed” without a failing-before/passing-after test or a real process run.

---

## 0. Current state (do not redo)

| Area | State |
|---|---|
| Document-review durability | PG `document_reviews` + file store + lock + rollback + hydration + transitions |
| Proxy / UI↔API parity | unbrowse / jobs / import / hunts paths allowlisted; inventory test incl. template prefixes |
| Production boot | `.env.local` into API; `publicPort+2`; BUILD_ID required; e2e in CI unit-gate |
| Security | intel research gated; CORS no Host trust; SSRF on scrapling HTTP; CSRF XFH untrusted; tokens hashed |
| Honesty | health `dataMode` + `documentReviewStore`; DataModeBanner; AGENTS.md; PRODUCT_GAPS updated |
| Canaries | treasury, usda, **hud@OH,NJ** promoted; nationwide HUD unpromoted |
| Last verified | quality **14/14**; e2e demo **25/25**; e2e `--with-db` **24/24**; tsc clean |

**Commits:** **Phase 0 landed 2026-09-27** — working tree clean; session work committed in `b85b93e` (db verify wiring), `04d23b7` (workbench restore + page-scoped copy), `2904757` (CSP nonce middleware), `43ab938` (docs + handoff backlog), `5cbc3b3` (live PG round-trip test, F1/F2). Live-PG integration verified end-to-end: `dataMode=postgres`, `total=2093`, UI proxy matches API.

---

## 1. Goals for “done”

1. **Ship-ready $0 path:** clone → `npm ci` → `npm run build` → unit-gate green (incl. production e2e).  
2. **Honest product:** every durability/coverage claim matches code + `/api/health` + Source Radar.  
3. **Operator-ready:** one documented secret + volume checklist for Render/Fly/Koyeb/Docker.  
4. **Collection honesty:** only declared, canary-qualified scopes look “approved”; CAPTCHA stays fail-closed.  
5. **CSP closed or explicitly residual:** fonts work; script-src and style-src no longer use `unsafe-inline` in production (style attributes scoped via `style-src-attr`); dev keeps documented exceptions.

---

## 2. Workstreams (full inventory of remaining work)

### WS-A — Release hygiene (P0, code)
| ID | Item | Evidence of done |
|---|---|---|
| A1 | Commit session work (or split commits) | **Closed 2026-09-27.** Working tree clean; five logical commits landed: `b85b93e` db wiring, `04d23b7` workbench restore, `2904757` CSP middleware, `43ab938` docs, `5cbc3b3` live-PG test. |
| A2 | CONTEXT regenerated after final script/catalog edits | **Verified 2026-09-27** after the remote `data.js` refresh merge (seed still 2093/16 sources): `CONTEXT.md is current.` |
| A3 | Gap docs match the seed count | **Closed 2026-09-20.** Seed is 2093. See `docs/GAP_CLOSEOUT_2026-09-20.md`. |
| A4 | `package.json` scripts documented (`test:production-e2e`, `:db`, `test:document-review-ui`) | **Closed 2026-09-27.** AGENTS.md §4 test block lists `test:production-e2e`, `test:document-review-ui`, `test:db`; new Database/persistence block lists `db:seed`, `discovery:migrate`, `discovery:local`. |

### WS-B — CI / verification hardening (P0, code)
| ID | Item | Done when |
|---|---|---|
| B1 | unit-gate timeout 40m + e2e after build | **Wired.** `ci.yml` unit-gate: `timeout-minutes: 40`, build step then demo-pinned `run-production-e2e.js`. CI green on a clean Ubuntu checkout is the ongoing signal. |
| B2 | **Always demo-pin** e2e in CI (`E2E_EXPECT_DEMO=1`) | **Closed (wired earlier).** `scripts/run-production-e2e.js` sets `E2E_EXPECT_DEMO=1` when not `--with-db`; `scripts/e2e-user-workflow.js` asserts `dataMode=demo` + store file/none; the CI step clears `DATABASE_URL`/`DISCOVERY_MODE`. |
| B3 | Optional CI job `production-e2e:db` with Postgres service | **Wired earlier.** `ci.yml` `production-e2e-pg` job: postgis service, schema apply, `--with-db` run, `continue-on-error: true`. |
| B4 | Sync schema mirror on every schema change | **Wired earlier.** CI step "Schema mirror sync" runs `node scripts/sync-schema-mirror.js --check`; `db.test.js` also asserts byte-equality. |
| B5 | Align verify 3b ↔ `test:source-integrity` npm script | **Closed (already aligned).** Both run `node --experimental-strip-types --test test/source-integrity.test.mjs test/discovery-workbench-chips.test.mjs`. |
| B6 | Lint gate | **Closed 2026-09-20.** `npm run lint` is `tsc --noEmit`. `.github/workflows/lint.yml` runs it. No eslint config. |

### WS-C — CSP close-out (P1, code)
| ID | Item | Done when |
|---|---|---|
| C1 | Keep Google Fonts hosts in CSP | Done; `fonts.googleapis.com` stays in `style-src` for Droid Serif. |
| C2 | Migrate layout fonts to `next/font` where possible | **Closed 2026-09-27 (deliberate residual).** Inter + Geist Mono on `next/font` (self-hosted woff2 in `.next/static/media`); Google CSS link trimmed to Droid Serif only (deprecated in next/font font-data); unused Press Start 2P removed with its dead `.font-display-arcade` class. Verified: build exit 0, tsc clean, live browser `document.fonts.check` true for all three families, no new console errors. |
| C3 | **Nonce path:** `proxy.ts` + dynamic rendering for pages that need nonce CSP | **Closed.** `middleware.ts` wires `src/proxy.ts`; live check 2026-09-26: `script-src 'self' 'nonce-…' 'strict-dynamic'` with no `unsafe-inline` for scripts. |
| C4 | **Or SRI path:** `experimental.sri` + hash SeoSchema JSON-LD; drop script `unsafe-inline` | Superseded by C3 (nonce works via dynamic layout). |
| C5 | API-side CSP remains `script-src 'self'` | Unchanged. |
| C6 | `style-src 'unsafe-inline'` (React style attributes) | **Closed 2026-09-27.** Production `style-src` = `'self' 'nonce-…' fonts` (no unsafe-inline — style elements nonce-gated, incl. the chart `<style>` via `NonceProvider`/`useNonce`); `style-src-attr 'unsafe-inline'` scopes React style attributes; dev keeps the exception (dev tooling may inject style elements). Live production verification on `next start`:3100: strict header, `/` + `/listings` fully styled (96 cards, honesty chip, progress width attr), **0 CSP console violations**. `test/content-security-policy.test.js`. Accepted trade-off: browsers without `style-src-attr` (Safari < 15.4) degrade inline styles cosmetically in production. |

> **2026-09-20 note (Next 16 docs):** nonce CSP **requires dynamically rendered pages** (`proxy.ts` + `await connection()`). Static App Router marketing routes cannot receive a nonce at build time. The root layout calls `await connection()`, so pages get a nonce. **2026-09-27:** the style-src close-out landed the same way — production `style-src` is nonce-gated; only React style *attributes* remain allowed via `style-src-attr` (a scoped, documented exception, not a bare `unsafe-inline`).

### WS-D — Product honesty leftovers (P1, code)
| ID | Item | Done when |
|---|---|---|
| D1 | Active inventory path shows volume (HUD 937) + sale urgency unknown honesty | **Closed 2026-09-27.** `npm run listing:pipeline` cited in PRODUCT_GAPS with live output: active path 1000 observed, opening bid 51, urgency unknown 956/1000, hud 940 top volume. Numbers come from the report, not UI hardcodes. |
| D2 | Opening-bid coverage | **Closed 2026-09-20.** Page-scoped count only. Do not cite 54/1000. `src/lib/inventory-honesty.ts`. |
| D3 | Playwright suite: mark not-in-gate clearly; optional nightly job | **Closed 2026-09-27.** README marks `test:ui:e2e` as not part of the required unit gate; PRODUCT_GAPS row updated; CI keeps it in `continue-on-error` extended-suite only. |
| D4 | Premortem residual list reconciled to PRODUCT_GAPS | **Closed 2026-09-27.** `docs/PRODUCTION_PREMORTEM.md` gained a Close-out 2026-09-27 reconciliation table matching PRODUCT_GAPS/OPEN_RESIDUALS exactly. |

### WS-E — Collection expansion (P1→P2, ops+code)
| ID | Item | Done when |
|---|---|---|
| E1 | Wave canaries: servicelink, gsa, irs (+ civilview where host allows) | 2 clean runs + `canary:live promote` each |
| E2 | Declared scopes only (never nationwide HUD-style sweeps) | Scope hash recorded in reports |
| E3 | Source Radar approved/pending/blocked always shows **promoted scope** | UI + tests |
| E4 | CAPTCHA sources stay `INCONCLUSIVE_BLOCKED` / unpromotable | Policy tests green |
| E5 | `nationwide:coverage` + `scrapers:power` after each promotion | Reports updated |

### WS-F — Live PG db contract (P2, code)
| ID | Item | Done when |
|---|---|---|
| F1 | Fix `test/db.test.js` live PG: timestamp ISO normalization | **Closed 2026-09-27.** Live run vs `property_crawl`: 6/6 passed, exit 0. The round-trip now calls `verifyConnection()` first (asserts `isPg`), asserts `fetchedAt`/`sourceObservedAt` come back ISO-normalized (`…Z`), and deletes its throwaway row in `finally` (DB stayed at exactly 2093, `TEST-ROWS-LEFT:0`). `test/db.test.js`, commit `5cbc3b3`. |
| F2 | Fix PG projection missing `bidSpread` / camelCase shape | **Closed 2026-09-27.** `bidSpread` added to the numeric-cast contract loop (`LISTING_SELECT` casts `equity_spread::float8`; `mapPgListingRow` Number()-casts leftovers); full `EXPECTED_LISTING_KEYS` shape asserted against a real PG row. Same live run: 6/6, exit 0. |
| F3 | Optional dedicated `TEST_DATABASE_URL` for live PG suite | **Closed 2026-09-27.** `ci.yml` `production-e2e-pg` job now runs `node test/db.test.js` against its throwaway PostGIS service container (never a shared dev DB). The suite accepts `DISCOVERY_TEST_DATABASE_URL` / `TEST_DATABASE_URL` / `DATABASE_URL`; CI passes `DATABASE_URL` pointing at the service. |

### WS-G — Operator / external (not code-closable; checklist)
| ID | Item | Owner |
|---|---|---|
| G1 | Set `SCRAPER_ADMIN_TOKEN` on Fly/Koyeb/Render | Operator |
| G2 | Koyeb persistent disk `/app/.cache`; Fly volume `property_cache` | Operator |
| G3 | Distinct `NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY` + GCP referrer restrict | Operator |
| G4 | Rotate historical api.market key offline (redacted in git) | Operator |
| G5 | Form webhooks `NEWSLETTER_ENDPOINT` / `CONTACT_ENDPOINT` | Operator |
| G6 | Public $0 host + custom domain | Operator |
| G7 | Lawyer review `/privacy` `/terms` | Legal |
| G8 | Multi-user auth | Product (out of beta scope) |

---

## 3. Phased execution (ultra-order)

### Phase 0 — Freeze & land (day 0) **P0**
1. `node scripts/gen-context.js && node scripts/gen-context.js --check`  
2. `npm run typecheck`  
3. `npm run smoke:production`  
4. `npm run quality:report` (with PG if available)  
5. `npm run test:production-e2e` (demo pin)  
6. `npm run test:production-e2e:db` (optional if PG up)  
7. Commit in logical chunks: security · durability · proxy/e2e · canaries/docs  
8. Update PRODUCT_GAPS verification table with **exact** gate counts from step 4–6  

**Exit:** clean tree on main (or PR); CONTEXT current; quality ≥14 suites pass.

### Phase 1 — CI truth (day 0–1) **P0**
1. Confirm `.github/workflows/ci.yml`: timeout 40m; `npm run build`; then e2e with synthesized `.env.local`  
2. Add `DATABASE_URL` deletion explicitly in CI e2e env (or rely on runner default)  
3. Optional: second job `e2e-pg` with `services: postgres` + schema.sql + `--with-db`  
4. Add schema-mirror check to production-smoke / CI (A/B4)  
5. Run a clean-checkout simulation (`npm ci` in empty dir if feasible)  

**Exit:** CI unit-gate green on PR; e2e log shows **demo** honesty fields.

### Phase 2 — CSP decision (day 1–2) **P1**
1. **Default recommendation:** implement **C4 (SRI + hashed SeoSchema)**; keep `script-src 'unsafe-inline'` only if Next bootstrap still injects inline scripts after SRI.  
2. If residual remains: document nonce blocker (static marketing / PPR) in PRODUCT_GAPS; do **not** claim CSP fully closed.  
3. Flip `production-boot.test.js` only when `unsafe-inline` is actually gone.  
4. Visual smoke: fonts render on `/` and `/listings` after CSP change.  

**Exit:** fonts not CSP-blocked; CSP claim matches test assertion.

### Phase 3 — Collection honesty + expansion (day 2–4) **P1**
1. Re-verify Source Radar for hud/treasury/usda on live PG stack (`/sources`)  
2. Run next wave canaries **one source at a time**, declared narrow scopes:  
   - `npm run canary:live -- run --sources servicelink --repeat 2`  
   - same for `gsa`, `irs` (add Scrapling flags only if profiles ready)  
3. Promote only after `clean=2 distinctRunIds=2`; write `reports/canary-promotion-<source>-<date>.md`  
4. After each: `npm run promotion:gate` · `npm run scrapers:power` · `nationwide:coverage`  
5. Never promote CAPTCHA-blocked sources without legitimate access  

**Exit:** wave1 sources either **promoted with scope** or **honestly unpromoted** with gate reasons in reports.

### Phase 4 — PG db contract (day 2–3, parallel) **P2**
1. Reproduce F1/F2 with `DATABASE_URL` set  
2. Normalize timestamps in client projection / test expectations  
3. Verify `bidSpread` camelCase from PG rows matches memory provider  
4. Add `db-pg` quality-gate suite requiring `DISCOVERY_TEST_DATABASE_URL`  

**Exit:** `DATABASE_URL=… node --test test/db.test.js` green.

### Phase 5 — Operator pack (day 3–5) **P0 for “live”**
1. Render: confirm `SCRAPER_ADMIN_TOKEN` generated; set `PUBLIC_APP_ORIGIN`; optional PG  
2. Fly: `fly secrets set SCRAPER_ADMIN_TOKEN=…` + `fly volumes create property_cache` + `fly deploy`  
3. Koyeb: secrets + dashboard disk `/app/.cache`  
4. GCP: new embed key ≠ server Maps key; restrict referrers  
5. Rotate api.market credential; confirm no tracked key remains (`git grep` + history policy)  
6. E2E against **public URL**: `E2E_BASE_URL=https://… npm run e2e:workflow`  
7. Form webhook smoke if endpoints exist  

**Exit:** public health returns `dataMode=postgres` (if PG) + operator unlock works + reviews persist across redeploy (volume).

### Phase 6 — Polish & gate (day 5+) **P2**
1. Playwright on idle host; record results without blocking $0 gate  
2. Optional nightly job: canary status + quality report artifact  
3. Lawyer review privacy/terms  
4. Product decision multi-user auth  
5. Final PRODUCT_GAPS freeze: closed / residual / operator-only — **no row that code cannot satisfy**  

---

## 4. Daily verification loop (every phase)

```powershell
npm run typecheck
npm run smoke:production
npm run promotion:gate
npm run quality:report          # with PG when possible
npm run test:production-e2e     # demo pin
# optional:
npm run test:production-e2e:db
npm run e2e:workflow            # against an already-running stack
```

**Never claim done without:** unit-gate-equivalent quality pass + at least one production e2e path + CONTEXT check.

---

## 5. Risk register

| Risk | Mitigation |
|---|---|
| CI timeout flake | 40m job; quality first; e2e has internal 180s + 90s health |
| Schema mirror drift again | sync script + CI check (B4) |
| Promotion scope changed without new canaries | Migration 014 scope-hash reset; tests + reports |
| CSP “closed” but fonts break | style/font-src + production-boot assertions |
| File-store durability claimed as production | health fields + banner + PRODUCT_GAPS wording |
| Shared `.cache` during multi-stack e2e | tmpdir isolation in run-production-e2e |
| CAPTCHA bypass pressure | Policy: never auto-bypass; INCONCLUSIVE_BLOCKED |
| Secret leak in docs/reports | redact + rotate + `git grep` before release |

---

## 6. Priority stack (if timeboxed)

1. **Phase 0 commit + quality/e2e evidence**  
2. **Phase 1 CI truth (demo pin + schema mirror)**  
3. **Phase 5 operator secrets/volume** (needed for any “live” claim)  
4. **Phase 3 one more promoted source** (servicelink/gsa) with scoped canaries  
5. **Phase 2 CSP** (SRI or documented residual)  
6. **Phase 4 PG db contract**  
7. **Phase 6 polish / legal / auth**  

---

## 7. Out of scope (explicit)

- CAPTCHA bypass (Bid4Assets, Land Bank, CA Controller Cloudflare)  
- Inventing nationwide inventory or sale outcomes  
- Multi-user auth redesign in this pass  
- Guaranteeing publisher uptime / inventory volume  

---

## 8. Operator quick checklist (copy/paste)

```text
[ ] SCRAPER_ADMIN_TOKEN set on host
[ ] Volume/disk mounted at /app/.cache
[ ] PUBLIC_APP_ORIGIN set for CORS
[ ] NEXT_PUBLIC maps key ≠ GOOGLE_MAPS_API_KEY
[ ] DATABASE_URL + schema.sql applied (if production PG)
[ ] e2e:workflow against public URL
[ ] canary:status shows only intended promoted scopes
[ ] PRODUCT_GAPS / health dataMode match reality
```

## Close-out 2026-09-20 (filled gaps only)

These items are closed. The rest of this plan stays open.

| ID | Status | Evidence |
|---|---|---|
| B6 | **Closed as typecheck** | `npm run lint` is `tsc --noEmit`. No eslint config. `.github/workflows/lint.yml` runs it. |
| D2 | **Closed as page-scoped honesty** | Workbench counts the current page only. The old ~54/1000 catalog fraction is not shown. `src/lib/inventory-honesty.ts` |
| A3 | **Closed for seed count and these gaps** | Seed is 2093. `docs/PRODUCT_GAPS.md`, `memory/facts.md`, `AGENTS.md`. |
| D4 | **Reconciled** | Open leftovers match `docs/PRODUCT_GAPS.md` and `docs/OPEN_RESIDUALS.md`. |

Still open here: A1 (uncommitted), C2–C4 (`unsafe-inline`), E1 for gsa/irs, F1–F3 (live Postgres), and every operator item in WS-G. Do not mark those closed.


## Later close-out (2026-09-20)

Fixed after this report. Not a rewrite of the original findings.

- Onboarding crawl budget now passes clamped env limits. Explicit options still win.
- Search opening-bid coverage counts the current page only. No catalog fraction.
- Lint CI runs `npm run lint` (`tsc --noEmit`). No eslint config.
- Seed count is 2093. Do not cite 2096.

Still open: CSP `unsafe-inline`, live Postgres round-trip, gsa/irs/nationwide HUD promotion, operator secrets. Ledger: `docs/GAP_CLOSEOUT_2026-09-20.md`.
