# Product gaps — closing status (2026-09-19, strict re-audit)

Honest inventory after production release, 10x listing pipeline, nationwide
coverage work, and a strict release-owner re-audit of claimed closures.

## Closed in code (2026-09-18 → 2026-09-19)

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
| $0 deploy config (Render path) | **Closed for Render** | Render generates `SCRAPER_ADMIN_TOKEN`; **Koyeb/Fly need secrets set manually** — see operator table |
| Operator unlock cookie on HTTP/Docker | **Closed** | `cookieIsSecure` follows request protocol |
| Document-review / enrichment / scraper mutations (auth) | **Closed** | operator session + API token |
| **Document-review persistence** | **Closed for PG + file backends** | `document_reviews` in `server/db/schema.sql` + store write-through when `DATABASE_URL` pool exists; file store + lock remains $0 fallback. Health: `documentReviewStore: postgres|file|none`. Container file path still needs a volume for redeploy durability. |
| Listing intelligence (quality/opportunity/identity) | **Closed** | `listing-intelligence.js` + `/api/listings.pipeline` |
| Sheriff/CivilView/HUD collection depth | **Closed** | 20 OH counties; CivilView multi-county; HUD env knobs |
| Nationwide catalog + CivilView 18-state registry | **Closed** | 163 catalog sources; `nationwide:coverage` |
| Local Postgres + Migration 014 stack | **Closed** | `discovery:local` migrate verified |
| Shared terminal filter store | **Closed** | `terminal-filter-store.ts` + tests |
| CAPTCHA fail-closed policy | **Closed** | catalog `INCONCLUSIVE_BLOCKED` + enrollment policy tests |
| Intelligence sort UI | **Closed** | Discovery workbench quality/opportunity + minQuality |
| Next scraper proxy 20s timeout vs live runs | **Closed** | 180s scrapers POST; E2E 88s run → 200 / 2206 ingested |
| Live record store 20MB cap after HUD nationwide | **Closed** | default 64MB + `PROPERTY_LIVE_STORE_MAX_BYTES` |
| Next proxy holes (jobs list, unbrowse, workspace import) | **Closed 2026-09-19** | `API_PATH` + App Router routes; `test/property-api-proxy-inventory.test.js` gates UI↔proxy parity |
| start:production operator-token parity | **Closed 2026-09-19** | `scripts/production-env.js` loads `.env.local` into API child; internal port `publicPort+2` for non-3000 |
| Complete user workflow verification | **Closed in unit-gate 2026-09-20** | `npm run test:production-e2e` boots `start:production` then `e2e:workflow`; required step in `.github/workflows/ci.yml` unit-gate after `npm run build` |
| Migration 014 promotions (treasury, usda, **hud @ OH,NJ**) | **Closed locally 2026-09-20** | treasury/usda + **hud** with 2 clean durable canaries at declared scope `HUD_STATES=OH,NJ`, `pageSize=50`, `maxPages=20` — `reports/canary-promotion-hud-2026-09-20.md`. Nationwide HUD sweeps remain unpromoted. |

## Re-opened / still open (strict audit)

| Gap | Status | Action |
|---|---|---|
| e2e:workflow in CI unit-gate | **Closed 2026-09-20** | unit-gate runs `scripts/run-production-e2e.js` after production build |
| Runtime production-boot process test | **Closed 2026-09-20** | `scripts/run-production-e2e.js` spawns `start:production` in unit-gate after build |
| Fly/Koyeb operator secrets | **Operator** | Configs now document required secrets; values must be set in each host |
| **`.cache` durability across redeploys** | **Partial — volume required** | `docker-compose.yml` + `fly.toml` mount `/app/.cache`; Koyeb disk is dashboard-only. Without mounts, reviews/forms/live overlays are wiped on recreate. |
| Form webhook delivery | **Operator** | `NEWSLETTER_ENDPOINT` / `CONTACT_ENDPOINT` |
| Public live URL | **Operator** | Sign up $0 host; set `SCRAPER_ADMIN_TOKEN` + secrets |
| CAPTCHA publishers (Bid4Assets, Land Bank, CA Controller) | **Policy** | Legitimate access — never auto-bypass |
| Lawyer review of `/privacy` `/terms` | **Legal** | — |
| Custom domain | **Ops** | — |
| Multi-user auth | **Product** | Shared-key beta is intentional |
| Playwright UI suite | **Known flaky here** | Re-run on idle host; not unit-gate |
| Google Maps key restriction | **Ops** | GCP console — restrict public embed key |
| Schema mirror + unit-gate wiring | **Closed 2026-09-20** | `src/lib/db/schema.sql` synced with `server/db/schema.sql`; db + queue-ui + hardening in `forms+boot` / verify 24a |
| HUD catalog honesty | **Closed 2026-09-20** | `hud-homestore` **SCOPE_LIMITED**; UI preset “OH, NJ promoted run scope” |
| CSP Google Fonts | **Closed 2026-09-20** | `style-src`/`font-src` allow fonts.googleapis.com / fonts.gstatic.com |

## Operator / external (not code-closable)

| Gap | Action owner |
|---|---|
| Public live URL | Sign up $0 host; set `SCRAPER_ADMIN_TOKEN` + secrets |
| Form webhook delivery | `NEWSLETTER_ENDPOINT` / `CONTACT_ENDPOINT` |
| Migration 014 promotions of more sources | treasury/usda/hud(OH,NJ)/servicelink **promoted**; **gsa** robots-blocked, **irs** live-empty — see `reports/canary-not-clean-gsa-irs-2026-09-20.md` (gate held) |
| CAPTCHA publishers | Legitimate access — never auto-bypass |
| Lawyer review of `/privacy` `/terms` | Legal |
| Custom domain | Ops |
| Multi-user auth | Product decision (shared-key beta is intentional) |
| Playwright UI suite | Re-run on idle host; not unit-gate |
| Google Maps key restriction | GCP console — restrict public embed key |

## Commands

```powershell
npm run quality:report
npm run smoke:production
npm run promotion:gate
npm run scrapers:power
npm run listing:pipeline
npm run nationwide:coverage
npm run market:enroll
npm run discovery:local -- migrate
npm run e2e:workflow
npm run test:production-e2e
```
