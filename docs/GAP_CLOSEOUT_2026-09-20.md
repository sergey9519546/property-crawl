# Gap close-out — 2026-09-20

Fixed items are closed here. Open items stay open.

## Closed

| Item | Evidence |
|---|---|
| Onboarding crawl budget ignored env clamps | `runOnboardingSource` passes clamped `maxPages`, `maxDepth`, and `timeoutMs`. An explicit option still wins. Tests: `test/discovery/onboarding-source-budget.test.js`. Gate: `test/verify.js` suite 1c. |
| Search page invented catalog-wide opening-bid coverage | `summarizeInventoryHonesty` counts the current page only. No catalog fraction and no HUD volume are hardcoded. `src/lib/inventory-honesty.ts`. |
| Lint missing from CI | `.github/workflows/lint.yml` runs `npm run lint`. That script is `tsc --noEmit`. There is no eslint config. |
| Seed count cited as 2096 | Current seed is 2093 records. `CONTEXT.md`, `AGENTS.md`, and `memory/facts.md` agree. Cite `memory/facts-refresh-2026-09-20.md`. Regenerated `docs/SCRAPER_POWER_GUARANTEE.md` and `reports/scraper-power-guarantee.json` on 2026-09-26. Both now cite 2093. |
| Document `script-src 'unsafe-inline'` | Nonce policy in `src/proxy.ts`. HTTPS-only `upgrade-insecure-requests`. Gate: `test/verify.js` suite 1d. |

## Still open

| Item | Why it stays open |
|---|---|
| Content Security Policy `style-src 'unsafe-inline'` | Still required for React style attributes. Not removed. |
| Live Postgres listing round-trip | `mapPgListingRow` and `LISTING_SELECT` cast `bidSpread` and normalize timestamps. A live insert/read still needs `DATABASE_URL`. Not run in this pass. |
| gsa, irs, nationwide HUD promotion | Not promoted. Robots.txt and empty canaries are not overrides. HUD stays at OH,NJ. |
| Operator secrets, cache volume, webhooks, domain, legal review | Outside this repo. |
| Nonce CSP against a running Next UI | Not browser-verified in this pass. |

## Do not do

- Do not promote gsa, irs, or a nationwide HUD sweep to clear a checklist.
- Do not hardcode an opening-bid fraction or a HUD volume on the search page.
- Do not treat a green unit gate as a live Postgres or production-secret close.
- Do not mark style-src `unsafe-inline` closed because script-src no longer uses it.
