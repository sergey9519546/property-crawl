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

## Adversarial review notes (staff pass, 2026-09-18)

- Client-controlled unlock SID cannot mint unlimited rate buckets (fixed).
- Document-review and enrichment are operator-gated on both API and Next (fixed).
- Scraper mutations on Next require workspace session; public health GET remains.
- Legacy PWA URL sinks only emit `http(s)` (fixed); third-party puter scripts remain
  only in unused legacy `index.html` — not launched by production boot.
- Next CSP/XFO present; API CSP remains broader (`connect-src https:`) — accepted
  for API-only responses.
- maplibre XSS advisory patched to 6.10.0; `npm audit --omit=dev` clean at ship time.
- No known P0 remains for the $0 demo tier after `935c6af` + this pass.
