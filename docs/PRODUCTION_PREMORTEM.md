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
2. In-memory listing store without Postgres — documented on `/api/health/ready` limitations.
3. Form delivery local-only until webhook env set.
4. Full browser E2E not required for $0 unit-gate release.
