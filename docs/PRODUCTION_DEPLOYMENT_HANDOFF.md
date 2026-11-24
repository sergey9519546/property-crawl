# Production Deployment Handoff & Environment Pre-Flight
> Canonical pre-flight guide for deploying **property-crawl** (**PerfectProperty**) to production.
> Reference: [`docs/COMPLETION_CHECKLIST.md`](./COMPLETION_CHECKLIST.md) and [`CONTEXT.md`](../CONTEXT.md).

---

## 1. Live Production Topology

Production splits into four coordinated managed surfaces:

1. **Canonical Web UI — Vercel (`https://perfectproperty.bid`)**:
   - Next.js 16 App Router UI (`src/`), SSR/RSC pages, trilingual i18n (`en`, `hy`, `ru`), and per-request nonce CSP enforced in `src/proxy.ts` + `middleware.ts`.
   - Proxies API traffic to the backend via `PROPERTY_API_URL` (`https://property-crawl-api.vercel.app`) and imports shared server helpers via `@server/*`. Heavy Next proxy routes declare `export const maxDuration = 60`, and direct `@server/db/*` fallbacks guard on `NEXT_RUNTIME === 'edge'`.
   - **`@opennextjs/cloudflare` Future Coupling Inventory (`11` `src/` files importing `@server/*`)**:
     - *6 pure JS / Edge-safe modules*: `title-risk-engine.js`, `secondary-property-media.js`, `source-policy.js`, `media-policy.js`, `validation.js`, `catalog.js`.
     - *3 `crypto`-only modules (`nodejs_compat` compatible)*: `stripe-checkout.js`, `decision-packet.js`, `scrapy-webhook.js`.
     - *3 Node `fs`/`net`-bound imports guarded on `NEXT_RUNTIME === 'edge'` (`be05`)*: `src/app/api/account/login/route.ts` uses Web `fetch` to Resend on Edge and lazy-loads `server/delivery/outbound-mail.js` (`node:fs` local outbox fallback) in Node; `src/lib/zyte.server.ts` fails closed on Edge and lazy-loads `server/scrapers/zyte-client.js` (`node:net`) in Node; `src/app/api/public/scrapy-ingest/route.ts` guards `server/db/live-record-store.js` behind `NEXT_RUNTIME === 'edge'` and enforces `requireTimestamp: true` replay protection.
2. **Listing API & Intelligence Engine — Vercel Serverless (`https://property-crawl-api.vercel.app`)**:
   - Packaged by `scripts/deploy-vercel-api.js` into a slim serverless bundle (`api/index.js` -> `server/vercel-handler.js`, `vercel.json` with `maxDuration: 60` and `/api` rewrite), excluding `data.js`, `data/listings.snapshot.json`, Python crawlers, fixtures, and test suites.
   - `server/vercel-handler.js` routes ephemeral caches to `/tmp/property-crawl-cache`, forces `SCRAPER_BACKGROUND_ENABLED=0` inside serverless functions, and reconstructs `X-Forwarded-For` from `x-pp-client-ip` when `x-edge-secret` validates against `EDGE_SHARED_SECRET`.
   - **Public-Record Benchmarks**: Ships nationwide HUD FY2025 SAFMR (`38,601` ZIPs via `server/enrichment/hud-safmr.js`), FHFA statewide HPI (`server/enrichment/fhfa-state-hpi.js`), and observed FHFA annual county HPI trends (`2,795` counties with SHA-256 provenance via `server/enrichment/data/county-market-benchmarks.json`, zero fabricated sale prices).
   - **Vercel AI Gateway (free-first OIDC)**: `server/ai/model_router.js` targets `https://ai-gateway.vercel.sh/v1` using `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN`, prioritizing free models (`nvidia/nemotron-3.5-lightning-free`, `reflection/beam-free`) with optional low-cost fallbacks (`AI_GATEWAY_FREE_ONLY=1` disables paid fallbacks) and a hard per-process spend cap (`AI_BUDGET_LIMIT_USD`). Public `GET /api/enrich` serves cached/deterministic summaries only; AI parsing requires operator auth.
