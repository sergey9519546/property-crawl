# $0 Production release runbook — Property-Crawl / PerfectProperty

**Constraint:** $0 infrastructure cost. No paid DB/host/API unless already
unavoidable. Demo inventory uses the in-memory seed (`data.js`); durable
discovery canaries require PostgreSQL (optional upgrade boundary).

## Finish line for this release

| Gate | Status target | Evidence |
|---|---|---|
| Unit/security/quality gate | Green on GitHub Actions `unit-gate` | CI workflow |
| Production build | `npm run build` passes | Local + CI |
| Demo production boot | `npm run start:production` + `/api/health` 200 | smoke + live verify |
| Honest product surfaces | No fake accounts / no silent empty scrapers | sign-in/register + fail-closed scrapers |
| Zero-cost host | Render/Koyeb/HF Docker free tier | `Dockerfile.production` + `render.yaml` |
| Secrets | Not in git; rotate Maps key if public | `.env.local` gitignored |

## Local production verification (this machine)

Verified on a local production stack (`start:production` demo mode):

- `http://127.0.0.1:3100/api/health` → 200
- `/listings`, `/sources`, `/sign-in` → 200
- `/workspace` → 307 to `/workspace/documents-review`
- `/api/listings` → seed inventory JSON
- CSP + `X-Frame-Options: SAMEORIGIN` present on Next responses
- Homepage copy: no Deal Stacks / Prophecy / accuracy-report claims

```powershell
npm run quality:report
npm run smoke:production
npm run promotion:gate
npm run test:foolproof-p0
npm run build
# optional live stack:
# npm run start:production   then curl http://127.0.0.1:3000/api/health
```

## Deploy options ranked ($0)

| Rank | Host | Why | Config |
|---|---|---|---|
| 1 | **Render Free Web Service** | Docker + env secrets + custom domain later | `render.yaml` + `Dockerfile.production` |
| 2 | **Koyeb Eco** | Free Docker, no CC | Dockerfile.production; `PORT` set by host |
| 3 | **Hugging Face Spaces (Docker)** | 16GB free RAM | Set `PORT=7860` |

### Render (recommended)

1. Push `main` to GitHub (already `sergey9519546/property-crawl`).
2. Render → New → Blueprint → select repo → uses `render.yaml`.
3. Health check is `/api/health` (liveness) — works **without** Postgres.
4. Optional: set `DATABASE_URL` later for durable discovery; then advanced readiness is meaningful.
5. After deploy, verify:
   - `https://<app>.onrender.com/api/health` → 200 JSON
   - `https://<app>.onrender.com/` → marketing/listings
   - `/listings` loads seed inventory
   - `/sign-in` shows operator-access honesty (not a fake form)

## Upgrade boundary (not $0)

- Free managed Postgres is scarce; when available set `DATABASE_URL` +
  `DISCOVERY_MODE=advanced`, run `npm run discovery:migrate`, then
  `npm run canary:live -- --wave wave1 --repeat 2`.
- Form delivery: set `NEWSLETTER_ENDPOINT` / `CONTACT_ENDPOINT` (Formspree free tier).
- Restrict Google Maps key in Cloud Console; prefer server-side Street View key only.

## Rollback

Keep previous GitHub release commit. Render: Instant Rollback in dashboard.
Local: `git revert` + rebuild. Demo data is regenerable (`npm run refresh-data`).

## Security notes

- Never commit `.env.local`.
- `NEXT_PUBLIC_*` Google keys are browser-visible — restrict by HTTP referrer.
- Operator token (`SCRAPER_ADMIN_TOKEN` / `PROPERTY_OPERATOR_SECRET`) is
  server-side only. On free hosts set a long random value; rotate if it ever
  appears in a browser, log, or shared screenshot.
- **Accepted $0 model:** one shared operator secret unlocks the private
  workspace and authorizes API admin routes. There are no multi-user roles.
  Treat the token like a root password. Upgrade path: split unlock credential
  from API service tokens + server-side session revocation.
- Workspace unlock rate limiting is **global/fail-closed** (client cannot mint
  unlimited SID buckets). A handful of bad attempts locks unlock for everyone
  until the window expires — acceptable for a private single-operator deploy.
- Behind Fly/Render/Koyeb/Base44 reverse proxies set `TRUSTED_PROXY_COUNT=1`
  so API rate limits key on the real client IP instead of the proxy address.
- CSP/security headers ship in both `server/server.js` (API) and
  `next.config.mjs` (canonical UI).
- Document review, enrichment refresh, and scraper **mutations** require the
  operator workspace session on the Next origin; the Node API also enforces
  the operator token when that process is reachable.

