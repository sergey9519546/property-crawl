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

**Commits:** ~60 files dirty, **uncommitted**. Phase 0 must land them.

---

## 1. Goals for “done”

1. **Ship-ready $0 path:** clone → `npm ci` → `npm run build` → unit-gate green (incl. production e2e).  
2. **Honest product:** every durability/coverage claim matches code + `/api/health` + Source Radar.  
3. **Operator-ready:** one documented secret + volume checklist for Render/Fly/Koyeb/Docker.  
4. **Collection honesty:** only declared, canary-qualified scopes look “approved”; CAPTCHA stays fail-closed.  
5. **CSP closed or explicitly residual:** fonts work; `unsafe-inline` either removed or still a tracked residual with a concrete close-out path.

---

## 2. Workstreams (full inventory of remaining work)

### WS-A — Release hygiene (P0, code)
| ID | Item | Evidence of done |
|---|---|---|
| A1 | Commit session work (or split commits) | Clean `git status` vs origin policy |
| A2 | CONTEXT regenerated after final script/catalog edits | `node scripts/gen-context.js --check` |
| A3 | `PRODUCT_GAPS.md` / `memory/facts.md` match last verification numbers | Diff review |
| A4 | `package.json` scripts documented (`test:production-e2e`, `:db`, `test:document-review-ui`) | npm scripts list |

### WS-B — CI / verification hardening (P0, code)
| ID | Item | Done when |
|---|---|---|
| B1 | unit-gate timeout 40m + e2e after build | CI green on a clean Ubuntu checkout |
| B2 | **Always demo-pin** e2e in CI (`E2E_EXPECT_DEMO=1`) | CI log shows `dataMode=demo` |
| B3 | Optional CI job `production-e2e:db` with Postgres service | `documentReviewStore=postgres` on CI |
| B4 | Sync schema mirror on every schema change | Script `scripts/sync-schema-mirror.js` + smoke/CI check |
| B5 | Align verify 3b ↔ `test:source-integrity` npm script | Single source of test file list |
| B6 | `lint` ≠ typecheck: either `eslint .` wired or drop eslint deps + doc | `npm run lint` defined and run in CI |

### WS-C — CSP close-out (P1, code)
| ID | Item | Done when |
|---|---|---|
| C1 | Keep Google Fonts hosts in CSP | Already done; retain assertions |
| C2 | Migrate layout fonts to `next/font` where possible | Reduce third-party CSS |
| C3 | **Nonce path:** `proxy.ts` + dynamic rendering for pages that need nonce CSP | `script-src 'nonce-…'` without `unsafe-inline` on operator pages |
| C4 | **Or SRI path:** `experimental.sri` + hash SeoSchema JSON-LD; drop script `unsafe-inline` | production-boot test flips to `doesNotMatch(unsafe-inline)` |
| C5 | API-side CSP remains `script-src 'self'` | Unchanged |

> C3 vs C4 is a **choice**. Static marketing + PPR make full nonce painful; prefer **C4 for static JSON-LD + keep residual documented** unless operator pages can go fully dynamic.
>
> **2026-09-20 note (Next 16 docs):** nonce CSP **requires dynamically rendered pages** (`proxy.ts` + `await connection()`). Static App Router marketing routes cannot receive a nonce at build time. Therefore `script-src 'unsafe-inline'` remains **required for static pages** until those routes are forced dynamic or SRI covers all inline scripts. Do not flip production-boot assertions to ban `unsafe-inline` until that work lands.

### WS-D — Product honesty leftovers (P1, code)
| ID | Item | Done when |
|---|---|---|
| D1 | Active inventory path shows volume (HUD 937) + sale urgency unknown honesty | listing:pipeline report cited in PRODUCT_GAPS |
| D2 | Opening-bid coverage (~54/1000) messaged on workbench | UI note or pipeline badge |
| D3 | Playwright suite: mark not-in-gate clearly; optional nightly job | README/PRODUCT_GAPS + optional CI `continue-on-error` |
| D4 | Premortem residual list reconciled to PRODUCT_GAPS | One table, no contradictions |

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
| F1 | Fix `test/db.test.js` live PG: timestamp ISO normalization | Round-trip test passes with DATABASE_URL |
| F2 | Fix PG projection missing `bidSpread` / camelCase shape | Same |
| F3 | Optional dedicated `TEST_DATABASE_URL` for live PG suite | quality-gate `db-pg` suite env-gated |

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
