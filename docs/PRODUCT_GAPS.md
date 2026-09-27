# Product gaps — closing status (2026-09-20)

Honest inventory. Closed rows have a file or test. Open rows are not closed.

## Closed in this pass (2026-09-20)

| Gap | Status | Evidence |
|---|---|---|
| Onboarding direct crawl ignored env page/depth/timeout clamps | **Closed** | `runOnboardingSource` passes clamped `maxPages` / `maxDepth` / `timeoutMs`. An explicit option still wins. `test/discovery/onboarding-source-budget.test.js` |
| Search page invented a catalog-wide opening-bid fraction | **Closed** | `summarizeInventoryHonesty` counts the current page only. No hardcoded 54/1000 or HUD volume. `src/lib/inventory-honesty.ts`, `src/components/listings/discovery-workbench.tsx`, `test/inventory-honesty.test.mjs` |
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
| Live Postgres listing round-trip | **Open** | `LISTING_SELECT` casts `bidSpread` and timestamps in SQL. A live insert/read still needs `DATABASE_URL`. |
| gsa, irs, nationwide HUD promotion | **Open** | Not promoted. Robots.txt and empty canaries are not overrides. |
| `.cache` durability across redeploys | **Partial** | Compose and Fly mount `/app/.cache`. Koyeb disk is dashboard-only. |
| Fly/Koyeb operator secrets | **Operator** | Values are not set from this repo. |
| Form webhook delivery | **Operator** | `NEWSLETTER_ENDPOINT` / `CONTACT_ENDPOINT` |
| Public live URL and custom domain | **Operator** | — |
| CAPTCHA publishers | **Policy** | Never auto-bypass. |
| Lawyer review of `/privacy` `/terms` | **Legal** | — |
| Multi-user auth | **Product** | Shared-key beta is intentional. |
| Playwright UI suite | **Known flaky here** | Not in the unit gate. |
| Google Maps key restriction | **Ops** | GCP console. |
| Nonce CSP in a live browser | **Unverified** | Policy unit test only. A browser load was not run. |
| Uncommitted session work | **Open** | Not committed in this pass. |

## Do not do

- Do not promote gsa, irs, or a nationwide HUD sweep to clear a checklist.
- Do not hardcode an opening-bid fraction or a HUD volume on the search page.
- Do not treat a green unit gate as a live Postgres or production-secret close.
- Do not mark style-src `unsafe-inline` closed because script-src no longer uses it.
