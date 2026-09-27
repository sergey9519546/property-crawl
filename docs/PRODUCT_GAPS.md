# Product gaps — closing status (2026-09-20)

Honest inventory. Closed rows have a file or test. Open rows are not closed.

## Closed in this pass (2026-09-27)

| Gap | Status | Evidence |
|---|---|---|
| Active inventory path shows volume + sale-urgency honesty (ULTRAPLAN D1) | **Closed** | `npm run listing:pipeline` (exit 0) reports the active path honestly: Total 1000 observed; opening bid published for 51; sale urgency `unknown` for 956/1000 (no fabricated urgency); top volume hud 940, servicelink 25, usda 16, treasury 11, irs 8. `scripts/listing-pipeline-report.js`, `docs/SCRAPER_LISTING_10X.md`. Numbers are report output, not UI hardcodes. |
| Google Fonts third-party CSS (ULTRAPLAN C2) | **Closed (deliberate residual)** | Inter + Geist Mono self-hosted via `next/font/google` (woff2 in `.next/static/media`); the Google CSS `<link>` now loads Droid Serif only (deprecated in next/font font-data — used by `.font-serif-arcade` testimonials); Press Start 2P removed entirely (class `.font-display-arcade` was never referenced by any component). Verified: `npm run build` exit 0; tsc clean; live browser check — `document.fonts.check` true for Inter, Geist Mono, and Droid Serif (italic+700); stylesheet link = `css2?family=Droid+Serif:...`; only pre-existing fail-closed 401s (`/api/alerts/matches`) in console. CSP keeps `fonts.googleapis.com` in `style-src` for Droid Serif. |
| Live PG contract suite in CI (ULTRAPLAN F3) | **Closed 2026-09-27** | `.github/workflows/ci.yml` `production-e2e-pg` job now runs `node test/db.test.js` against the throwaway PostGIS service container (schema applied by the job; the test cleans its `TEST-` row). Optional `continue-on-error` job per WS-B B3 — cannot block the $0 unit gate. |
| README marks the browser suite outside the unit gate (ULTRAPLAN D3) | **Closed** | README test section now labels `test:ui:e2e` as not part of the required unit gate (optional, Playwright browsers required). CI already runs it only in `continue-on-error: true` extended-suite. |
| Premortem residuals reconciled (ULTRAPLAN D4) | **Closed** | `docs/PRODUCTION_PREMORTEM.md` close-out 2026-09-27 section aligns with PRODUCT_GAPS/OPEN_RESIDUALS: A1 committed, F1/F2 closed live, F3 closed in CI, C2 closed with Droid Serif residual; still open: `style-src 'unsafe-inline'`, gsa/irs/nationwide HUD (policy), WS-G operator items. |

## Closed in this pass (2026-09-20)

| Gap | Status | Evidence |
|---|---|---|
| Onboarding direct crawl ignored env page/depth/timeout clamps | **Closed** | `runOnboardingSource` passes clamped `maxPages` / `maxDepth` / `timeoutMs`. An explicit option still wins. `test/discovery/onboarding-source-budget.test.js` |
| Search page invented a catalog-wide opening-bid fraction | **Closed** | `summarizeInventoryHonesty` counts the current page only. The result header says `N on this page` and does not present catalog `total` as the page size. `src/lib/inventory-honesty.ts`, `src/components/listings/discovery-workbench.tsx`, `test/inventory-honesty.test.mjs`, `test/discovery-workbench-chips.test.mjs` |
| Those fixes were outside the default test gate | **Closed** | `test/verify.js` suite `1c`. 29/29 passed on 2026-09-20. |
| Lint gate missing from CI | **Closed as typecheck** | `npm run lint` is `tsc --noEmit`. There is no eslint config. `.github/workflows/lint.yml` runs that script. |
| Seed count cited as 2096 | **Closed** | Current seed is **2093** in `CONTEXT.md`. `AGENTS.md` and `memory/facts.md` cite 2093. Do not cite 2096. |
| Document `script-src 'unsafe-inline'` | **Closed** | Per-request nonce in `src/proxy.ts`. HTTPS-only `upgrade-insecure-requests`. `test/content-security-policy.test.js`, gate suite `1d`. |

## Closed earlier (2026-09-18 → 2026-09-20)

