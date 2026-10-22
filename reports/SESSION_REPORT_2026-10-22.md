# Session report — 2026-10-22 (Fable 5.1 orchestrator)

Scope: independent read of the project, one decision, executed and verified.
Tree: `c6e4f08` (trust unit) → `d197a1d` (migration-ledger fix), both deployed.

## 1. The five synthesis points (post-adversarial)

1. **What the project is for.** An evidence-first triage layer that tells a buyer
   whether a distressed or government-sold listing is actually a deal and what the
   catch is; honesty (never present a filing as a sale, never invent a value, fail
   closed without configuration) is the differentiating promise.
2. **Where it actually stands.** The engine is rebuilt and honest (8 signals,
   PostgreSQL observation store, triage refresh, assessor harvest, data-calibrated
   bands), but three things were true at once: none of it was deployed; production
   was serving 221 DISCOVERY_ONLY records as listings; and one operator surface
   failed open. The adversarial review added the fact that mattered most — the
   branch was unpushed, so the "reality" being described was not the product.
3. **Three biggest gaps.** (a) Trust violations live in production while the fixes
   sat on an unpushed branch. (b) A class defect: the codebase writes true
   statements (caveats, catalog statuses, enrichment flags, assessed values) that no
   reader enforces, so they drift into lies. (c) The core question is unanswerable
   for ~all listings without valuation input — partly data acquisition, partly the
   same unread-field plumbing.
4. **Previous sessions' verdict.** The verification discipline was right and still
   works, but gates certify *trees, not data*: the contamination, the county
   mislabeling, and the fail-open branch all passed green gates.
5. **What nobody wrote down.** "Done" ≠ "shipped" (the green-HEAD/unpushed-branch gap
   appears in no status doc); the gates-certify-trees-not-data blind spot; and 101
   in-store assessed values invisible to the evaluator.

## 2. Decision record

```
DECISION: Ship the trust-restoration unit and deploy it — class-level
DISCOVERY_ONLY admission at admission and serving, decision-packet
fail-closed, FL-DOR situs resolution — then push so production picks it up.

WHY THIS, NOW: contamination was VERIFIED live and compounding through SEO;
the fixes were VERIFIED green but undeployed; the standing re-measure
instruction required production cycles that could not start without a push.

WHAT I AM NOT DOING: valuation enrollment (enabled by this deploy; re-measure
first), Stripe persistence (deliberately non-functional), Zyte hardening (no
callers), doc rewrite as the primary move (done as fast-follow with guards),
store purge (destructive; the serve gate suffices).

WHAT WOULD CHANGE MY MIND: a product decision that docket filings become a
labeled pre-foreclosure leads surface; an instruction not to change production.

RISK: the gate could hide records operators used — mitigated: records stay in
stores and on /sources. FL-DOR could corrupt real Collier parcels if resolved
naively — mitigated: situs evidence + cross-check + tests.

HUMAN CHECKPOINT: yes (commits, push, production deploy) — approved.
```

## 3. What was executed (VERIFIED)

| Item | Status | Evidence |
|---|---|---|
| DISCOVERY_ONLY admission gate (class-level, 5 choke points) | VERIFIED | `servesListings()`/`isDiscoveryOnlySource()` in `server/sources/catalog.js`; wired at `scheduler.js:80`, `query.js:236`+`:399`, `client.js:1914`+`:1998`, `routes/listings.js:265`; `test/listing-serving-gate.test.js` 11/11 |
| Production no longer serves filings/parcels | VERIFIED | live `/api/listings?source=courtlistener` → `total=0`; `?source=fl-dor-cadastral` → `total=0`; servicelink 7498 (control) |
| Records preserved (non-destructive) | VERIFIED | store still holds 120 + 101; `/sources` evidence path ungated |
| Decision-packet fails closed | VERIFIED | `server/routes/decision-packet.js`; 20/20 route tests; 598/598 evidence-truth |
| FL-DOR county from situs evidence | VERIFIED | `server/scrapers/fl-dor-cadastral.js` header + resolution; 16/16 tests |
| Source-bound release gate on the unit | VERIFIED | 9/9 against `c6e4f08`; re-run 9/9 at `d197a1d` |
| Suites at the unit | VERIFIED | test:db 138/138, test:discovery 74/0 fail, test:intelligence 633/633, test:evidence-truth 598/598, test:ops 226/226 |
| Docs corrected | VERIFIED | `memory/facts.md`, `AGENTS.md`, deal-scoring SKILL, checklist facts, snapshot title |
| Production deploy | VERIFIED | deploys list: `d197a1d` live; health `dataMode=postgres`, `observationStore=postgres`, no error |
| Migration-ledger wedge (found in production) | VERIFIED + FIXED | migrator re-records drifted digests; `test/db/migration-ledger-drift.test.js` 2/2 |
| `AUTO_MIGRATE=1` on the live service | VERIFIED | Render API; was absent, which is why migrations never self-applied |

