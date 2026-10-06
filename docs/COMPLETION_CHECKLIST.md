# Completion checklist — the single source of truth

Replaces the four parallel status documents this file absorbs. Those are kept
for their evidence but are **not** status sources any more:

| Absorbed | What it held |
|---|---|
| `docs/OPEN_RESIDUALS.md` | CSP + IRS canary close-outs, source-policy items |
| `docs/PRODUCT_GAPS.md` | per-gap closed/open inventory |
| `docs/ULTRAPLAN.md` | WS-A…WS-G workstreams, phases 0–6, risk register |
| `docs/RELEASE_RUNBOOK_ZERO_COST.md` | $0 deploy, rollback, operator security notes |

They rotted the same way: each grew its own "still open" table, so the same
item was listed as open in one file and closed in another. `PRODUCT_GAPS.md`
carried three rows under **Still open** whose own status column read *Closed
2026-09-27* — CSP `style-src`, the live-Postgres round-trip, and the session
work commit. A reader scanning that heading got three false opens.

**One file, one open list.** States are:

- **CLOSED** — has a file, a test, or a run bound to a tree.
- **BLOCKED-EXTERNAL** — cannot be closed from this repo. Named owner below.
- **POLICY** — deliberately not done. Not a backlog item.

## Verification: what is actually true right now

Generated, not hand-written. `npm run release:gate` is the thing that keeps
this section true; numbers here are transcribed from it and a guard test fails
if the seed count drifts.

| Fact | Value | Source |
|---|---|---|
| Tree | `bcc9b6b` | `git rev-parse HEAD` |
| Release gate | **9/9**, E2E 25/25, clean tree | `npm run release:gate` |
| Test runners green | **26/26** | every `test:*` script |
| Seed listings (`data.js`) | **2095** | `scripts/gen-context.js` |
| Source catalog entries | **163** | `server/sources/catalog.js` |
| Dispatched API paths | **41** | `server/server.js` |
| Scrapling parser tests | **16** | `npm run test:scrapling-parser` |

## Open work, in dependency order

Nothing below depends on anything later in the list.

| # | Item | Depends on | Blocked by |
|---|---|---|---|
| 1 | **PP-01** corrupt persisted stores: user/operator visibility + no silent overwrite | — | — |
| 2 | **PP-02** source-bound release gate | — | — |
| 3 | **PP-03** real isolated PostgreSQL: discovery/contracts, restart durability, lease loss/retry/worker soak | #2 | a separate Postgres *server* for the 2 row-lock tests; the embedded engine now covers everything else |
| 4 | **PP-03** browser journey: operator unlock → hunt → evidence/document review → saved-search → export, on desktop, mobile and keyboard, with a11y/CLS/LCP | #3 | a running stack + an operator credential |
| 5 | **PP-04** production persistence/backup-restore proof | #2 | the deployed instance |
| 6 | **PP-04** operator config, Maps key restriction, form delivery | #2 | GCP console / endpoint accounts |
| 7 | **PP-04** public domain + HTTPS/CSP proof on the live host | #5, #6 | the deployment |
| 8 | **PP-05** commit the release ledger + rollout/rollback handoff | #2, #7 | an actual release |

### Status of 1 and 2

- **#1 PP-01 — CLOSED.** A corrupt store loaded empty and the next write
  persisted that emptiness over the file: one bad store plus one user action
  deleted every saved search, alert match and review. Stores now move an
  unreadable file aside (`<name>.corrupt-<ts>`) before anything can write over
  it, block writes if the move fails, and report the reason on `/api/health`,
  `/api/saved-searches` and the document-review list.
  `test/corrupt-store-no-silent-overwrite.test.js`.
- **#2 PP-02 — CLOSED.** `scripts/release-gate.js` runs the gate in order
  against one SHA and writes `reports/release-gate-ledger.json`. A dirty tree is
  reported as *not* a source-bound result rather than passing quietly.

## Blocked outside this repo

These cannot be closed by writing code here. Each names what would unblock it.

| Blocker | Owner | Unblocked by |
|---|---|---|
| Isolate a real PostgreSQL **server** and run discovery/contracts, restart durability, lease-loss/retry/worker soak | infra | see the exact state below; the embedded engine covers the rest |
| Full browser journey incl. operator unlock | operator | a **clearly synthetic local credential** if the supported auth contract allows one. Do not weaken auth, and do not expose a production key to obtain browser evidence. |
| `.cache` durability across redeploys | infra | a mounted volume; Koyeb disk is dashboard-only |
| Fly/Koyeb operator secrets | operator | values set in the host dashboard |
| Form webhook delivery | operator | `NEWSLETTER_ENDPOINT` / `CONTACT_ENDPOINT` |
| Google Maps key restriction | ops | GCP console |
| Public live URL + custom domain | operator | DNS |
| Production HTTPS CSP verification | operator | a live HTTPS boot; `upgrade-insecure-requests` is HTTPS-only |
| Lawyer review of `/privacy` `/terms` | legal | counsel |