3. **Edge Proxy, Public R2 Vault, Cron & Email Routing — Cloudflare Worker (`https://edge.perfectproperty.bid`)**:
   - `cloudflare/property-crawl-edge/worker.js` + `wrangler.toml` caches eligible public `GET`/`HEAD` API routes (`/api/coverage`, `/api/sources`, `/api/auction-calendar`, `/api/neighborhoods`, `/api/property-image/providers`), enforces `no-store` on private/mutation prefixes, and injects `x-edge-secret` and `x-pp-client-ip` upstream to `ORIGIN_URL`.
   - Serves public evidence objects at `/vault/public/*` from the `VAULT` R2 bucket (`property-crawl-vault`) with `ETag`, byte-range support, and `default-src 'none'; sandbox` CSP, while rejecting private `/vault/*` keys with `403`.
   - Dispatches five Workers Free scheduled crons to `POST /api/scrapers/run` (`*/5 * * * *` `next-slice`, `29 * * * *` `repair-enrichment`, `11 */2 * * *` `ai-prewarm`, `17 */6 * * *` `prune`, and `41 */6 * * *` chaining `second-look` -> `dispatch-digests`) and forwards Cloudflare Email Routing messages (`notices@perfectproperty.bid`) via `email()` as `action=email-ingest`.
4. **Durable Database — Supabase PostgreSQL + PostGIS**:
   - Managed PostgreSQL + PostGIS backing listings, observations, saved hunts, research cases, `ai_cache`, `document_reviews`, and billing entitlements across **42** SQL migrations (`003` through `044_account_billing_tier.sql` in `server/db/migrations/`, byte-mirrored under `src/lib/db/migrations/`).
   - **No Silent Demo Fallback**: When no reachable database is configured, `server/db/client.js` reports `dataMode: "unavailable"` and listing endpoints return `503`. `server/db/database-target.js` ensures a configured `DATABASE_URL` takes precedence over embedded modes on cloud runtimes.

---

## 2. Environment Variables & Secret Configuration

Configure these variables directly in each host dashboard (**do NOT commit live secrets to git**):

### Vercel Web UI (`perfectproperty.bid`) & Vercel Serverless API (`property-crawl-api.vercel.app`)

