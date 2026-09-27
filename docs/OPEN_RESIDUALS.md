# Open residuals (2026-09-20)

Honest leftovers. These are not closed.

## Closed in this pass

| Item | Evidence |
|---|---|
| Onboarding direct-crawl budget ignores env clamps | `runOnboardingSource` passes clamped `maxPages` / `maxDepth` / `timeoutMs`. An explicit option still wins. `test/discovery/onboarding-source-budget.test.js` |
| Search page invents catalog-wide opening-bid coverage | `summarizeInventoryHonesty` counts the current page only. The workbench labels `N on this page` separately from search matches and renders `data-testid="inventory-honesty"`. `src/lib/inventory-honesty.ts`, `src/components/listings/discovery-workbench.tsx`, `test/discovery-workbench-chips.test.mjs` |
| Those two fixes were not in the default gate | `test/verify.js` suite `1c` runs the honesty and onboarding budget tests. |
| Lint gate missing from CI | `.github/workflows/lint.yml` runs `npm run lint`. That script is `tsc --noEmit`. There is no eslint config. |
| Seed count citation | Current seed is **2093** records in `CONTEXT.md`. `memory/facts.md` and `AGENTS.md` cite that count. Do not cite 2096. |
| Document `script-src 'unsafe-inline'` | Replaced by a per-request nonce in `src/proxy.ts`. Production `script-src` is `'self'`, the nonce, and `'strict-dynamic'`. Development still adds `'unsafe-eval'`. `upgrade-insecure-requests` is sent only on HTTPS, so local HTTP production boot is unchanged. `test/content-security-policy.test.js`, gate suite `1d`. |

## Still open

| Item | Why it is still open |
|---|---|
| Content Security Policy `style-src 'unsafe-inline'` | React style attributes are not nonced. Removing this would block inline styles. Not removed. |
| Live Postgres listing contract | Closed 2026-09-27. DATABASE_URL active in .env.local; server starts with verifyConnection success + "[DB] PostgreSQL connection verified"; /api/health emits dataMode=postgres, postgresReachable=true, documentReviewStore=postgres, postgresConfigured=true; /api/listings returns total=2093 with real records (first: 333 FORREST STREET, JERSEY CITY, NJ 07304); UI proxy on 3001 matches exactly (same total/mode/first); production-boot.test.js + inventory-honesty.test.js pass 23/23; wireStoresAfterVerify + isPg + PgHuntStore + saved-searches all take the pool path when isPg. The "best version" (verify-before-listen, honest surfaces, durable operator stores, createListing persistence) is now the running default when DATABASE_URL is reachable. |
| gsa, irs, nationwide HUD promotion | Not promoted. Robots.txt and empty canaries are not overrides. HUD stays at the declared OH,NJ scope. |
| Operator secrets, cache volume, webhooks, domain, legal review | Outside this repo. |
| Nonce CSP in a live browser | **Checked 2026-09-26 on local `next dev`.** `GET http://localhost:3001` returned 200. CSP had `script-src 'self' 'nonce-…' 'strict-dynamic' 'unsafe-eval'` and no `script-src 'unsafe-inline'`. `style-src 'unsafe-inline'` was still present. The page title rendered. This was development, not a production HTTPS boot, so `upgrade-insecure-requests` was correctly absent. |
| Listings API honesty surface (dataMode / documentReviewStore) | **Closed 2026-09-27** | `/api/listings` now emits the same `dataMode` and `documentReviewStore` fields as `/api/health`. Live probe on port 3020: `HTTP=200`, `dataMode=demo`, `documentReviewStore=file`, `TOTAL=6603`, `PAGE_LEN=1`. `server/routes/listings.js:251-252`. Prior gap: health-only surface. |

## Do not do

- Do not promote gsa, irs, or a nationwide HUD sweep to clear a checklist.
- Do not hardcode an opening-bid fraction or a HUD volume on the search page.
- Do not treat a green unit gate as a live Postgres or production-secret close.
- Do not mark `style-src 'unsafe-inline'` closed just because `script-src` no longer uses it.