## 4. Phase 1 findings — real but not addressed (ranked)

1. **Scrapy-ingest Postgres path bypasses the ingestion gate** and swallows per-item
   failures; the 200's `accepted` counts a live-store merge that Postgres mode never
   serves. A signed-but-malformed batch reads as delivered and can persist unvalidated rows.
2. **`render.yaml` vs live service divergence** (`PROPERTY_DB=embedded`, `AUTO_MIGRATE`)
   — a blueprint sync would override `DATABASE_URL` and make production serve an empty
   embedded database. Owner decision.
3. **Valuation input at scale** — the 30% ratio component resolves for ~none of the
   inventory; the harvest is installed but needs collection cycles and county breadth
   (only 172 of 10,285 live records sit in the five conversion counties).
4. **Stored FL-DOR county labels** keep the pre-fix `Collier` value (hidden by the gate;
   a backfill was deliberately not performed).
5. **Document review queue** now excludes gated records via `getListings` (deliberate).
6. **Stripe bills nothing** — signature verification is correct but no receipt,
   fulfillment, or dispute record exists.
7. **Zyte SSRF** accepts IPv6-mapped loopback/private literals; zero production callers.
8. **No nonce/timestamp on the public ingest HMAC** — a captured request replays
   indefinitely (bounded by idempotent upserts and the 2 MB cap).
9. **In-place edits of applied migrations are still a live hazard**: the ledger now
   self-heals, but the repo convention that produced the incident is unstated.

## 5. Doc claims found stale (and what was done)

| Doc | Claim | Action |
|---|---|---|
| `memory/facts.md` | 6 signals; 1–99; in-memory fallback; 35 scrapers; seed 2093; CSP/live-PG open | FIXED |
| `AGENTS.md` | in-memory fallback "whenever DATABASE_URL is unset"; 9 property types | FIXED |
| `.agents/skills/deal-scoring/SKILL.md` | "six evidence signals", "bounded 1–99" | FIXED |
| `docs/COMPLETION_CHECKLIST.md` | tree `486524e`; no row for the signals/gate workstream | FIXED (rows + `c6e4f08`, then `d197a1d`) |
| `reports/release-gate-snapshot-2026-10-21.md` | title tree `0f9bcc8` vs body `2c99e62` | FIXED |
| reports/triage-evaluator-fixes-2026-10-21.md | `test:db 97/97` vs commit message 106/106 | LEAVE (both were true at their moment; historical) |
| `docs/OPEN_RESIDUALS.md`, `PRODUCT_GAPS.md` | "current seed 2093"; CSP open | FIXED (already corrected by the concurrent session's cutover commit — re-verify before reuse) |

## 6. Open questions for the human

1. **Docket filings: filter or feature?** They are now hidden from listings.
   A labeled "pre-foreclosure lead" surface is a product decision the constitution
   defaults against; say the word and it becomes a scoped follow-up.
2. **Render blueprint sync**: `render.yaml` disagrees with the live service
   (`PROPERTY_DB`, `AUTO_MIGRATE`). Align them deliberately — do not sync as-is.
3. **Production operator token**: the live service generates its own
   `SCRAPER_ADMIN_TOKEN`; `adminpass0816` is local only. Rotate/align if desired.
4. **Valuation breadth**: which counties to enroll next (172 of 10,285 live records
   are covered by the five conversion counties today).