| Variable | Required? | Scope / Example | Purpose |
|---|---|---|---|
| `NODE_ENV` | **Yes** | `production` | Enables production optimizations and strict CSP |
| `PROPERTY_API_URL` | **Yes** (UI) | `https://property-crawl-api.vercel.app` | Canonical backend URL used by Next.js server proxies |
| `PUBLIC_APP_ORIGIN` | **Yes** | `https://perfectproperty.bid` | Canonical UI origin for CORS and redirects (never trusts `Host`) |
| `CORS_ALLOWED_ORIGINS` | **Yes** | `https://perfectproperty.bid,https://edge.perfectproperty.bid` | Explicit CSV allowlist for API CORS |
| `DATABASE_URL` | **Yes** (API) | `postgres://...pooler.supabase.com:6543/postgres?sslmode=require` | Supabase PostgreSQL + PostGIS runtime connection |
| `DATABASE_DIRECT_URL` | Recommended | `postgres://postgres:...@db.<project>.supabase.co:5432/postgres` | Direct Postgres connection for migrations and ledger checks |
| `EDGE_SHARED_SECRET` | **Yes** | `<random-32-char-token>` | Shared `x-edge-secret` authenticating Cloudflare Worker proxy/cron headers |
| `TRUSTED_PROXY_COUNT` | **Yes** | `1` | Resolves real client IP from `x-pp-client-ip` / `X-Forwarded-For` |
| `SCRAPER_ADMIN_TOKEN` | **Yes** | `<random-32-char-token>` | Protects `/api/scrapers/run`, `/api/document-review`, and admin mutations (timing-safe SHA-256) |
| `PROPERTY_OPERATOR_SECRET` | Optional | *(alias for `SCRAPER_ADMIN_TOKEN`)* | Accepted operator credential alias |
| `WORKSPACE_SESSION_SECRET` | **Yes** | `<random-32-char-token>` | Signs operator and member session cookies |
| `WORKSPACE_SESSION_EPOCH` | Recommended | `1` | Increment to invalidate active sessions |
| `VERCEL_OIDC_TOKEN` / `AI_GATEWAY_API_KEY` | Optional | Managed OIDC or gateway token | Authenticates Vercel AI Gateway (`https://ai-gateway.vercel.sh/v1`) |
| `AI_GATEWAY_FREE_ONLY` | Optional | `1` | Restricts Vercel AI Gateway routing to free-tier models only |
| `AI_BUDGET_LIMIT_USD` | Recommended | `5.00` | Hard cumulative AI spend cap per process |
| `REQUIRE_DURABLE_VAULT` | Recommended | `1` | Enforces Cloudflare R2 storage for uploaded/archived evidence |
| `R2_BUCKET` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ENDPOINT` | With `REQUIRE_DURABLE_VAULT=1` | `property-crawl-vault` / `https://<account-id>.r2.cloudflarestorage.com` | S3-compatible Cloudflare R2 credentials for the evidence vault |
| `GOOGLE_MAPS_API_KEY` | Optional | Server-restricted GCP key | Server-side geocoding & Street View metadata lookup only |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Optional (UI) | HTTP-referrer-restricted GCP key | Browser map/Street View embed key (never reuse server key) |
| `RESEND_API_KEY` / `RESEND_FROM` / `OPERATOR_EMAIL` | Optional | `alerts@perfectproperty.bid` | Outbound hunt digests, verification emails, and cron failure alerts |
| `COURTLISTENER_API_KEY` | Optional (With docket lookup) | CourtListener REST v4 API token | Required for live CourtListener v4 `Authorization: Token` requests; `server/scrapers/courtlistener.js` and `/api/verify-docket` fail closed (`courtlistener_api_key_required` / `COURTLISTENER_AUTH_REQUIRED`) when unset |
| `COURTLISTENER_VERIFY_DOCKET` | Optional | `1` (disabled unless set) | Enables live CourtListener v4 bankruptcy/foreclosure docket lookup in `GET /api/verify-docket` and `/api/property-intelligence` when `COURTLISTENER_API_KEY` is also configured |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_ID_PRO` / `STRIPE_PRICE_ID_DESK` | Optional | Stripe live keys & price IDs | Member Pro (`$39/mo`) and Desk (`$149/mo`) billing & webhooks |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | Optional | Sentry project DSN | Zero-dependency fail-silent error envelope reporting with header/PII scrubbing (`sendDefaultPii: false`) |

### Cloudflare Worker (`edge.perfectproperty.bid`)

Configure in `cloudflare/property-crawl-edge/wrangler.toml` (`[vars]` + `[[r2_buckets]]`) and Wrangler secrets:
- `ORIGIN_URL` & `API_ORIGIN`: `https://property-crawl-api.vercel.app`
- `VAULT` R2 binding: `property-crawl-vault`
- Secrets (`wrangler secret put`): `EDGE_SHARED_SECRET`, `SCRAPER_ADMIN_TOKEN` (must match the API), plus optional `ALERT_WEBHOOK_URL` or `RESEND_API_KEY` / `OPERATOR_EMAIL` for scheduled cron failure alerts.

---

## 3. Deployment & Bundle Staging Commands

1. **Canonical Web UI (`perfectproperty.bid`)**:
   - Connected to Vercel Next.js project (`vercel.json`: `"framework": "nextjs"`).
   - Verify locally before push with `npm run lint && npm run build`.
2. **Slim Serverless API (`property-crawl-api.vercel.app`)**:
   - Stage and run the local `/api/health` smoke check (verifies the ~4.38 MB bundle boots in `NODE_ENV=production` without `data.js`):
     ```bash
     node scripts/deploy-vercel-api.js
     ```
   - Stage, smoke-test, and deploy to production Vercel:
     ```bash
     node scripts/deploy-vercel-api.js --deploy
     ```
3. **Cloudflare Edge Worker (`edge.perfectproperty.bid`)**:
   - Run `node --test test/cloudflare/worker.test.mjs`, then deploy from `cloudflare/property-crawl-edge/`:
     ```bash
     npx wrangler deploy
     ```
