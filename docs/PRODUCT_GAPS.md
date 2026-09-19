# Product gaps — closing status (2026-09-19)

Honest inventory after production release, 10x listing pipeline, and nationwide coverage work.

## Closed in code (2026-09-18 → 2026-09-19)

| Gap | Status | Evidence |
|---|---|---|
| Contact/newsletter black-hole forms | **Closed** | `.cache/form-submissions/` + fail-soft store; Docker writable `.cache` |
| Silent empty scrapers (SPA/WAF) | **Closed** | fail-closed + SPA observation_error |
| Scrapling protocol holes | **Closed** | 9 profiles; SSRF; rejected=0 canary gate |
| End coverage (required channels) | **Closed** | `npm run scrapers:power` |
| IMAP public-notice ingestion | **Closed** | `email-ingest.js` fail-closed without IMAP env |
| Swarm real-execution mode | **Closed** | `npm run swarm:real` |
| Source promotion gate (code) | **Closed** | Migration 014 + `promotion:gate` without PG |
| Production boot demo honesty | **Closed** | liveness `/api/health` + demo messages |
| $0 deploy config + CI unit-gate | **Closed** | Render/Koyeb/Fly/Docker health; unit-gate green |
| Operator unlock cookie on HTTP/Docker | **Closed** | `cookieIsSecure` follows request protocol |
| Document-review / enrichment / scraper mutations | **Closed** | operator session + API token |
| Listing intelligence (quality/opportunity/identity) | **Closed** | `listing-intelligence.js` + `/api/listings.pipeline` |
| Sheriff/CivilView/HUD collection depth | **Closed** | 20 OH counties; CivilView multi-county; HUD env knobs |
| Nationwide catalog + CivilView 18-state registry | **Closed** | 163 catalog sources; `nationwide:coverage` |
| Local Postgres + Migration 014 stack | **Closed** | `discovery:local` migrate verified |
| Shared terminal filter store | **Closed** | `terminal-filter-store.ts` + tests |
| CAPTCHA fail-closed policy | **Closed** | catalog `INCONCLUSIVE_BLOCKED` + enrollment policy tests |
| Intelligence sort UI | **Closed** | Discovery workbench quality/opportunity + minQuality |
| Next scraper proxy 20s timeout vs live runs | **Closed** | 180s scrapers POST; E2E 88s run → 200 / 2206 ingested |
| Live record store 20MB cap after HUD nationwide | **Closed** | default 64MB + `PROPERTY_LIVE_STORE_MAX_BYTES` |
| Complete user workflow verification | **Closed** | `npm run e2e:workflow` — **17/17** on live production stack |

## Operator / external (not code-closable)

| Gap | Action owner |
|---|---|
| Public live URL | Sign up $0 host; set `SCRAPER_ADMIN_TOKEN` + secrets |
| Form webhook delivery | `NEWSLETTER_ENDPOINT` / `CONTACT_ENDPOINT` |
| Migration 014 promotions of more sources | `DATABASE_URL` + `DISCOVERY_MODE=advanced` + `canary:live --repeat 2` |
| CAPTCHA publishers (Bid4Assets, Land Bank, CA Controller) | Legitimate access — never auto-bypass |
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
```
