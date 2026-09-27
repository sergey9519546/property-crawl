# IRS live canary — 2026-09-27 (repaired infrastructure, honest NOT_CLEAN)

The 2026-09-20 close-out path said: *"IRS may become promotable when
publisher lists real-estate assets again; rerun `canary:live run --sources
irs --repeat 2`."* This is that rerun, with the canary pipeline repaired
first so the result reflects the publisher, not broken tooling.

## Infrastructure repairs required to run it

Two verify-before-listen bugs blocked standalone canary entrypoints from
reaching the Postgres discovery store (Migration 014):

1. **`scripts/discovery-worker.js` guard order** — `run()` threw on
   `!database.isPg` before anything had called `verifyConnection()`, so the
   canary failed even with `DATABASE_URL` + `DISCOVERY_MODE=advanced` set.
   Fix: verify explicitly, then fail closed only if verification fails.
2. **Collection coordinator job-store split** — the scheduler's singleton
   coordinator was constructed at module load (before verification) and
   kept an in-memory job store while the canary created its job in the
   Postgres discovery store → "Collection job was not found". Fix: rebuild
   the coordinator against the verified database when it still holds the
   in-memory store (test doubles without a `store` are untouched).

After both fixes: `[DB] PostgreSQL connection verified`, jobs round-trip
in Postgres, and the IRS collector performed real live fetches.

## Result

| Run | Live fetch | Cards found | Accepted | Verdict |
|---|---|---:|---:|---|
| 1 | irs auction list page | 0 | 0 | NOT_CLEAN — accepted must be > 0 |
| 2 | irs auction list page | 0 | 0 | NOT_CLEAN — accepted must be > 0 |

`[IrsAuctionCollector] Found 0 real-estate auction cards on list page`
in both runs — the publisher currently lists no real-estate assets.

**Decision: IRS stays unpromoted.** Empty publisher inventory is not a
clean canary (policy). This is the correct fail-closed outcome on real
evidence; the earlier NOT_CLEAN (2026-09-20) is now confirmed against a
working pipeline.

Machine evidence: `.cache/canary-reports/canary-2026-09-27T09-11-25-910Z-cc6b7d2f.json`
(clean=0, distinctRunIds=0 → no promotion; exit 1 STRICT gate held).

## gsa — unchanged

gsa remains NOT_CLEAN on the publisher robots exclusion on `/our-listing`
(collector fail-closed; `SCRAPER_RESPECT_ROBOTS` override is operator-only
and not used). See `reports/canary-not-clean-gsa-irs-2026-09-20.md`.

## Still promoted (prior evidence)

treasury · usda · hud(OH,NJ) · servicelink