4. **CI Post-Deploy Smoke Check & Automated Off-Host Backups**:
   - `.github/workflows/deploy.yml` deploys `property-crawl-api` (`node scripts/deploy-vercel-api.js --deploy` when `VERCEL_TOKEN` is set) and `cloudflare/property-crawl-edge` (`npx --yes wrangler deploy` when `CLOUDFLARE_API_TOKEN` is set), then runs post-deploy smoke checks across `DEPLOY_SMOKE_URL` (`https://property-crawl-api.vercel.app/api/health`), `UI_SMOKE_URL` (`https://perfectproperty.bid/`), and `EDGE_SMOKE_URL` (`https://edge.perfectproperty.bid/health`).
   - `.github/workflows/db-backup.yml` runs daily (`17 8 * * *` UTC) and via `workflow_dispatch`, installing `postgresql-client-17` (PGDG) to match Supabase PostgreSQL 17 and executing `node scripts/export-hosted-backup.js --upload-r2` (`DATABASE_DIRECT_URL` or Supavisor `DATABASE_URL` auto-converted from `:6543` to `:5432`) to create a custom-format `pg_dump -Fc`, verify it via `pg_restore --list` and SHA-256 manifest, and upload both artifacts to Cloudflare R2 (`backups/postgres/<YYYY-MM-DD>/` using `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`).

---

## 4. Supabase PostgreSQL Persistence & Migration Sequence

1. **Verify Direct Database Connectivity**:
   ```bash
   node -e "const { Client } = require('pg'); new Client({ connectionString: process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL }).connect().then(() => console.log('Connected')).catch(console.error);"
   ```
2. **Verify Migration Mirror Parity & Apply Migrations (`003`–`044`)**:
   ```bash
   npm run schema:check && npm run discovery:migrate
   ```
3. **Verify Database Health on the Live API**:
   ```bash
   curl -fsS "https://property-crawl-api.vercel.app/api/health" | grep '"dataMode":"postgres"'
   ```
   - Note: `npm run db:seed` is strictly for initializing isolated/test environments from `data.js`; never treat `data.js` as live production inventory.
4. **Observation Compaction & Backup Verification**:
   - Compact redundant `source_observations` heartbeat rows, strip `raw_payload.noticeExcerpt` payloads in batches, and reclaim dead heap space via operator `POST /api/scrapers/run` with `action=compact-observations`:
     ```bash
     curl -fsS -X POST "https://property-crawl-api.vercel.app/api/scrapers/run?action=compact-observations" \
       -H "Authorization: Bearer $SCRAPER_ADMIN_TOKEN" \
       -H "Content-Type: application/json" \
       -d '{"slimPayloads":true,"vacuumFull":true}'
     ```
     (`slimPayloads` defaults to `true`; `vacuumFull: true` runs `VACUUM (FULL, ANALYZE) source_observations` with automatic fallback to `VACUUM (ANALYZE)` if restricted; pass `pruneExpired: true` to run bounded `purgeStaleListings` first.)
   - Run an on-demand off-host verified backup & R2 upload locally (or trigger `.github/workflows/db-backup.yml`):
     ```bash
     node scripts/export-hosted-backup.js --upload-r2
     ```

---

## 5. Post-Deployment Verification & Smoke Protocol

Run these checks immediately after any UI, API, or Edge deployment:

```bash
# 1. Check Vercel API health, release commit SHA, and postgres dataMode
curl -fsS "https://property-crawl-api.vercel.app/api/health"

# 2. Check Cloudflare Edge Worker liveness and R2 vault binding
curl -fsS "https://edge.perfectproperty.bid/health"

# 3. Check paginated listings through the UI origin (or run npm run smoke:production)
curl -fsS "https://perfectproperty.bid/api/listings?limit=5"

# 4. Verify per-request nonce CSP enforcement (no unsafe-inline on script-src)
curl -fsI "https://perfectproperty.bid/" | grep -i "content-security-policy"

# 5. Verify operator endpoints reject unauthenticated requests (401 or 503)
curl -s -o /dev/null -w "%{http_code}\n" "https://property-crawl-api.vercel.app/api/document-review"
```

---

## 6. Rollback Protocol

1. **Vercel UI & API Rollback**: In the Vercel Dashboard for `perfectproperty.bid` or `property-crawl-api`, open **Deployments** and click **Instant Rollback** on the previous green deployment (or re-deploy the prior commit with `node scripts/deploy-vercel-api.js --deploy`).
2. **Cloudflare Worker Rollback**: In `cloudflare/property-crawl-edge/` (or Cloudflare Workers dashboard), run `npx wrangler rollback` to restore the prior active worker version.
3. **Supabase PostgreSQL Rollback** (if a schema migration must be reverted): Restore via Supabase Point-in-Time Recovery (PITR) or logical dump:
   ```bash
   pg_restore -d "$DATABASE_DIRECT_URL" --clean <backup_file>.dump
   ```
