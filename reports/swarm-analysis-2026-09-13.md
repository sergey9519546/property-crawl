# Swarm analysis — 2026-09-13

Parallel review of audits, reports, backend (`server/`), frontend (`src/`),
and the test/verification system. Synthesized into a single prioritized plan.

---

## Current state in one paragraph

PerfectProperty is a distressed-property discovery platform with three layers
(legacy static PWA, Node listing API, Next.js 16 workspace UI). The discovery
backend has a real canary→promotion gate (Migration 014) requiring two clean
sourced runs. **ServiceLink is the only source currently promoted under that
contract.** HUD, IRS, Treasury, USDA, GSA, and CivilView all sit in canary
posture with specific blockers. Recurring collection is deliberately disabled.
The frontend has a polished property-detail surface but ships fake contact/newsletter
forms, a shared single-key workspace model, and a marketing homepage that
oversells the product. The test gate (`npm test`) cannot run on this machine
(`node_modules` missing), and even when it runs it excludes the entire discovery
subsystem. CONTEXT.md is already stale relative to package.json.

---

## P0 — Fix this week (security / trust / honesty)

### 1. Rotate and remove the hardcoded API key
- `server/intelligence/zillow-mcp.js:23` and `server/intelligence/property-title.js:6`
  both contain `const DEFAULT_API_KEY = 'cmjgtcjea0001jr04c5ckyyk0';`
- Rotate the key on api.market immediately. Delete the default; throw if the
  env var is unset.

### 2. Wire or remove the fake contact and newsletter forms
- `src/components/site/contact-form.tsx:16-19` saves to localStorage and
  shows "A monitored support address will respond before public launch."
- `src/components/site/site-footer.tsx:67-70` saves email to localStorage with
  status "Email delivery will be connected before launch."
- A beta user who fills these believes they contacted you. Either POST to a
  real endpoint or remove the forms and say "not yet available."

### 3. Fix CONTEXT.md drift (already stale)
- `package.json:21` `test:scraper-reliability` includes `national-core-reports`
  and `irs-scraper`; `CONTEXT.md:92` does not.
- `test/context.test.js` exists but is **not in `verify.js`** and **not in CI**.
- Run `node scripts/gen-context.js` to regenerate, then add the drift check to
  `verify.js` so it cannot silently rot again.

### 4. Add the discovery test suites to the quality gate
- `test:discovery` (18 files) and `test:discovery:operations` (11 files) cover
  leases, fencing, canary promotion, PG parity — the hardest backend logic —
  and **none of them run in `verify.js` or CI**.
- Add at least `test:discovery` and `test:discovery:operations` to `verify.js`.
  PG-dependent files already skip cleanly without `DATABASE_URL`.

### 5. Fix the verify-gate full-gate timeout
- `scripts/verify-gate.js:117` sets `maxDuration: 120000` (2 minutes) for
  `node test/verify.js`, which cannot finish next build + Playwright in 2 minutes.
  The proportional "full" certification path will always timeout-fail.
- Raise to something realistic (e.g. 30 minutes) or remove the hard cap.

---

## P1 — Source gates (the real product backlog)

These are the exact next actions the reports themselves name, in dependency order.

| Source | State | Blocker | Next action |
|---|---|---|---|
| **ServiceLink** | `promoted` | none | Done — 2 clean runs under Migration 014 |
| **USDA** | `canary` | empty coverage on latest run | Run one durable canary (`scripts/discovery-worker.js --canary usda --once`), then a second distinct clean run |
| **HUD** | `promoted` (stale) | durable scope omits `caseStepNumber: 6` | Encode the filter in scope sanitization, verify hash changes, run two 52-jurisdiction canaries |
| **Treasury** | `canary` (counter 4) | 2 clean runs exist, pending root review | Root review, then two canaries with current report pipeline |
| **IRS** | `canary`, 0 clean | parser fixed in code, unverified live; failed-canary overwrote configured scope | Restore configured scope, run promotion review SQL, then a live canary |
| **GSA** | `canary` | robots exclusion + `property_id` identity durability | Resolve access policy, review every `identityBasis`, then two canaries |
| **CivilView** | `canary` | Salem County NJ only (2 clean runs) | Jurisdiction-scoped evidence; not promotable statewide |

**External blockers (do not spin on these):**
- IRS transport `EACCES` on this runtime → needs a network that can reach `www.irsauctions.gov`
- Land Bank Search → Turnstile/CAPTCHA
- Bid4Assets → CAPTCHA
- Docker daemon unavailable → production container deploy unverified

---

## P2 — Backend hardening (ranked)

1. **CORS protocol bug** — `server/server.js:41` always constructs `http://`.
   Behind HTTPS the comparison always fails. Check both schemes or use the
   actual request protocol.
2. **Rate limiter** — `server/security/rate_limiter.js:21` uses
   `req.socket.remoteAddress`. Behind a proxy all traffic shares one bucket.
   No `TRUSTED_PROXY_COUNT` env exists. In-memory only (resets on restart).
3. **No HTTP server timeouts** — `server/server.js:212` sets no
   `requestTimeout` / `headersTimeout`. Slow-loris holds connections indefinitely.
4. **Telemetry is process-local** — `server/scrapers/telemetry.js:11` keeps
   circuit-breaker state in a plain object. Restart resets every source to
   "healthy." Persist to JSON or PG.
5. **`DISCOVERY_PROMOTED_SOURCES` is a no-op** — `server/discovery/contracts.js:3`
   reads the env var but nothing consumes it. Operators may set it expecting
   it to restrict sources. Remove or wire it.