### Exact state of the PostgreSQL blocker

Verified on this machine, not assumed:

- `.env.local` already names `DATABASE_URL=postgres://***@localhost:5432/property_crawl`.
- **Nothing is listening on 5432**, and there is no PostgreSQL install on disk.
- No in-memory Postgres is available (`pg-mem`, `embedded-postgres`,
  `@electric-sql/pglite` are all absent).
- **Docker Desktop is installed and its WSL2 distro is provisioned** — but
  `com.docker.service` is **Stopped**, and starting it requires an elevated
  token. The agent session is not elevated, so this cannot be self-served here.

**Unblock:** start the service once from an elevated shell
(`Start-Service com.docker.service`) or launch Docker Desktop as
Administrator, then:

### PostgreSQL: how the database is now served

`DATABASE_URL` still names `postgres://***@localhost:5432` and **nothing listens
there**: no PostgreSQL install on disk, and `com.docker.service` is **Stopped**
and needs an elevated token this session does not have. That part is unchanged.

What changed is the consequence. Previously an unreachable database fell back to
a seeded in-memory catalog, so a broken database was indistinguishable from a
working one holding 2,095 rows. **That fallback is gone.** `dataMode()` is
`postgres`, `memory` (only under `NODE_ENV=test` or an explicit
`PROPERTY_INVENTORY_BACKEND=memory`) or `unavailable`, and with no database the
listing API returns `503` carrying the reason instead of an empty result that
reads as "no listings match".

To get a real database without elevation, the API can run the **embedded
PostgreSQL engine** (`PROPERTY_DB=embedded`, `.cache/pgdata`): a genuine
PostgreSQL build with PostGIS 3.6, persisted to disk, surviving restart. It is
embedded in the API process and single-connection — enough for this operator
beta, not a substitute for a real server under concurrent load. Point
`DATABASE_URL` at a real server and this code is never loaded.

Verified against it, not assumed: the full `schema.sql` plus all 16 migrations
apply (33 tables), `FOR UPDATE SKIP LOCKED` job claiming runs, transactions
commit and roll back, errors carry SQLSTATE, and rows survive a close/reopen.

For the tests that need a **separate server** — the two skipped
`discovery-job-fence` and `discovery-promotion-evidence` tests, which are the
only coverage of job-ownership fencing against real row locks — the embedded
engine's single connection is not enough, and a real server is still required:

```
docker run -d --name pp-pg -e POSTGRES_PASSWORD=property-local-dev \
  -p 55432:5432 postgis/postgis:16-3.4
$env:DISCOVERY_TEST_DATABASE_URL='postgres://postgres:property-local-dev@127.0.0.1:55432/property_crawl'
npm run test:discovery:operations:pg
```

**CI `continue-on-error` is not release evidence.** Jobs that carry it are
advisory and cannot close anything in this table.

## Inventory state

The live record store was last written **2026-09-19**; the collector has not run
since, so everything in it was 16–31 days old when reviewed on 2026-10-05. That
is a freshness gap, not a set of per-row verdicts, and the two are kept apart:

- `/api/health` now carries `inventoryFreshness` (newest observation, age in
  hours, `stale` past 24h) and the banner says so on every page.
- Removal uses `server/db/listing-lifecycle.js`, which deletes **only** on a
  publisher's own word that the event finished (closed / cancelled / auctioned /
  rescinded, or an `endDate` already past). The current ledger
  (`reports/pruned-listings.json`, written 2026-10-06) records **1,750 removed
  and 7,976 remaining** from 9,726, broken down as 566 cancelled, 307 auctioned,
  151 closed and 726 with a past `endDate`. **The ledger is the source of truth
  for these numbers** - it is rewritten on every `--apply`, so do not quote
  figures here that it does not currently contain.
- Deliberately kept despite a signal that could have removed them: 274 records
  whose status says *postponed* while carrying a pre-postponement date (the
  rescheduled date is not in the record), and 148 whose `sale_date` is past with
  no publisher terminal status. Deleting a live auction to tidy a table is the
  expensive mistake.

The ServiceLink material under `.cache/reference-audit/servicelink/` (210 files,
20 MB) is **reference input**, not inventory: nine user-supplied PDFs/CSVs/JSONs
holding at most 3 sample listings and 26 auction-run rows, used to build the
parser against the publisher's real shape. The collector reads the live public
API, and no record derived from that download is in the database.

