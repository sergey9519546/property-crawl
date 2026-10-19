# Production Deployment Handoff & Environment Pre-Flight
> Canonical pre-flight guide for deploying **property-crawl** to production.
> Reference: [`docs/COMPLETION_CHECKLIST.md`](./COMPLETION_CHECKLIST.md) (Items #5, #6, #7, #8).

---

## 1. Zero-Cost ($0.00/mo) Deployment Architecture

The application runs as a unified single-container multi-process stack using `Dockerfile.production`:
1. **Public Ingress**: Runs on port `$PORT` (default `3000` on Render, `8000` on Koyeb).
2. **Next.js 16 Canonical UI**: Binds the public port and proxies `/api/*` requests to the internal loopback API.
3. **Internal Listing API**: Managed by `scripts/start-production.js` on internal port `3002` (or `$PORT+2`), serving catalog listings, intelligence metrics, and scrapers.
4. **Data Persistence**:
   - **Default Demo Mode**: Zero database required to boot. Serves canonical seed listings across 16 sources (read current totals from `CONTEXT.md`).
   - **Durable Production Mode**: Provide `DATABASE_URL` pointing to PostgreSQL + PostGIS 16.

---

## 2. Environment Variables & Secret Configuration

Configure these in your host dashboard (Render Web Service / Koyeb App / Hugging Face Space):

| Variable | Required? | Example / Default | Purpose |
|---|---|---|---|
| `NODE_ENV` | **Yes** | `production` | Enables production optimizations and strict CSP |
| `PORT` | **Yes** | `3000` (Render) / `8000` (Koyeb) | Public HTTP listener port |
| `DATABASE_URL` | Optional | `postgres://user:pass@host:5432/db` | Enables durable Postgres persistence |
| `SCRAPER_ADMIN_TOKEN` | Recommended | `<random-32-char-token>` | Secures operator workspace & review queue |
| `PROPERTY_OPERATOR_SECRET` | Optional | *(matches SCRAPER_ADMIN_TOKEN)* | Alias for operator authentication |
| `WORKSPACE_SESSION_SECRET` | Recommended | `<random-32-char-token>` | Signs operator session cookies |
| `WORKSPACE_SESSION_EPOCH` | Recommended | `1` | Session invalidation epoch |
| `TRUSTED_PROXY_COUNT` | **Yes** (on Render) | `1` | Correct client IP resolution from `X-Forwarded-For` |
| `SCRAPER_BACKGROUND_ENABLED`| Optional | `1` | Enables scheduled periodic background scraping |
| `NEWSLETTER_ENDPOINT` | Optional | `https://hooks.zapier.com/...` | Webhook for newsletter delivery |
| `CONTACT_ENDPOINT` | Optional | `https://hooks.zapier.com/...` | Webhook for contact form delivery |

> **Security Guardrail**: Do NOT commit live tokens to git. Generate random 32-character tokens directly in the hosting dashboard.

---

## 3. GitHub Actions CI/CD Deployment Trigger

The automated deployment pipeline lives in `.github/workflows/deploy.yml`.

### Step 1: Add Secrets to GitHub Repository
Go to **GitHub Settings → Secrets and variables → Actions** and add:
- `RENDER_DEPLOY_HOOK_URL`: Your Render Webhook URL (from **Render Dashboard → Settings → Deploy Hook**).
- `DEPLOY_SMOKE_URL`: The public URL of your service (e.g. `https://property-crawl.onrender.com`).

### Step 2: Triggering Deploy
- **Automated**: Once configured, every push to `main` with passing CI runs `.github/workflows/deploy.yml`.
- **Manual Trigger via cURL**:
  ```bash
  curl -fsS -X POST "$RENDER_DEPLOY_HOOK_URL"
  ```

---

## 4. PostgreSQL Persistence & Migration Sequence

When connecting a durable PostgreSQL database:

1. **Verify Connection**:
   ```bash
   node -e "const { Client } = require('pg'); new Client({ connectionString: process.env.DATABASE_URL }).connect().then(() => console.log('Connected')).catch(console.error);"
   ```
2. **Apply Schema & Migrations**:
   ```bash
   npm run discovery:migrate
   ```
3. **Seed Database from Canonical Catalog**:
   ```bash
   npm run db:seed
   ```
4. **Verify Database Health**:
   ```bash
   curl -fsS "http://localhost:3000/api/health" | grep '"dataMode":"postgres"'
   ```

---

## 5. Post-Deployment Verification & Smoke Protocol

Run these verification checks immediately after deployment:

```bash
# 1. Check stack liveness and data mode
curl -fsS "https://<your-host>/api/health"
# Expected response includes: "status": "ok", "dataMode": "memory" (or "postgres")

# 2. Check paginated listings API
curl -fsS "https://<your-host>/api/listings?limit=5"
# Expected: 200 OK with listings array and total count matching CONTEXT.md

# 3. Check CSP header enforcement (no unsafe-inline on script-src)
curl -I "https://<your-host>/" | grep -i "content-security-policy"
# Expected: script-src 'self' 'nonce-...' 'strict-dynamic'

# 4. Check operator route security (must fail closed with 401/503 without token)
curl -s -o /dev/null -w "%{http_code}\n" "https://<your-host>/api/document-review"
# Expected: 401 or 503
```

---

## 6. Rollback Protocol

If an issue occurs after deployment:
1. **Host Rollback**: In the Render / Koyeb dashboard, navigate to **Deploys** and click **Rollback to this deploy** on the prior green release.
2. **Database Rollback** (if Postgres schema was mutated):
   Execute the verified restore procedure from `docs/RELEASE_RUNBOOK_ZERO_COST.md`:
   ```bash
   pg_restore -d "$DATABASE_URL" --clean <backup_file>.dump
   ```
