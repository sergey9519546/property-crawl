@CONTEXT.md

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Base44 dev environment

Two-process app. The canonical UI is Next.js 16 (App Router) in `src/`; the
listing API is a plain Node `http` server in `server/`. They share one
`package.json` / `node_modules`.

- `npm run dev` → `next dev -p 3001` (canonical UI, port 3001 locally).
- `npm run dev:api` → `node server/server.js` (listing API, port 3000).
- The Next UI reaches the API via `PROPERTY_API_URL` (default
  `http://localhost:3000`). In the Base44 compose the UI runs on port 3000
  and proxies API calls server-side to the internal `api` service.

No database is required to boot. `server/db/client.js` falls back to an
in-memory provider seeded from `data.js` whenever `DATABASE_URL` is unset
(54 listings across 11 sources; 38 real via Treasury/USDA/IRS/GSA scrapers,
16 mock fixtures). Set `DATABASE_URL` to a Postgres+PostGIS URL only
to enable persistence. The repo's own `docker-compose.yml` wires PostGIS,
but the Base44 dev compose intentionally omits it for a lighter dev loop.

No external secrets are required at boot. `OPENAI_API_KEY` is optional and
fails closed when unset; IMAP/Sentry vars are post-launch only.

## Verifying it works

```bash
docker compose -f docker-compose.base44.yml up -d
# UI on http://localhost:3000, API proxied through /api/listings
curl -sf http://localhost:3000/api/listings   # → 50 listings (default cap), source "property-api"
```

The preview is served through an external proxy hostname, so `next.config.mjs`
sets `allowedDevOrigins` from `BASE44_PUBLIC_HOST_SUFFIX` and the dev server
binds `0.0.0.0`. Both are required or the preview origin is blocked.
