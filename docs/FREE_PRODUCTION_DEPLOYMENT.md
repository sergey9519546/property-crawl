# Free Production Deployment Guide for Property-Crawl

This guide details how to deploy **Property-Crawl** into production completely **free of charge ($0.00/month)**.

---

## 1. Architectural Overview & Why It Can Be Freely Deployed

Property-Crawl is designed with zero-friction production requirements:
1. **Zero Database Required to Boot**: When `DATABASE_URL` is omitted, the application automatically falls back to an in-memory data provider pre-seeded with **585 verified listings across 16 real estate sources** (Treasury, USDA, IRS, GSA, CivilView, ServiceLink, etc.).
2. **Zero External Secrets Required**: `OPENAI_API_KEY`, `GOOGLE_MAPS_API_KEY`, and `CENSUS_API_KEY` are strictly optional and fail closed gracefully without crashing the app.
3. **Unified Single-Port Container Architecture**: The app features a production orchestrator (`scripts/start-production.js`) that boots both the **Node.js Listing API** (internal loopback) and the **Next.js 16 Canonical UI** in a single container, exposing only one public HTTP port (`$PORT`). Next.js server routes (`src/app/api/*`) seamlessly proxy requests to the internal API via `PROPERTY_API_URL`.

---

## 2. Platform Comparison Matrix (100% Free Tiers)

| Platform | Compute / RAM | Sleep Behavior | Credit Card Required? | Best For |
|---|---|---|---|---|
| **Koyeb** | 512 MB RAM, 0.1 vCPU | Active Eco instance does not sleep | **No** | **Recommended: Best overall all-in-one container** |
| **Render** | 512 MB RAM, shared CPU | Sleeps after 15m inactivity (30s cold start) | **No** | 1-Click deploy with `render.yaml` |
| **Hugging Face Spaces** | **16 GB RAM, 2 vCPUs**, 50GB Disk | Sleeps after inactivity, instant restart | **No** | **Heaviest workloads & largest free compute** |
| **Vercel + Backend** | Edge Serverless (Vercel) + 512MB API | Zero sleep on frontend; API sleeps on Render | **No** | Fastest edge caching for Next.js |
| **Fly.io** | 256MB–512MB VM | Auto-stop / auto-start | Yes (verification only) | Global micro-VM container hosting |

---

## 3. Step-by-Step Deployment Methods

### Option A: Koyeb (100% Free Eco Tier — Recommended)

Koyeb offers a permanent free Eco Web Service with an edge network, automated HTTPS, and continuous git deployments.

1. **Push your code to GitHub**:
   Make sure your repository has `Dockerfile.production` and `scripts/start-production.js`.
