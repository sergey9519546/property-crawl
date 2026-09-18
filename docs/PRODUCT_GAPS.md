# Product gaps — closing status (2026-09-18)

Honest inventory of product gaps after scraper/canary/power work.

## Closed in code (this line of work)

| Gap | Status | Evidence |
|---|---|---|
| Contact/newsletter black-hole forms | **Closed** | Persist to `.cache/form-submissions/`; UI honest when delivery=local |
| Silent empty scrapers (SPA/WAF) | **Closed** | fail-closed + SPA observation_error; demo inventories stripped |
| Scrapling protocol holes | **Closed** | 9 profiles validated; SSRF; rejected=0 canary gate |
| End coverage (all required channels) | **Closed** | 10/10 required ends scheduled; `npm run scrapers:power` |
| IMAP public-notice ingestion | **Closed** | `email-ingest.js` IMAP + corpus; fail-closed without IMAP env |
| Swarm real-execution mode | **Closed** | `--real` + allowlisted executor; `npm run swarm:real` |
| Source promotion gate (code) | **Closed** | Migration 014 + `promotion:gate` contract test without PG |
| Production boot demo honesty | **Closed** | liveness UI health + demo-mode messages |

## Operator / external (not code-closable)

| Gap | Action owner |
|---|---|
| Formspree/newsletter webhook delivery | Set `NEWSLETTER_ENDPOINT` / `CONTACT_ENDPOINT` |
| Migration 014 promotions of more sources | Postgres + `npm run canary:live -- --repeat 2` |
| CAPTCHA publishers (Bid4Assets, Land Bank, CA Controller) | Legitimate access path |
| Lawyer review of `/privacy` `/terms` | Legal |
| Custom domain + public host | Ops (`docs/FREE_PRODUCTION_DEPLOYMENT.md`) |
| Real multi-user auth vs shared-key beta | Product decision |
| Playwright UI suite timeouts on this host | Re-run on idle machine / raise suite timeouts |

## Commands

```powershell
npm run quality:report
npm run smoke:production
npm run promotion:gate
npm run scrapers:power
npm run swarm:real -- "verify completion gate"
```