6. **`CollectionJobStore.mutate` has no file lock** —
   `server/sources/collection-coordinator.js:37-43`. Every other JSON store
   in the codebase locks; this one does not.
7. **`getListingById` alias matching is bidirectional suffix/prefix** —
   `server/db/client.js:558`. `id=1` matches `listing-1`, `001`, etc.
   Tighten or remove.
8. **Demo Unsplash images on real listings** — `server/db/client.js:307-320`
   fabricates photo URLs when a listing has none. `seedProvenance` only checks
   `origin === 'live'`, not whether images were fabricated.
9. **No CSP header**; `X-XSS-Protection: 1; mode=block` is obsolete
   (`server/server.js:106-109`).

---

## P3 — Product / UX (what blocks a real beta user)

1. **Identity model** — one shared `SCRAPER_ADMIN_TOKEN` unlocks everything.
   `/sign-in` and `/register` are dead redirects. Either ship real accounts or
   market honestly as "single-operator private beta with a shared access key."
2. **Pick one product surface** — the marketing homepage `InteractiveTerminal`
   (1102 lines) is a parallel app with its own filters, watchlist, and AI.
   The canonical app is `/listings`. Retire the terminal or make it a thin
   preview that links into the workspace.
3. **Remove or gate Puter.js** — `property-drawer.tsx:152-185` sends listing
   address, bid, occupancy, and plaintiff to `window.puter.ai.chat` from the
   browser. No key management, no audit trail, no opt-in. The backend `ai/`
   stack already exists.
4. **Expose underwriting on the detail page** — `src/lib/underwriting.ts` is
   a 607-line pure-function engine. The detail page shows "Total unresolved"
   with three hardcoded "Unknown" rows (`listings/[id]/page.tsx:444-450`).
5. **Deal Video Generator is fake** — `deal-video-generator.tsx:22-28` does
   `setTimeout(1200)` then shows 3 static slides. Remove or clearly label as
   a mockup.
6. **Workspace unlock UX** — 8 failed attempts lock the entire deployment
   for 60s (global bucket). No recovery if the token is lost. Session expiry
   is silent. Fix the rate limit to be per-session and add an expiry warning.
7. **Drop dead routes** — `/sign-in`, `/register`, `/workspace` are redirects;
   `discovery-export-action.tsx` is never imported.
8. **Expose score/equity filters** — `discovery-query.ts:5` defines
   `minScore`, `minEquity`, `seniorLien`, `redemption` but the "More filters"
   panel never exposes them.

---

## P4 — Test system debt

1. **`node_modules` is missing on this machine** — `npm test` cannot run
   until `npm ci` (or `npm install`).
2. **Almost no unit tests for `src/`** — UI truth depends entirely on one
   53-test Playwright file. No fast React unit layer for regressions.
3. **Legacy PWA is over-tested** — `suite.test.js` and `e2e.test.js` target
   `index.html` / `app.js`, not the Next.js product.
4. **Orphan tests** — `playwright_test.py`, `test-landbanksearch.js`,
   `zillow-mcp.test.js`, `alachua-pilot.test.js` have no npm script.
5. **Port hardcoding** — 3999, 3100, 3102 are fixed; collisions fail hard.
6. **verify.js drifts from package.json** — `api-rate-policy`/`api-rate-http`
   are in the npm script but not in verify suite 3c; `national-core-reports`
   and `irs-scraper` are in the npm script but not in verify suite 3a.

---

## Recommended sequence

```
Week 1 (trust + gate integrity)
  P0.1  Rotate api.market key, delete defaults
  P0.2  Wire or remove contact/newsletter forms
  P0.3  Regenerate CONTEXT.md, add drift check to verify.js
  P0.4  Add test:discovery + test:discovery:operations to verify.js
  P0.5  Fix verify-gate.js 120s timeout

Week 2 (source canaries — network permitting)
  P1    USDA canary ×2 → Treasury root review + canaries
        HUD step-6 scope fix + canaries
        IRS scope restore + canary (needs network to irsauctions.gov)

Week 3 (backend hardening)
  P2.1  CORS protocol fix
  P2.2  Trusted-proxy rate limiter
  P2.3  HTTP server timeouts
  P2.4  Persist telemetry
  P2.5  Remove/wire DISCOVERY_PROMOTED_SOURCES
  P2.6  Lock CollectionJobStore.mutate

Week 4 (product honesty)
  P3.1  Decide identity model (accounts vs shared-key beta)
  P3.2  Retire or demote InteractiveTerminal
  P3.3  Remove/gate Puter.js
  P3.4  Wire underwriting UI on detail page
  P3.5  Remove Deal Video mockup
  P3.6  Drop dead routes

Out of phase (per reports)
  Public subscriptions, onboarding, payments, email/SMS, auction bidding
```

---

## Doc contradictions to resolve (low priority, high confusion)

1. Sticky `promoted` rows (2026-09-08) vs. Migration 014 withdrawn approvals —
   HUD/IRS/Treasury/USDA/GSA show `promoted` but are effectively canary.
2. IRS 09-07 "promoted" vs. 09-12 "must not be promoted" — the 09-07 language
   softened parser rejections that 09-12 treats as blocking.
3. Treasury clean-run count: table says 2, body says 4.
4. `reo-portal-failures.md` lists HUD as broken; HUD was fixed 09-07.
5. Disk-space narrative: 1 GB free (stopped) vs. 26.9 GB free (still stopped) —
   the reserve is no longer the active blocker; the disabled-collection decision
   is a policy choice.
