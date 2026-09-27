# Open residuals (2026-09-20)

Honest leftovers. These are not closed.

## Closed in this pass

| Item | Evidence |
|---|---|
| Content Security Policy `style-src 'unsafe-inline'` | **Closed 2026-09-27.** Production `style-src` is now `'self' 'nonce-…' https://fonts.googleapis.com` — style *elements* are nonce-gated (the full-stylesheet injection vector). React style *attributes* are covered by `style-src-attr 'unsafe-inline'` (progress widths, motion transforms, data-driven colors). Dev keeps `'unsafe-inline'` in `style-src` because dev tooling may inject style elements without a nonce. The one app `<style>` element (`src/components/ui/chart.tsx`) receives the nonce via `NonceProvider`/`useNonce()` from the root layout. Live production verification (`next start` :3100): CSP header carried `style-src 'self' 'nonce-…' fonts; style-src-attr 'unsafe-inline'`; `/` and `/listings` rendered fully styled (96 cards, `inventory-honesty` present, body bg computed, progress width attr applied); **zero CSP console violations**. Tests: `test/content-security-policy.test.js` (production asserts no bare `unsafe-inline` in `style-src`; dev asserts the retained dev exception). Accepted trade-off: browsers without `style-src-attr` support (Safari < 15.4) fall back to `style-src` and degrade React inline styles cosmetically in production. |
| Live IRS canary close-out attempt | **Evidence recorded 2026-09-27.** The documented rerun path (`canary:live run --sources irs --repeat 2`) executed with working infrastructure (verify-before-guard fix + Postgres coordinator store fix): two distinct live runs fetched the IRS auction list and found **0 real-estate cards both times** (`accepted=0` → NOT_CLEAN per "empty publisher inventory is not a clean canary"). IRS stays unpromoted — correctly, on publisher-empty evidence rather than broken tooling. Report: `.cache/canary-reports/canary-2026-09-27T09-11-25-910Z-cc6b7d2f.json`; `reports/canary-irs-2026-09-27.md`. gsa remains fail-closed on the publisher robots exclusion (operator-only override, not used). |

## Closed earlier

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
| gsa, irs, nationwide HUD promotion | **Policy — stays open.** Not promoted. gsa: publisher robots exclusion on `/our-listing`; collector fail-closed (operator-only override, not used). irs: 2026-09-27 live rerun with repaired canary infrastructure found **0 real-estate auction cards** on two distinct runs (`accepted=0` → NOT_CLEAN; empty publisher inventory is not a clean canary). `reports/canary-irs-2026-09-27.md`. HUD stays at the declared OH,NJ scope. |
| Operator secrets, cache volume, webhooks, domain, legal review | Outside this repo. |
| Production HTTPS CSP check | The 2026-09-27 production style-src verification ran on local HTTP `next start` (:3100): live header + rendered pages + zero CSP violations. A production HTTPS boot (with `upgrade-insecure-requests`) still needs the public deployment. |

## Do not do

- Do not promote gsa, irs, or a nationwide HUD sweep to clear a checklist.
- Do not hardcode an opening-bid fraction or a HUD volume on the search page.
- Do not treat a green unit gate as a live Postgres or production-secret close.
- Do not mark `style-src 'unsafe-inline'` closed just because `script-src` no longer uses it.
