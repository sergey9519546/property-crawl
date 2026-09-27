# Production premortem — Property-Crawl (2026-09-18)

Assume the system was deployed and failed badly. Plausible reasons + repairs applied.

| Failure scenario | Likelihood | Impact | Repair in this release |
|---|---|---|---|
| Platform health-check loops restart because `/api/health/ready` 503s without Postgres | High (was current Dockerfile) | App never “healthy”; zero traffic | Dockerfile + render.yaml health → `/api/health` liveness |
| CI always red → no trusted release signal | High (full npm test needs PG/Playwright) | Cannot ship confidently | Split CI: fail-closed `unit-gate` + optional `extended-suite` |
| Users think `/sign-in` is broken or hacked | Medium | Support load / distrust | Honest operator-access pages |
| Newsletter/contact silently discard messages | Medium (if UI still claimed delivery) | Lost leads | Local persist + honest delivery status (done earlier) |
| Scraper SPA sources look “empty” when blocked | Medium | Wrong product claims | SPA observation_error + fail-closed (done) |
| Secret in `.env.local` leaks via `NEXT_PUBLIC_*` | Medium | Billing abuse on Maps key | Document restrict key; server key not NEXT_PUBLIC; rotate if abused |
| Google Maps key unrestricted → quota theft | Medium | Unexpected $ | Restrict key in GCP; fail-closed when unset |
| Demo deploy with `SCRAPER_BACKGROUND_ENABLED=1` hammers publishers | Low | ToS / IP block | compose/render set background `0` |
| Discovery worker never promotes sources | High without PG | “Why no live inventory?” | runbook: optional DATABASE_URL upgrade path |
| Concurrent form writes corrupt JSONL | Low | Lost forms | append-only + atomic store; accept beta risk |
| Playwright UI suite flake blocks release perception | Medium | False negative quality | unit-gate does not depend on Playwright |
| CAPTCHA publishers still 0 | Certain | Coverage gap | Honest scraper-power guarantee (not a code bug) |

## Residual accepted risks (beta)

1. Shared operator key (no multi-tenant auth) — documented on `/sign-in`.
   Revoke outstanding sessions by rotating the token **or** bumping
   `WORKSPACE_SESSION_EPOCH`.
2. In-memory listing store without Postgres — documented on `/api/health/ready` limitations.
3. Form delivery local-only until webhook env set.
4. Full browser E2E not required for $0 unit-gate release.
5. Unlock rate limit is global/fail-closed — intentional anti-bruteforce tradeoff.
6. Marketing logo marquee names source/tooling landscape, not partnerships.
7. Public listing/search surfaces stay unauthenticated by design; write paths and
   document-review/enrichment/scraper mutations require the operator session.
8. Live public URL still requires an external $0 host account — image + unit-gate
   are verified locally (Docker `property-crawl:production` healthy).

## Adversarial review notes (staff pass, 2026-09-18 → 2026-09-19)

- Client-controlled unlock SID cannot mint unlimited rate buckets (fixed).
- Document-review and enrichment are operator-gated on both API and Next (fixed).
- Scraper mutations on Next require workspace session; public health GET remains.
- Legacy PWA URL sinks only emit `http(s)` (fixed); puter CDN scripts removed from `index.html`.
- Next CSP/XFO present; API CSP remains broader (`connect-src https:`) — accepted for API-only responses.
- maplibre XSS advisory patched to 6.10.0; `npm audit --omit=dev` clean at ship time.
- Docker contact form EACCES fixed (writable `/app/.cache` + fail-soft store).
- Session cookie Secure flag follows request protocol (Docker HTTP unlock works).
- Terminal grid/map share one filter store (no divergent filter state).
- CAPTCHA sources remain fail-closed; nationwide catalog adds enrollment templates only.
- No known P0 remains for the $0 demo tier after `9244390` + this pass.

## Close-out 2026-09-20 (filled gaps only)

These items are closed. The rest of this plan stays open.

| ID | Status | Evidence |
|---|---|---|
| B6 | **Closed as typecheck** | `npm run lint` is `tsc --noEmit`. No eslint config. `.github/workflows/lint.yml` runs it. |
| D2 | **Closed as page-scoped honesty** | Workbench counts the current page only. The old ~54/1000 catalog fraction is not shown. `src/lib/inventory-honesty.ts` |
| A3 | **Closed for seed count and these gaps** | Seed is 2093. `docs/PRODUCT_GAPS.md`, `memory/facts.md`, `AGENTS.md`. |
| D4 | **Reconciled** | Open leftovers match `docs/PRODUCT_GAPS.md` and `docs/OPEN_RESIDUALS.md`. |

Still open here: A1 (uncommitted), C2–C4 (`unsafe-inline`), E1 for gsa/irs, F1–F3 (live Postgres), and every operator item in WS-G. Do not mark those closed.


## Later close-out (2026-09-20)

Fixed after this report. Not a rewrite of the original findings.

- Onboarding crawl budget now passes clamped env limits. Explicit options still win.
- Search opening-bid coverage counts the current page only. No catalog fraction.
- Lint CI runs `npm run lint` (`tsc --noEmit`). No eslint config.
- Seed count is 2093. Do not cite 2096.

Still open: CSP `unsafe-inline`, live Postgres round-trip, gsa/irs/nationwide HUD promotion, operator secrets. Ledger: `docs/GAP_CLOSEOUT_2026-09-20.md`.

## Close-out 2026-09-27 (reconciliation)

The earlier "still open" lines above predate this pass. Current truth, aligned with `docs/PRODUCT_GAPS.md` and `docs/OPEN_RESIDUALS.md`:

| Item | Status | Evidence |
|---|---|---|
| A1 uncommitted session work | **Closed** | Working tree clean; commits `b85b93e`, `04d23b7`, `2904757`, `43ab938`, `5cbc3b3`, `746efa4`. |
| F1/F2 live Postgres round-trip + contract | **Closed** | `node test/db.test.js` live vs `property_crawl`: 6/6 passed, exit 0; verify-first round-trip, ISO timestamps, `bidSpread` cast, throwaway row deleted (DB stayed 2093). |
| F3 live PG suite in CI | **Closed** | `ci.yml` `production-e2e-pg` now runs `node test/db.test.js` against the PostGIS service container (`continue-on-error`, optional per B3). |
| C3 script-src nonce | **Closed** | `middleware.ts` wires `src/proxy.ts`; live 2026-09-26 check: nonce + `strict-dynamic`, no script `unsafe-inline`. |
| C2 third-party font CSS | **Closed with residual** | Inter + Geist Mono on `next/font`; Google link trimmed to Droid Serif (deprecated in next/font data — deliberate); unused Press Start 2P removed. Build + browser verified. |
| C4 style-src `unsafe-inline` | **Closed 2026-09-27** | Production `style-src` = `'self' 'nonce-…' fonts`; React style attrs via `style-src-attr 'unsafe-inline'`; chart `<style>` nonced via NonceProvider. Live production verification (next start :3100): strict header, fully styled pages, 0 CSP violations. Browsers without style-src-attr (< Safari 15.4) degrade inline styles cosmetically — accepted. |
| E1 gsa/irs promotion | **Still open (policy)** | 2026-09-27 live IRS rerun with repaired canary infrastructure: 0 real-estate cards on 2 distinct runs → NOT_CLEAN (publisher empty). gsa stays robots-fail-closed. `reports/canary-irs-2026-09-27.md`. Do not promote to clear a checklist. |
| WS-G operator items | **Still open (operator)** | Secrets, volumes, domain, legal review — outside this repo. |

Do not mark the remaining open rows closed without new evidence.
