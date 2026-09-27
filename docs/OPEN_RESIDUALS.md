# Open residuals (2026-09-20)

Honest leftovers. These are not closed.

## Closed in this pass

| Item | Evidence |
|---|---|
| Onboarding direct-crawl budget ignores env clamps | `runOnboardingSource` passes clamped `maxPages` / `maxDepth` / `timeoutMs`. An explicit option still wins. `test/discovery/onboarding-source-budget.test.js` |
| Search page invents catalog-wide opening-bid coverage | `summarizeInventoryHonesty` counts the current page only. `src/lib/inventory-honesty.ts`, `src/components/listings/discovery-workbench.tsx` |
| Those two fixes were not in the default gate | `test/verify.js` suite `1c` runs the honesty and onboarding budget tests. |
| Lint gate missing from CI | `.github/workflows/lint.yml` runs `npm run lint`. That script is `tsc --noEmit`. There is no eslint config. |
| Seed count citation | Current seed is **2093** records in `CONTEXT.md`. `memory/facts.md` and `AGENTS.md` cite that count. Do not cite 2096. |
| Document `script-src 'unsafe-inline'` | Replaced by a per-request nonce in `src/proxy.ts`. Production `script-src` is `'self'`, the nonce, and `'strict-dynamic'`. Development still adds `'unsafe-eval'`. `upgrade-insecure-requests` is sent only on HTTPS, so local HTTP production boot is unchanged. `test/content-security-policy.test.js`, gate suite `1d`. |

## Still open

| Item | Why it is still open |
|---|---|
| Content Security Policy `style-src 'unsafe-inline'` | React style attributes are not nonced. Removing this would block inline styles. Not removed. |
| Live Postgres listing contract | `LISTING_SELECT` casts `bidSpread` and timestamps in SQL. A live insert/read round-trip still needs `DATABASE_URL`. Not run here. |
| gsa, irs, nationwide HUD promotion | Not promoted. Robots.txt and empty canaries are not overrides. HUD stays at the declared OH,NJ scope. |
| Operator secrets, cache volume, webhooks, domain, legal review | Outside this repo. |
| Nonce CSP in a live browser | The policy unit test passed in intent; a browser load of the Next UI was not run in this pass. |

## Do not do

- Do not promote gsa, irs, or a nationwide HUD sweep to clear a checklist.
- Do not hardcode an opening-bid fraction or a HUD volume on the search page.
- Do not treat a green unit gate as a live Postgres or production-secret close.
- Do not mark `style-src 'unsafe-inline'` closed just because `script-src` no longer uses it.