| Gap | Status | Evidence |
|---|---|---|
| Contact/newsletter black-hole forms | **Closed** | `.cache/form-submissions/` + fail-soft store; Docker writable `.cache` |
| Silent empty scrapers (SPA/WAF) | **Closed** | fail-closed + SPA observation_error |
| Scrapling protocol holes | **Closed** | 9 profiles; SSRF; rejected=0 canary gate |
| End coverage (required channels) | **Closed (code)** | `npm run scrapers:power`; CAPTCHA publishers remain fail-closed by policy |
| IMAP public-notice ingestion | **Closed** | `email-ingest.js` fail-closed without IMAP env |
| Swarm real-execution mode | **Closed** | `npm run swarm:real` |
| Source promotion gate (code) | **Closed** | Migration 014 + `promotion:gate` without PG |
| Production boot demo honesty | **Closed** | liveness `/api/health` + demo messages |
| $0 deploy config (Render path) | **Closed for Render** | Render generates `SCRAPER_ADMIN_TOKEN`; **Koyeb/Fly need secrets set manually** |
| Operator unlock cookie on HTTP/Docker | **Closed** | `cookieIsSecure` follows request protocol |
| Document-review / enrichment / scraper mutations (auth) | **Closed** | operator session + API token |
| Document-review persistence | **Closed for PG + file backends** | `document_reviews` in `server/db/schema.sql` + file store. Health: `documentReviewStore: postgres\|file\|none`. Redeploy durability still needs a volume. |
| Listing intelligence | **Closed** | `listing-intelligence.js` + `/api/listings.pipeline` |
| Sheriff/CivilView/HUD collection depth | **Closed at declared scope** | HUD stays OH,NJ. Nationwide HUD is not promoted. |
| Nationwide catalog + CivilView registry | **Closed** | catalog + `nationwide:coverage` |
| Local Postgres + Migration 014 stack | **Closed** | `discovery:local` migrate verified |
| Shared terminal filter store | **Closed** | `terminal-filter-store.ts` + tests |
| CAPTCHA fail-closed policy | **Closed** | catalog `INCONCLUSIVE_BLOCKED` |
| Intelligence sort UI | **Closed** | Discovery workbench quality/opportunity + minQuality |
| Next scraper proxy timeout | **Closed** | 180s scrapers POST |
| Live record store cap | **Closed** | default 64MB + `PROPERTY_LIVE_STORE_MAX_BYTES` |
| Next proxy holes | **Closed 2026-09-19** | `API_PATH` + App Router routes |
| start:production operator-token parity | **Closed 2026-09-19** | `scripts/production-env.js` |
| Complete user workflow verification | **Closed in unit-gate 2026-09-20** | `npm run test:production-e2e` |
| Migration 014 promotions (treasury, usda, hud @ OH,NJ) | **Closed locally 2026-09-20** | `reports/canary-promotion-hud-2026-09-20.md`. Nationwide HUD remains unpromoted. |
| e2e:workflow in CI unit-gate | **Closed 2026-09-20** | unit-gate runs `scripts/run-production-e2e.js` after production build |
| Runtime production-boot process test | **Closed 2026-09-20** | same script |
| Schema mirror + unit-gate wiring | **Closed 2026-09-20** | `src/lib/db/schema.sql` synced with `server/db/schema.sql` |
| HUD catalog honesty | **Closed 2026-09-20** | `hud-homestore` **SCOPE_LIMITED**; UI preset “OH, NJ promoted run scope” |
| CSP Google Fonts | **Closed 2026-09-20** | `style-src` / `font-src` allow fonts.googleapis.com / fonts.gstatic.com |

## Still open

| Gap | Status | Why it stays open |
|---|---|---|
| CSP `style-src 'unsafe-inline'` | **Open** | React style attributes are not nonced. `script-src` no longer uses `unsafe-inline`. |
| Live Postgres listing round-trip | **Closed 2026-09-27** | DATABASE_URL active; server verifies before listen ("[DB] PostgreSQL connection verified"); /api/health: dataMode=postgres, postgresReachable=true, documentReviewStore=postgres; /api/listings + UI proxy (3001) both return total=2093 with real first record (333 FORREST STREET, JERSEY CITY, NJ); production-boot + honesty tests 23/23 green; wireStoresAfterVerify + PgHuntStore + saved-searches + document-review all take postgres pool path when isPg. The best durable version (verify-before-listen + honest surfaces + operator stores) is now the running default. |
| gsa, irs, nationwide HUD promotion | **Open** | Not promoted. Robots.txt and empty canaries are not overrides. |
| `.cache` durability across redeploys | **Partial** | Compose and Fly mount `/app/.cache`. Koyeb disk is dashboard-only. |
| Fly/Koyeb operator secrets | **Operator** | Values are not set from this repo. |
| Form webhook delivery | **Operator** | `NEWSLETTER_ENDPOINT` / `CONTACT_ENDPOINT` |
| Public live URL and custom domain | **Operator** | — |
| CAPTCHA publishers | **Policy** | Never auto-bypass. |
| Lawyer review of `/privacy` `/terms` | **Legal** | — |
| Multi-user auth | **Product** | Shared-key beta is intentional. |
| Playwright UI suite | **Known flaky here** | Not in the unit gate; README marks `test:ui:e2e` optional and CI runs it only in `continue-on-error` extended-suite. |
| Google Maps key restriction | **Ops** | GCP console. |
| Nonce CSP in a live browser | **Checked locally in dev** | 2026-09-26: `GET http://localhost:3001` returned 200 with a per-request nonce, `strict-dynamic`, and dev `unsafe-eval`. No `script-src 'unsafe-inline'`. Page rendered. Production HTTPS `upgrade-insecure-requests` was not browser-checked. |
| Session work committed | **Closed 2026-09-27** | Working tree clean; six logical commits landed (b85b93e db wiring, 04d23b7 workbench restore, 2904757 CSP middleware, 43ab938 docs, 5cbc3b3 live-PG test, 746efa4 ULTRAPLAN). The `0222d71` placeholder over `discovery-workbench.tsx` was restored from `c451495` in `04d23b7`. |

## Do not do

- Do not promote gsa, irs, or a nationwide HUD sweep to clear a checklist.
- Do not hardcode an opening-bid fraction or a HUD volume on the search page.
- Do not treat a green unit gate as a live Postgres or production-secret close.
- Do not mark style-src `unsafe-inline` closed because script-src no longer uses it.
