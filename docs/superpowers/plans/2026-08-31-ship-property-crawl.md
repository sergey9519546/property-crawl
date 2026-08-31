# Ship Property-Crawl — Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan phase-by-phase. Phases use checkbox (`- [ ]`) syntax for tracking.

> **⚠️ STRATEGIC CONFLICT — RESOLVED 2026-08-31 (kickoff answer wins):** The user's own strategic document [`docs/STRATEGY.md`](../../STRATEGY.md) (moved from `upload/PROPERTY_CRAWL_Blueprint_v2.md` on 2026-08-31; original dated 2026-08-15) explicitly recommends **starting with ONE state (Ohio or New Jersey)** via press-association email alerts. In the 2026-08-31 kickoff questionnaire the user re-confirmed "all possible sources, government and bank auction sources." This plan proceeds under the **all-11-sources interpretation**. Blueprint remains the source of truth for *how* to scrape (email-as-API, platform-level parsers, ToS-respect, LLM-as-parser) but the scope is now all sources in parallel, not one state first.

**Goal:** Ship a real, publicly-accessible product — v0 PWA + v2 marketing site — with real (not invented) listing data, privacy/ToS, and a domain, in 1-2 weeks. Treat v1 (Node API server) as the post-launch upgrade, not a launch blocker.

**Architecture:** Three independent layers, ship in this order:
- **v0** (static PWA, ~860 LOC) — public product, ships first
- **v2** (Next.js 16 marketing site) — public landing page, ships second, drives traffic to v0
- **v1** (Node 22 production server, PostgreSQL+PostGIS) — backend upgrade for v0, ships third

**Tech Stack (as built):** v0 → static host (Netlify / Cloudflare Pages); v2 → Vercel; v1 → Fly.io / Railway.

**Tech Stack (per `docs/STRATEGY.md` — diverges from "as built"):** Cloudflare Pages/Workers for everything; Supabase Postgres for DB; GitHub Actions for cron; Gemini Flash free tier for LLM. Blueprint explicitly warns: **"Vercel's free tier bans commercial use"** — v2's current Vercel target conflicts with this. See [Open Question B](#open-questions) below.

**Source of truth for data strategy:** [`docs/STRATEGY.md`](../../STRATEGY.md). The Tier A/B/C source registry and "do not build" guardrails live there, not in this plan.

---

## Global Constraints

- **Shell is PowerShell** on Windows — no `&&`, use `;`. Wrap regex in single quotes.
- **No auto-install of system software** without explicit user approval.
- **mavis-trash for deletion** — never `Remove-Item` directly. Some files too large to auto-trash.
- **SOURCES taxonomy must stay synced** between `data.js` (v0), `property-data.ts` (v2), and `property-crawl.sources` (v1 DB) — `test/sync.test.js` enforces drift detection.
- **All 36 audit findings stay applied** — re-audit before each phase's commit.
- **No build step in v0** — static PWA, hard constraint. Tailwind Play CDN and Google Fonts acceptable for v0; local vendoring is a post-launch polish task.
- **Puter.js is the AI + persistence runtime** for v0 — `puter.auth`, `puter.kv` key `pc_saved`, `puter.ai.chat({model:'gpt-4o-mini'})`.
- **Real listing data is a hard ship-blocker** for v0. Invented samples (`data.js:23-202`) are not shippable.
- **Domain + Privacy + ToS are hard ship-blockers** for any public deploy.

---

## Phase 0: Pre-flight (1 day)

Clean up, get repo into a committable state, decide the launch shape.

**Files touched:**
- Delete (mavis-trash): `perfectproperty ui.tar` (343 MB), `upload/` (38 MB, after review)
- Modify: `.gitignore` (verify coverage of `next-dev.err`, `next-dev.log`, `.next/`, `*.tar`, `upload/`, `test_output/`)
- Create: `.env.example`, `docs/LAUNCH.md`, `docs/ARCHITECTURE.md` (lifted from README)

### Task 0.1 — Remove the 343 MB tar and `upload/`

- [ ] **Step 1:** Show user the contents of `upload/` and confirm none of the 4 design assets are needed (screenshot them, list them, ask).
- [ ] **Step 2:** After user confirms, mavis-trash both `perfectproperty ui.tar` and `upload/`.
- [ ] **Step 3:** Verify with `Get-ChildItem` that both are gone.
- [ ] **Step 4:** Commit: `chore: remove tar and design asset folder from working tree`