## Playwright UI suite — 48 of 53, with the rest diagnosed

Not in `scripts/release-gate.js`, so the 9/9 does **not** cover it. It went
from 8 passing to 48 during the database work; the five that remain each have
a known cause, recorded here so the diagnosis is not lost with the session.

| Test | Cause |
|---|---|
| `street_view_uses_same_origin_images_and_explicit_context_disclosure` | Four stacked fixture bugs, three fixed and verified: The app asks for **`mode=walkthrough`**, but the mocks only recognised `mode=metadata`, so the disclosure request fell through to the image branch and came back as a PNG the parser rejects. The alternative-imagery probe (`mode=alternatives`) hits the same route and was also answered with a PNG, so `response.json()` threw. And Street View is refused outright without validated current coordinates, while `primary_listing` has `lat: null`. **A fourth** only shows up after those: the mocked metadata has no `panoramaId`/`panoramaLocation`, so the component has no embed to point at and never reveals the disclosure - with those added the disclosure renders and the test reaches its last assertion. That last one (`assertTrue(image_requests)`) needs the interactive embed to actually load, which needs a Google Maps key the harness deliberately blanks. So this test cannot pass in this harness as configured, and none of its fixes are committed. |
| `feed_street_view_is_on_demand_preserves_attribution_and_recovers_from_failure` | The same four defects, in its own fixture. Its `media_response` answers the first request with `available:false` and then branches on `"mode=metadata" in url` - which the app never sends, because the disclosure path asks for `mode=walkthrough`. So the retry can never succeed, and the fixture carries no `panoramaId` either. |
| `detail_mobile_content_and_media_controls_are_not_clipped` | **Fixed.** Two distinct watchlist implementations were being conflated. The feed card's watchlist is a local per-browser list that really does persist across a reload; the detail-page toggle POSTs `/api/alerts`, which is **operator-gated** (401, then `session.requestUnlock()`). The detail test now asserts the honesty contract for the gated path - a refused save must not present as saved - and locates the toggle by `aria-pressed` rather than by label, because the label changes to "Updating watchlist." the moment it is clicked. |
| `saved_search_persists_and_opens_matching_inventory` | Same cause. The modal now says *"Unlock the workspace to use saved searches and alerts"*; the old *"Search saved on this browser."* copy is gone because the **behaviour** is gone. |
| `notice_parser_extracts_a_real_notice_and_adds_it_to_watchlist` | Also watchlist-gated, and its own assertion did not reproduce under direct probing. |
| `property_underwrite_watchlist_and_export_journey` | Passes the drawer heading and analyze step; fails later on the MAO tab. Not diagnosed. |

Two assertions were deliberately **left weaker** and are called out here rather
than presented as passing:

- The feed honesty banner test only checks `observed + unverified == total`, so
  an over- or under-claim passes. Grounding the split needs the full inventory;
  the public API caps `limit` at 1000 and the feed loads through a different
  path. Attempted, could not be verified, reverted.
- The header brand-overlap test passes whether or not the `min-w-0` fix is
  present at current logo metrics, so that fix is currently inert.

## Source limits — POLICY, not backlog

Deliberately not promoted. They are not gaps, and closing them would be a
regression.

| Source | Limit |
|---|---|
| `gsa` | publisher robots exclusion on `/our-listing`. Collector is fail-closed; there is an operator-only override that is **not** used. |
| `irs` | Live canary found **0 real-estate auction cards** on two distinct runs → `NOT_CLEAN`. Empty publisher inventory is not a clean canary. `reports/canary-irs-2026-09-27.md` |
| `hud` | Stays at its declared OH/NJ promoted run scope. A nationwide sweep is not promoted. |

## Do not do

One list, previously duplicated across all four documents.

- Do not promote `gsa`, `irs`, or a nationwide HUD sweep to clear a checklist.
- Do not treat a green unit gate as a live-Postgres or production-secret close.
- Do not hand-cite counts in this file. Transcribe from `release:gate`; a guard
  test fails if the seed count drifts.
- Do not open a second status document. Add a row here.
- Do not reintroduce work already closed above. ServiceLink full-pagination
  promotion, the CSP nonce work, and the live-Postgres contract fixes are done;
  their evidence lives in the absorbed docs.

## How this file is kept honest

- `npm run release:gate` regenerates the facts and fails if CONTEXT.md, the
  schema mirrors, or the build are stale.
- `test/docs-checklist-honesty.test.js` fails if this file's open list contains
  a row that claims to be closed, if the seed count disagrees with what
  `gen-context` computes, or if an absorbed doc reintroduces itself as a status
  source.