2. **Sign up at [Koyeb.com](https://www.koyeb.com)** (no credit card required).
3. **Create Service**:
   - Click **Create App** -> **GitHub**.
   - Select your `property-crawl` repository.
   - Choose **Dockerfile** deployment method.
   - Set **Dockerfile location**: `Dockerfile.production`.
   - Instance Type: **Free / Eco (Nano)**.
4. **Environment Variables**:
   - `NODE_ENV`: `production`
   - `PORT`: `8000` (Koyeb automatically sets this)
5. **Deploy**:
   Click **Deploy**. Koyeb builds the multi-stage image, runs `next build`, starts `scripts/start-production.js`, and serves the app on your `*.koyeb.app` domain with free SSL.

---

### Option B: Render.com (1-Click Blueprint or Web Service)

Render provides free web services with automatic Git hooks and SSL.

#### Method 1: Using the provided `render.yaml` Blueprint
1. Push your repository to GitHub.
2. Go to the [Render Dashboard](https://dashboard.render.com).
3. Click **New +** -> **Blueprint**.
4. Connect your GitHub repository.
5. Render detects `render.yaml` and deploys `property-crawl` using `Dockerfile.production`.

#### Method 2: Manual Web Service Setup
1. In Render, click **New +** -> **Web Service**.
2. Connect your repo.
3. Language: **Docker**.
4. Docker Command / Dockerfile path: `Dockerfile.production`.
5. Instance Type: **Free**.
6. Under **Health Check Path**, enter: `/api/health`.
7. Click **Create Web Service**.

> **Tip for Render Free Tier**: To prevent Render from going to sleep after 15 minutes of inactivity, set up a free monitor on [UptimeRobot.com](https://uptimerobot.com) or [cron-job.org](https://cron-job.org) to send an HTTP GET request to `https://<your-app>.onrender.com/api/health` every 10 minutes.

---

### Option C: Hugging Face Spaces (Docker Space — 16 GB Free RAM)

Hugging Face provides an extraordinary **16 GB RAM and 2 vCPUs** completely free.

1. Create an account at [HuggingFace.co](https://huggingface.co).
2. Click **Spaces** -> **Create new Space**.
3. Select:
   - Space SDK: **Docker** -> **Blank**.
   - Space Hardware: **Free (2 vCPU, 16 GB RAM)**.
4. Clone the space repository locally or link it with GitHub Actions:
   ```bash
   git remote add hf https://huggingface.co/spaces/<your-username>/<your-space-name>
   ```
5. Note: Hugging Face Spaces routes external traffic to port **7860**.
   In your Space Settings, add environment variable:
   - `PORT=7860`
6. Push your code:
   ```bash
   git push hf main
   ```
   The application will boot on port 7860, with the internal API running on port 3000 and Next.js handling public requests.

---

### Option D: Decoupled Vercel (Frontend) + Render/Koyeb (Backend API)

If you prefer Vercel's global edge network for the Next.js UI:

#### 1. Deploy the Backend API
1. Deploy your repo to Render or Koyeb using the lean root `Dockerfile` (which only runs `node server/server.js`).
2. This service requires less than 40 MB of RAM!
3. Copy the resulting URL (e.g. `https://property-api.onrender.com`).

#### 2. Deploy the Next.js Frontend to Vercel
1. Go to [Vercel.com](https://vercel.com) and import the GitHub repository.
2. Vercel automatically detects Next.js.
3. In **Environment Variables**, add:
   - `PROPERTY_API_URL`: `https://property-api.onrender.com`
4. Click **Deploy**. Vercel will serve all static and SSR pages at edge speed, proxying any `/api/*` requests directly to your backend.

---

## 4. Free Persistent Database: Neon or Supabase (PostGIS Support)

To retain user hunts, new scrapes, and docket verification history across container restarts, pair your deployment with a 100% free cloud PostgreSQL database:

### Option 1: Neon.tech (Serverless PostgreSQL)
- **Tier**: 100% Free Tier (0.5 GB storage, serverless compute).
- **PostGIS**: Supported! Run `CREATE EXTENSION IF NOT EXISTS postgis;` in the Neon SQL editor.
- **Connection**:
  1. Create a project at [neon.tech](https://neon.tech).
  2. Copy the pooled connection string:
     `postgres://user:password@ep-xyz.neon.tech/neondb?sslmode=require`
  3. Add `DATABASE_URL` to your hosting platform's environment variables.

### Option 2: Supabase
- **Tier**: 2 Free projects, 500 MB database.
- **PostGIS**: Pre-installed.
- **Connection**:
  1. Create a project at [supabase.com](https://supabase.com).
  2. Go to **Project Settings** -> **Database** -> **Connection string (URI)**.
  3. Set `DATABASE_URL` in your host's environment settings.

---

## 5. Production Environment Variables Reference

| Variable | Required? | Default | Description |
|---|---|---|---|
| `PORT` | Auto | `3000` | Public HTTP port exposed by the cloud host |
| `NODE_ENV` | Yes | `production` | Enables production optimizations and disables debug logs |
| `PROPERTY_API_URL` | Auto | `http://127.0.0.1:3002` | Used by Next.js to forward `/api/*` calls to the Node API |
| `DATABASE_URL` | Optional | *empty* | Postgres+PostGIS connection string. When unset, uses in-memory data |
| `SCRAPER_BACKGROUND_ENABLED` | Optional | `0` | Set `1` to run background scrapers; keep `0` on low-RAM free tiers |
| `SCRAPER_ADMIN_TOKEN` | Optional | *empty* | Bearer token to protect scraper trigger endpoints |
| `GOOGLE_MAPS_API_KEY` | Optional | *empty* | Street View & Geocoding API key (fails closed safely) |
| `OPENAI_API_KEY` | Optional | *empty* | AI parsing provider (fails closed safely) |
| `CENSUS_API_KEY` | Optional | *empty* | US Census ACS data lookup key |

---

## 6. Verification and Healthchecks

Every deployment provides a unified healthcheck endpoint:
```bash
curl -f https://<your-deployed-domain>/api/health
```
When healthy, this returns `HTTP 200` with the status of the listing backend and in-memory or database records.