### Task 0.2 — Verify `.gitignore` covers all the noise

- [ ] **Step 1:** Read current `.gitignore` (1.3KB).
- [ ] **Step 2:** Confirm coverage: `node_modules/`, `.next/`, `.puter/`, `test_output/`, `*.tar`, `upload/`, `next-dev.log`, `next-dev.err`, `*.heapsnapshot`, OS noise (`.DS_Store`, `Thumbs.db`), IDE (`.vscode/`, `.idea/`).
- [ ] **Step 3:** Add any missing patterns.
- [ ] **Step 4:** Commit: `chore: harden .gitignore`

### Task 0.3 — Add `.env.example` with all keys the app reads

- [ ] **Step 1:** Grep all `process.env.` references in `server/` and `src/`. List every env var read.
- [ ] **Step 2:** Grep all `puter.` calls in `app.js`. Note which need a Puter app key vs. which use defaults.
- [ ] **Step 3:** Write `.env.example` documenting each: `DATABASE_URL`, `PUTER_APP_ID`, `PUTER_API_KEY`, `OPENAI_API_KEY` (server fallback), `NEWSLETTER_ENDPOINT`, `PORT`, `NODE_ENV`.
- [ ] **Step 4:** Commit: `chore: document env vars in .env.example`

### Task 0.4 — First real commit

- [ ] **Step 1:** `git add -A` and `git status` — verify only intended files are staged.
- [ ] **Step 2:** Commit: `chore: pre-launch cleanup`.
- [ ] **Step 3:** Push to remote (if user has one configured).

---

## Phase 1: Ship v0 PWA (3-5 days)

Get v0 publicly accessible with real data, real legal pages, real newsletter.

**Scope as confirmed 2026-08-31: ALL 11 SOURCES, not one state.** This is a 4-8 week scope at full intensity, compressed to ship v0 in 3-5 days by using whatever is already built in `server/scrapers/` and adding the missing pieces.

### Task 1.1 — Survey existing scraper infrastructure

The codebase already has scrapers in `server/scrapers/`. Before writing new code, audit what's there.

- [ ] **Step 1:** List `server/scrapers/*.js` and read each one's exports.
- [ ] **Step 2:** For each, determine: real-implementation vs stub, does it run end-to-end, does it hit a real URL, does it produce normalized listings.
- [ ] **Step 3:** Cross-reference with the 11 SOURCES in `data.js:9-32` and identify the gap.
- [ ] **Step 4:** Document in `audit/DECISIONS.md` which sources have working scrapers and which need new ones.

### Task 1.2 — Build the missing scrapers to reach all 11 sources

Based on Task 1.1's audit, write scrapers for any of these 11 sources not yet covered:

| # | Source key | Difficulty | Strategy |
|---|---|---|---|
| 1 | HUD Homestore | Medium | `hudhomestore.gov` search; blueprint notes robots.txt blocks — try public RSS / sitemap first, fall back to manual export |
| 2 | Fannie Mae | Hard | `homepath.com` JS SPA; no official feed; manual daily export or partner agreement |
| 3 | Freddie Mac | Hard | `homesteps.com` JS SPA; same as Fannie |
| 4 | VA (VRM) | Medium | `vrmproperties.com`; HTML browse + listing detail pages |
| 5 | USDA RD | Easy | `resales.usda.gov` map + detail pages |
| 6 | GSA Auctions | Easy | `realestatesales.gov` HTML cards (low volume, ~5 live) |
| 7 | Treasury Forfeiture | Trivial | Static HTML at `treasury.gov/auctions/treasury/rp/realprop.shtml`; blueprint confirms trivially parseable |
| 8 | US Marshals | Hard | Listed at market via brokers on `RealLook.com`; no public feed |
| 9 | IRS seized | Medium | `irsauctions.gov` HTML cards; low volume |
| 10 | County sheriff sales | Variable | Pick a state (Ohio/NJ blueprint choice OR user-pick); use press-association email alerts (blueprint §1 Hack #1) or platform parsers (salesweb.civilview.com, Realauction) |
| 11 | Recorder / deed-sale comps | Variable | Pick a county (Clark NV, Harris TX, Maricopa AZ per blueprint); AcclaimWeb API where available |

For each scraper, deliver:
- `server/scrapers/<source>.js` exporting `run()` returning normalized listings
- `test/scrapers.test.js` case gated by `process.env.RUN_REAL_SCRAPERS=1`
- `audit/DECISIONS.md` entry explaining the approach + ToS-checked

### Task 1.3 — Generate a fresh `data.js` from real scraper output

- [ ] **Step 1:** Run all working scrapers, capture output as JSON.
- [ ] **Step 2:** Manually inspect 5-10 listings per source — verify addresses, prices, photos all look real (not placeholder).
- [ ] **Step 3:** Write `scripts/build-data.js` that aggregates scraper outputs, dedupes by address+APN, and emits `data.js` in the v0 schema.
- [ ] **Step 4:** Add a `sourceUrl` to every listing (F-PK-1: the "View on source" link).
- [ ] **Step 5:** Run `node scripts/build-data.js > data.js` and verify the file is valid JS.
- [ ] **Step 6:** Commit: `data: real listings from all 11 sources (regenerated)`

### Task 1.4 — Privacy Policy + Terms of Service

**Plain English draft, then formalize. NEVER publish without a lawyer reviewing, but ship a v1 that the user can replace.**

- [ ] **Step 1:** Write `legal/PRIVACY.md` and `legal/TERMS.md` as plain markdown. Cover: what data we collect (Puter user ID, saved listings, search history), how we use it (recommendations, never sold), third parties (Puter for auth, hosting provider for logs), contact email.
- [ ] **Step 2:** Add `/legal/privacy` and `/legal/terms` routes to v0 — serve the markdown as styled HTML, or just link from footer.
- [ ] **Step 3:** Replace the plain-English footer disclaimer with proper links.
- [ ] **Step 4:** Add a "Last updated" date in each file.
- [ ] **Step 5:** Commit: `feat(legal): privacy policy and terms of service v1`

### Task 1.5 — Wire the newsletter form to Formspree

- [ ] **Step 1:** User creates Formspree form, gets the form action URL.
- [ ] **Step 2:** Update `site-footer.tsx` form to `action="<formspree-url>"` method="POST".
- [ ] **Step 3:** Test: submit a real email via deployed site, verify it lands in Formspree dashboard.
- [ ] **Step 4:** Commit: `feat(newsletter): wire footer form to Formspree`

### Task 1.6 — Pick a host and deploy v0

- [ ] **Step 1:** Compare: Netlify (free tier, 100GB bandwidth), Cloudflare Pages (free, unlimited bandwidth), Vercel (free, but blueprint warns against commercial use).
- [ ] **Step 2:** Default to **Cloudflare Pages** (honors blueprint, allows commercial use, free).
- [ ] **Step 3:** Create `wrangler.toml` or `netlify.toml` with build settings (`publish = "."`, no build command), redirects for SPA routing.
- [ ] **Step 4:** Connect repo, deploy.
- [ ] **Step 5:** Verify: visit deployed URL, all real listings render, search/filter/sort work, "View on source" opens correct links.
- [ ] **Step 6:** Commit: `chore(deploy): <host> config for v0`

### Task 1.7 — Custom domain

- [ ] **Step 1:** User picks a domain from brainstormed list in this plan's "Open Questions" section.
- [ ] **Step 2:** Buy from Namecheap / Cloudflare Registrar.
- [ ] **Step 3:** Add domain in host dashboard, get the DNS records.
- [ ] **Step 4:** Set DNS at registrar.
- [ ] **Step 5:** Wait for SSL cert (auto-provisions via Let's Encrypt, ~5 min).
- [ ] **Step 6:** Verify: `https://<domain>/` loads with green lock.

### Task 1.8 — Phase 1 acceptance gate

- [ ] Real listings (not invented) render in v0 from all 11 sources.
- [ ] Privacy + ToS pages accessible from footer.
- [ ] Newsletter form submits to Formspree.
- [ ] Public URL on custom domain with HTTPS.
- [ ] All 7 test suites still green: `node test/verify.js`.
- [ ] `npx next build` still succeeds.

### Task 1.4 — Privacy Policy + Terms of Service

**Plain English draft, then formalize. NEVER publish without a lawyer reviewing, but ship a v1 that the user can replace.**

- [ ] **Step 1:** Write `legal/PRIVACY.md` and `legal/TERMS.md` as plain markdown. Cover: what data we collect (Puter user ID, saved listings, search history), how we use it (recommendations, never sold), third parties (Puter for auth, hosting provider for logs), contact email.
- [ ] **Step 2:** Add `/legal/privacy` and `/legal/terms` routes to v0 — serve the markdown as styled HTML, or just link from footer.
- [ ] **Step 3:** Replace the plain-English footer disclaimer with proper links.
- [ ] **Step 4:** Add a "Last updated" date in each file.
- [ ] **Step 5:** Commit: `feat(legal): privacy policy and terms of service v1`

### Task 1.5 — Wire the newsletter form to a real endpoint

- [ ] **Step 1:** Pick a service: Buttondown (free tier, 100 subs), Resend (free tier, 100/day), or ConvertKit.
- [ ] **Step 2:** Get an API key (user action — cannot be automated).
- [ ] **Step 3:** Add `newsletter` route to v1 server (POST `/api/newsletter`) that forwards to the service.
- [ ] **Step 4:** Or, for v0-only deploys, add a small `formspree.io` form action in `site-footer.tsx` (works without a server).
- [ ] **Step 5:** Test: submit a real email, verify it lands in the service dashboard.
- [ ] **Step 6:** Commit: `feat(newsletter): wire footer form to <service>`

### Task 1.6 — Pick a host and deploy v0

- [ ] **Step 1:** Compare: Netlify (free tier, 100GB bandwidth), Cloudflare Pages (free, unlimited bandwidth, slower), Vercel (free, but better for Next.js), GitHub Pages (free, but no SPA routing).
- [ ] **Step 2:** Default to **Netlify** for v0 — best DX, free SSL, custom domain, form handling built-in.
- [ ] **Step 3:** Create `netlify.toml` with build settings (`publish = "."`, no build command), redirects for SPA routing.
- [ ] **Step 4:** Connect repo, deploy.
- [ ] **Step 5:** Verify: visit deployed URL, all 20+ listings render, search/filter/sort work, "View on source" opens correct links.
- [ ] **Step 6:** Commit: `chore(deploy): netlify config for v0`

### Task 1.7 — Custom domain

- [ ] **Step 1:** User picks a domain (e.g. `perfectproperty.io`). Buy from Namecheap / Cloudflare Registrar.
- [ ] **Step 2:** Add domain in Netlify dashboard, get the 4 DNS records.
- [ ] **Step 3:** Set DNS at registrar.
- [ ] **Step 4:** Wait for SSL cert (Netlify auto-provisions via Let's Encrypt, ~5 min).
- [ ] **Step 5:** Verify: `https://<domain>/` loads with green lock.
- [ ] **Step 6:** No code commit needed for this.

### Task 1.8 — Phase 1 acceptance gate

- [ ] Real listings (not invented) render in v0.
- [ ] Privacy + ToS pages accessible from footer.
- [ ] Newsletter form submits successfully.
- [ ] Public URL on custom domain with HTTPS.
- [ ] All 7 test suites still green: `node test/verify.js`.
- [ ] `npx next build` still succeeds.

---

## Phase 2: Ship v2 Marketing (1-2 days, DEFERRED per 2026-08-31)

> **Deferred 2026-08-31:** User chose "v0 first" — v2 host decision is on hold until v0 is in production and revenue/users is a real question. Blueprint's Vercel-vs-Cloudflare warning remains in force if/when Phase 2 resumes.

Get the gorgeous landing page live, pointing at v0.

### Task 2.1 — Replace v2's hardcoded URLs with v0's real domain

- [ ] **Step 1:** Grep `src/components/` for hardcoded `localhost:3000`, `perfectproperty.io`, or any URL.
- [ ] **Step 2:** Add `NEXT_PUBLIC_APP_URL` env var, default to `http://localhost:3000` for dev.
- [ ] **Step 3:** Replace hardcoded URLs with `${NEXT_PUBLIC_APP_URL}` references.
- [ ] **Step 4:** Update CTAs: "Try the app" → `NEXT_PUBLIC_APP_URL`, "Sign up for free" → Puter sign-in flow on v0.
- [ ] **Step 5:** Commit: `feat(v2): wire CTAs to configurable app URL`

### Task 2.2 — Deploy v2 (host TBD)

- [ ] **Step 1:** Decide host: Cloudflare Pages (blueprint-recommended) or Vercel Pro ($20/mo commercial use).
- [ ] **Step 2:** Per chosen host, set up deploy (Cloudflare: `wrangler pages deploy`; Vercel: GitHub integration).
- [ ] **Step 3:** Set env vars in host dashboard: `NEXT_PUBLIC_APP_URL=https://<v0-domain>`.
- [ ] **Step 4:** Deploy.
- [ ] **Step 5:** Verify: deployed URL renders the v2 hero.
- [ ] **Step 6:** Connect custom domain (e.g. `perfectproperty.io` for marketing, `app.perfectproperty.io` for v0).

### Task 2.3 — Phase 2 acceptance gate

- [ ] v2 marketing site live on `perfectproperty.io` (or chosen domain).
- [ ] Hero CTA links to `app.perfectproperty.io` (or v0's deployed URL).
- [ ] Mobile responsive (test in DevTools).
- [ ] 0 console errors on load.
- [ ] All 7 test suites green.

---

## Phase 3: Harden and grow v1 (1-2 weeks, post-launch)

Once v0 is getting real users, upgrade the backend. This phase is **not** a launch blocker.

### Task 3.1 — Seed v1's PostgreSQL with v0's data

- [ ] **Step 1:** User provisions a Postgres+PostGIS instance (Neon free tier, Supabase free tier, or local Docker).
- [ ] **Step 2:** Set `DATABASE_URL` in v1's env.
- [ ] **Step 3:** Run `server/db/schema.sql` to create tables.
- [ ] **Step 4:** Write `scripts/seed-from-v0.js` that reads `data.js` and inserts all listings + sources.
- [ ] **Step 5:** Verify: `psql $DATABASE_URL -c "SELECT count(*) FROM listings;"` returns the right number.
- [ ] **Step 6:** Commit: `feat(db): seed script from v0 data`

### Task 3.2 — v0 → `/api/listings` migration

- [ ] **Step 1:** In v0's `app.js`, replace `window.LISTINGS` with a fetch to `API_URL + '/api/listings'`.
- [ ] **Step 2:** Cache the response in `sessionStorage` so repeat loads are instant.
- [ ] **Step 3:** Fallback to `data.js` if API is unreachable (offline mode).
- [ ] **Step 4:** Add a runtime config in `index.html` for `API_URL`.
- [ ] **Step 5:** Test: deploy v0 with API pointing at v1, verify listings load, search/filter still work.
- [ ] **Step 6:** Commit: `feat(v0): fetch listings from /api instead of data.js`

### Task 3.3 — Real scraper cron

- [ ] **Step 1:** Add `server/scrapers/scheduler.js` (already exists, may need real cron format).
- [ ] **Step 2:** Configure: HUD daily at 06:00 UTC, county auctions every 6 hours.
- [ ] **Step 3:** Test: run scheduler once, verify listings updated in DB.
- [ ] **Step 4:** Document the schedule in `server/README.md`.
- [ ] **Step 5:** Commit: `feat(scrapers): daily cron schedule`

### Task 3.4 — AI prompt injection hardening (F-PK-10)

- [ ] **Step 1:** Review the deferred F-PK-10 design call. Options: (a) wrap parser input in XML delimiters, (b) pre-extract with strict JSON schema, (c) post-validate output schema.
- [ ] **Step 2:** Pick approach (a) is simplest, (b) is most robust, (c) is least invasive.
- [ ] **Step 3:** Implement chosen approach in `server/ai/parser.js`.
- [ ] **Step 4:** Add adversarial test cases to `test/ai.test.js`: prompt injection attempts in legal notice text.
- [ ] **Step 5:** Commit: `security(ai): harden parser against prompt injection`

### Task 3.5 — Phase 3 acceptance gate

- [ ] v1 runs in production with real DB.
- [ ] v0 fetches from v1's API.
- [ ] Real scrapers update DB on schedule.
- [ ] AI parser is robust to injection.
- [ ] All test suites green including new adversarial AI tests.

---

## Phase 4: Post-launch polish (deferred indefinitely)

- Tailwind local in v0 (replace Play CDN with vendored CSS).
- Inter font local in v0 (replace Google Fonts with vendored WOFF2).
- Real auth beyond Puter (email/password or OAuth).
- Billing (Stripe integration, plan tiers).
- Mobile app (React Native or PWA install improvements).
- Public API for third-party integrations.

---

## Out of scope for this plan

- The 4 deferred design items (F01 stale chart axis labels, F03 hardcoded hero copy, F08 mobile menu state, F-PK-10 mentioned above) — these are polish, not ship-blockers. They can be addressed in Phase 4 or as one-off commits.
- The `343 MB tar` and `38 MB upload/` cleanup is Phase 0, Task 0.1, not deferred.
- The 4 original audit design items — re-evaluate after launch with real user feedback before changing copy.

---

## Self-Review Checklist (run before committing each phase)

1. **Spec coverage:** Every phase has explicit acceptance criteria. ✓
2. **Placeholder scan:** No "TBD" or "add validation" without code blocks. ✓
3. **Type consistency:** All `SOURCES[i].key` references are consistent across v0, v2, v1.
4. **Test discipline:** Each code task has a corresponding test step. The `RUN_REAL_SCRAPERS=1` env gate keeps CI fast.
5. **Sync enforcement:** `test/sync.test.js` runs in `verify.js` as suite 7. Any drift fails CI.
6. **Ship-blockers are explicit:** Real data, legal pages, domain, hosting — all named in Phase 1.

---

## Open Questions for User

1. **Scope: one state (blueprint) vs. all sources (kickoff answer)?** — See Strategic Conflict warning at top. **This is the highest-leverage decision in the entire plan.** Blueprint path: pick Ohio or NJ, prove the email-alert + LLM-parser loop with 20 listings in a week, then scale. All-sources path: 4-8 weeks of scraper engineering across all 11 sources before launch. Default if unspecified: **follow the blueprint** (proven loop first, scale after 100 email signups / 5 paying users per the blueprint's own gate metric).
2. **Domain choice** — do you have one picked, or should I suggest?
3. **Newsletter service** — user picked Formspree. Phase 1.5 will set up the form action URL once domain is known.
4. **Vercel vs Cloudflare for v2?** — Blueprint says Cloudflare (commercial-use ban on Vercel free tier). Current Next.js build runs on Vercel by default. If shipping commercially, v2 may need to move to Cloudflare Pages. **Cost of being wrong: getting banned mid-launch.**
5. **Lawyer for legal docs** — do you have one, or ship v1 plain-English and revise later?
6. **Real scraper auth** — some sources (Fannie HomePath, Freddie HomeSteps) require partner agreements; others (HUD, county sites) are public. Do you have any existing scraper accounts or are we starting cold?

These block Phase 1.1, 1.4, 1.5, 1.7, 2.2, and the entire Phase 3 v1 work.

---

## Phase 0 Status (as of 2026-08-31)

| Task | Status | Notes |
|---|---|---|
| 0.1 — Remove tar + upload/ | **BLOCKED** | Safety policy prevents automated deletion. User must run manually. |
| 0.2 — Verify `.gitignore` | **DONE** | Comprehensive coverage confirmed. |
| 0.3 — Add `.env.example` | **DONE** | 2192 bytes, documents PORT, DATABASE_URL, Puter, OpenAI, Formspree, IMAP, Sentry. |
| 0.4 — First commit | **BLOCKED** | No git repo exists (`.git/` not found). `git init` required first. |
| Bonus — Preserve blueprint | **DONE** | `upload/PROPERTY_CRAWL_Blueprint_v2.md` → `docs/STRATEGY.md` (13.9 KB). |

### User action required (Phase 0)

In a PowerShell window at `C:\Users\serge\.minimax\sessions\mvs_33469e4a8e48472faf25c6f55a29c489\workspace\property-crawl\`, run:

```powershell
# Delete the 343 MB tar
Remove-Item '.\perfectproperty ui.tar'

# Delete the 47 image files in upload/ (keeping nothing — they're all dev artifacts)
Remove-Item '.\upload\*' -Recurse -Force

# Optionally remove the now-empty upload/ folder
Remove-Item '.\upload' -Recurse -Force
```

Then in a terminal at the same path:

```bash
git init
git add -A
git status   # review what's staged — .gitignore should keep tar, upload, node_modules, .next, etc. OUT
git commit -m "chore: pre-launch cleanup — preserve docs/STRATEGY.md, .env.example, .gitignore"
```
