# Facts refresh (2026-09-20)

Current citation for the seed count and route list. `memory/facts.md` was restored after a truncated write, and its header points here. Older 2096 notes in that file are historical.

## Current

- `LISTINGS`: 2093 records.
  - Source: `CONTEXT.md` digest `5fe1c0c2599e5f9f29750963fe0c783adb7223a60b7297c2df759134c83a8f92`
- States and property types are the generated lists in `CONTEXT.md`. Do not hand-count them.
  - Source: `CONTEXT.md`
- 16 A/B source types: bid4assets, civilview, fannie, fdic, freddie, gsa, hud, irs, landbank, marshals, servicelink, sheriff, treasury, trustee, usda, va.
  - Source: `CONTEXT.md`
- Server API route modules also include `portfolio-dashboard`, `price-drop`, and `property-comparison`. Inline routes: `sources`, `health`.
  - Source: `CONTEXT.md`
- `AGENTS.md` seed note is 2093 listings across 16 catalog sources.
  - Source: `AGENTS.md`, `CONTEXT.md`
- Direct onboarding crawl uses the same `ONBOARDING_MAX_PAGES`, `ONBOARDING_MAX_DEPTH`, and `ONBOARDING_TIMEOUT_MS` clamps as the pass. An explicit option still wins.
  - Source: `server/discovery/onboarding-pass.js`, `test/discovery/onboarding-source-budget.test.js`
- Search-page opening-amount and sale-date coverage is computed from the current page only.
  - Source: `src/lib/inventory-honesty.ts`, `src/components/listings/discovery-workbench.tsx`
- `npm run lint` is `tsc --noEmit -p tsconfig.json`. CI runs it from `.github/workflows/lint.yml`. There is no eslint config.
  - Source: `package.json`, `.github/workflows/lint.yml`
- Content Security Policy `unsafe-inline` is still required. It is not removed.
  - Source: `docs/OPEN_RESIDUALS.md`
- Postgres row mapping casts `bidSpread` and normalizes timestamps to ISO. A live insert/read round-trip still needs `DATABASE_URL`.
  - Source: `server/db/client.js`, `docs/OPEN_RESIDUALS.md`
- gsa, irs, and nationwide HUD are not promoted. HUD stays at the declared OH,NJ scope.
  - Source: `docs/OPEN_RESIDUALS.md`

## Still outside this repo

Operator secrets, a durable `.cache` volume, webhooks, a domain, and legal review are not set from here.
