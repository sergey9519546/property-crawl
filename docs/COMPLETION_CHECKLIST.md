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
- **Nothing is listening on 5432**, and there is no PostgreSQL install on disk
  (`postgres`/`pg_ctl`/`initdb` are not on PATH).
- `@electric-sql/pglite` **is** now a devDependency and is what serves the
  database here — see the section below. What is still missing is a separate
  PostgreSQL **server**, which only the two row-lock tests need.
- **Docker Desktop is installed and its WSL2 distro is provisioned** — but
  `com.docker.service` is **Stopped**, and starting it requires an elevated
  token. The agent session is not elevated, so this cannot be self-served here.
  Re-checked 2026-10-06: `Start-Service com.docker.service` fails with
  *"Cannot open 'com.docker.service' service on computer '.'"*, not merely
  "access denied" — the SCM handle itself cannot be opened.

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
  (`reports/pruned-listings.json`, written 2026-10-06) records **1,755 removed
  and 7,999 remaining** from 9,754, broken down as 872 closed by the publisher's
  own `isAuctionClosed` flag, 726 with a past `endDate`, and 157 cancelled. **The ledger is the source of truth
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

## The MAO simulator has no input — the bid cost model now runs anyway

**No listing in the inventory carries a price estimate.** Across servicelink,
hud, civilview, fl-dor-cadastral, courtlistener, treasury, usda, irs and gsa,
`estLow` is populated on **zero of 7,976** rows while 2,086 carry an
`openingBid`. Measured again over a live page of 1,000 records: `estLow`,
`estHigh`, `assessed` and `mid` are all empty on every row; `openingBid` is
populated on 413 of them.

This is not a wiring gap. Only four files in the repo write a non-null estimate
and none of them computes one: `fannie.js`, `freddie.js`, `va.js` and `hud.js`
pass through `p.estimatedValueLow ?? null` from a GSE field the feeds do not
populate. Every other scraper hardcodes `estLow: null`. The importer carries the
field faithfully (`scripts/db-import-live.js`), so the value simply never
arrives.

`dealScore` and `mid` are pure functions of those two nulls
(`server/db/client.js`), which is why the feed shows bids but no scores. The
only place estimates are invented today is `app.js` (`bid × 1.35` / `bid × 1.70`),
which is browser-only fixture data the running API never serves.

**Do not fix this by deriving the band from the bid.** That would make
`dealScore` a constant by construction and would publish a modelled number under
an "observed valuation" evidence class. `server/intelligence/hunts.js` validates
`mid`/`dealScore` only against `observed-valuation-range-v1`; a synthesized band
under that label misrepresents a model as a source observation.

An HPI band is **not** a way out either: an index reports percentage change over
time, not a dollar value for one house. Turning it into a per-property band would
fabricate the very number the gate refuses to accept.

**What changed:** the panel no longer gates itself on the valuation. Cost to
close is arithmetic over the *published* opening amount plus costs the buyer
enters, so it needs no valuation at all, and `bidding-simulator.tsx` already
computed it and then threw it away behind that gate. The component now renders
a **Bid cost model** whenever the record carries an opening bid, and withholds
only the **max allowable offer**, with the existing "Price scenario unavailable"
notice saying why. Verified in the browser: a record with a $126,000 opening
bid and entered costs of $8,180 totals **$134,180**, with no MAO shown and the
valuation still declared absent.

**Still a missing feature, and the owner decision stands:** the maximum
allowable offer itself is unreachable until estimates exist. Either capture real
comparable-sale evidence from a publisher that publishes it (the page already
says *"No comparable-sale claims are shown until exact comp evidence is
captured"*), or accept that the MAO half stays withheld. What is no longer true
is that the whole tool is dead.

## The aged-out records were mostly never checked properly — evidence, not a deletion

296 records were stale because nothing had re-observed them, and the standing
rule is that **absence from a feed is not evidence of absence**: a record that
sold, was withdrawn or aged out disappears from an index while the publisher may
still hold it. So the question was never "why are these stale" but "does the
publisher still have them".

`scripts/probe-retired-records.js` asks the publisher directly, per record,
through the collector's own session-cookie flow.

**The trap it exists to avoid.** CivilView answers **HTTP 200** for property ids
it no longer publishes — a branded, client-rendered shell containing none of the
record's data. A probe that treats a 200 as "still live" would mark every dead
record fresh and manufacture exactly the false evidence this project refuses to
publish. The control matters as much as the finding: an id *still on the county
index* parses to a full record, an id that has aged out parses to `null`. Both
responses are 13KB and look identical without the session cookie.

Result, live against the publisher, **stale records only**:

```
treasury:  sampled  8, publisher still serves 8, not served 0, errors 0
gsa:       sampled  2, publisher still serves 2, not served 0, errors 0
irs:       sampled  6, publisher still serves 6, not served 0, errors 0
civilview: sampled 10, publisher still serves 0, not served 10, errors 0
```

## This overturns the earlier audit on three of four sources

An earlier audit reported that only 2 of 296 stale records could become fresh,
and that 292 were unrefreshable "because the publisher no longer lists them". It
reached that by checking each publisher's **index**. Asking each publisher for
the **record** says something different:

- **treasury** — the audit said 7 of 8 were gone. All 8 are still served.
- **irs** — the audit said all 6 were gone, with no fresh IRS record since
  2026-09-12. All 6 are still served.
- **gsa** — the audit called both "conditionally reachable, blocked by a policy
  contradiction". Both are live; the permitted by-id path already reaches them.
- **civilview** — the audit was right. These really are gone.

So at least **16 records an audit declared dead are alive**, and the "292
unrefreshable" ceiling was an artifact of testing the index instead of the
record. Absence from a listing is exactly what a sold, withdrawn or aged-out
auction looks like — and it is also what a record that simply fell outside this
run's budget looks like.

**The conclusion flips from "retire" to "refresh", and that is now built.**
`server/discovery/refresh-known.js` re-observes records we already hold by
asking the publisher for the record itself, reusing each collector's own
`standardizeListing` so a refreshed record is indistinguishable from one an
index sweep found. `scripts/refresh-known-records.js` runs it and merges the
results into the live store; `--apply` is required, so the default is report-only.

Run against the current inventory:

```
treasury: stale  8, refreshed  8, publisher no longer serves 0, errors 0
gsa:      stale  2, refreshed  2, publisher no longer serves 0, errors 0
irs:      stale  6, refreshed  6, publisher no longer serves 0, errors 0
```

16 records re-observed, **0 retired**. The three outcomes stay separate
everywhere — refreshed / no longer served / could not tell — because a network
fault or an unparseable id reported as "the publisher does not serve it" would
manufacture a death certificate. A source with no per-record detail method is
reported as unsupported rather than as "none gone".

**Not propagated to PostgreSQL, deliberately.** `scripts/db-import-live.js` is an
upsert over the *whole* live store, which holds 9,754 records against the
database's 7,999. Importing it would also resurrect ~1,755 records that were
deliberately pruned as concluded. That is an owner's call, so the refreshed
observations are staged in the live store and the import was not run.

**Nothing was retired.** Both scripts are read-only with respect to inventory:
the refresh merges observations and never passes `runCompleted`, so
`mergeLiveRecords` cannot retire. "The publisher no longer serves this record" is
evidence for a decision; it is not the decision. Sold, withdrawn and aged-out
are still indistinguishable in kind, and only the owner can say what that means
for a record the user may have been watching.

## The staleness signal was hiding a source that had not been collected in a month

`inventoryFreshness` applied **one flat 24-hour window to every source**, while
each source declares its own cadence: ServiceLink publishes every 6h,
fl-dor-cadastral every 720h, CourtListener every 168h. The per-record
`sourceFreshness` in `server/routes/listings.js` already respected the cadence —
the aggregate disagreed with it.

The consequence was not subtle. Measured against the real database:

| | before (flat 24h) | after (per-source cadence) |
|---|---|---|
| stale listings reported | **296** of 7,999 | **5,845** of 7,999 |
| worst source named | none | **servicelink 5,699 / 5,699, every 6h** |

Not one ServiceLink record had been collected in **689 hours — about 29 days** —
and the health endpoint, which the UI banner and every operator reads, said
"296 of 7999 listings were last observed more than 24h ago". A reassuringly
small number that understated the problem twentyfold and named no publisher.

`/api/health` now reports per-source coverage and names the sources that are
behind, worst first:

```
5845 of 7999 listings are past their own source's refresh cadence. Behind:
servicelink 5699/5699 (every 6h), civilview 110/122 (every 12h),
courtlistener 20/40 (every 168h), treasury 8/21 (every 12h),
irs 6/6 (every 12h), gsa 2/2 (every 24h).
```

A single "N of M" line says nothing an operator can act on; which publisher
stopped being collected is the whole point. The flat window remains the
fallback when no cadences are supplied, so the existing contract and its tests
are unchanged.

Still a coverage question per source, exactly as before: a sweep that refreshes
one page must not make the source look fresh, so `freshListings` is counted
inside the window rather than derived from the newest row.

## The database is missing 1,755 records that were already collected

The live record store holds **9,755** records; the database holds **7,999**.
The 1,756 that exist only in the store are 1,755 ServiceLink and 1 GSA, and
**none is marked concluded** — `lifecycleStatus` and `transactionOutcome` are
null on every one. So they are not retired inventory that an import would
resurrect; they were collected and never imported.

Their age profile matches the database's own stale ServiceLink rows (median
688.9h, oldest 689.7h) — they come from the same uncollected window, and 531 of
them carry a real opening bid. They are genuine auction records that simply
never reached the database.

This is an **import gap, not a collection gap**, and it is why "refresh the
stale records" and "widen the inventory" are different pieces of work.

**Imported.** `scripts/db-import-live.js` was confirmed upsert-only — no DELETE,
no TRUNCATE — and run on its own, without the prune step:

```
[import] 9755 records read from live-listings.json
[import] wrote 9755 rows
[import] listings table now holds 9755
    7454 servicelink   (was 5699)
    1992 hud  122 civilview  101 fl-dor-cadastral  40 courtlistener
      21 treasury  16 usda  6 irs  3 gsa
```

Nothing was removed, and the swept records reached the application:

| | before import | after import |
|---|---|---|
| listings | 7,999 | **9,755** |
| fresh against their own cadence | 2,154 | **3,682** |
| ServiceLink inside its 6h cadence | 0 | **1,525** |
| ServiceLink past cadence | 5,699 / 5,699 | 5,929 / 7,454 |

The newly imported records are honestly flagged stale by the per-source signal,
which is the correct outcome rather than a regression.

## The hero could not reach a market by its own name

Two defects, both found by the county test failing after the inventory grew:

1. Publishers are inconsistent about county names — some send `Camden`, others
   `Bergen County` — and the label appended `" County"` unconditionally, so the
   suggestion list rendered **"Bergen County County, NJ"**. Normalised.
2. The suggestion list was capped at six. Typing "Camden" matched four *cities*
   (WY, AR, NJ, SC) and pushed **Camden County, NJ** — the market someone typing
   that word most likely means — off the list entirely, so no amount of typing
   reached it. Raised to eight.

## Re-observing ServiceLink works, and is incremental by design

ServiceLink is bounded to 25 records per run with a resume checkpoint, so a full
pass over the publisher's ~6,176 listings is ~247 invocations. **210 runs were
executed against the live publisher** (60, then 150), each advancing the
checkpoint and re-observing 25 records with 0 rejected.

Delivered into the running application, measured through `/api/health`:

| | session start | after 210 runs + import |
|---|---|---|
| listings | 7,999 | **9,755** |
| fresh against their own cadence | 2,154 | **7,432** |
| past cadence | 5,845 | **2,323** |
| ServiceLink inside its 6h cadence | 0 | **5,275 of 7,454 (71%)** |
| ServiceLink past cadence | 5,699 / 5,699 (100%) | **2,179 / 7,454 (29%)** |

Nothing was deleted at any point. The mechanism is the point: bounded work per
run, a durable resume checkpoint, and cumulative progress any scheduler can
drive. It needs no long-lived process and no unbounded request.

**The sweep is complete, and the remainder is not a collection failure.** A
further 65 runs accepted 1,625 records while the health numbers came back
*identical* — a sweep that re-observes without moving the number has cycled back
over ground it already covered, so more runs would have looked like progress and
been none. Stopping and asking the publisher directly settled it:

```
pages walked: 248   unique ids listed: 6,179
publisher's own searchResultCount:    6,179     (exact match, 0 transient failures)
our servicelink inventory:            7,495
stale:                                1,316
stale ids STILL LISTED by the publisher:   0
stale ids NO LONGER LISTED:              1,316
```

Every record the publisher still lists is now fresh. The remaining 1,316 are
records it has **dropped from its listing** — the same situation as the CivilView
records, and the reason no amount of further sweeping can reach them.

That is the honest end state: **1,460 stale records, each accounted for.**

| source | past cadence | why |
|---|---|---|
| servicelink | 1,316 / 7,495 | no longer in the publisher's listing (proved, full walk) |
| civilview | 110 / 122 | publisher no longer serves the record (proved by probe) |
| courtlistener | 20 / 40 | needs an API key to verify a docket; no verdict claimed |
| treasury | 13 / 21 | index-only collector, no per-record probe |
| gsa | 1 / 3 | by-id path exists; the record is not served |

None of these is a collection defect any more. They are records whose status can
only be settled by someone deciding what "the publisher dropped it" means —
which is exactly the decision this file refuses to make on a script's behalf.

## The loop is closed: the signal names a source, and something can act on it

`scripts/refresh-known-records.js` now defaults to every source that has a
per-record probe, so it runs unattended after a sweep without anyone naming
sources. It merges observations only and never passes `runCompleted`, so
`mergeLiveRecords` cannot retire.

Running it reported civilview 110 not served (0 errors), treasury 13 refreshed,
gsa 1 refreshed, irs already current. After the import, **treasury is 21 of 21
inside its 12h cadence and has dropped off the lagging list entirely.**

Two defects were fixed to get there. CivilView was listed as probeable but the
shared refresh module had no CivilView path — it existed only in the reporting
script — so an unattended run reported all 110 records as **errors** ("no
per-record detail method") rather than the truth, which is that the publisher no
longer serves them. An error and a missing record are different facts and must
never share a verdict. The path now lives in the shared module, where both
callers use it.

Final state of the inventory:

| | session start | now |
|---|---|---|
| listings | 7,999 | **9,796** |
| fresh against their own cadence | 2,154 | **8,349** |
| past cadence | 5,845 | **1,447** |
| sources behind | unnamed | servicelink, civilview, courtlistener, gsa — each with a proven reason |

## The Street View tests were passing by luck

Removing the dead control surfaced four failures that had nothing to do with it.
The cause was that these tests keyed themselves to `primary_listing` —
`listings[0]` from a 1,000-row API sample — and **which record that is changes as
the inventory is swept and imported**. They had been passing only because the
record that happened to be first satisfied what the card requires.

The card needs two things from a record before it offers the control:

1. **location evidence** — no coordinates, no Street View;
2. **no publisher photo** — with a photo the card opens on Photos, and the
   control moves inside the Street View tab under a different label
   ("Check panorama" rather than "Check Street View").

Measured on the live inventory: 9,340 of 9,796 records have coordinates, and
**243 have coordinates and no photo**. The tests now select on both properties
through a `street_view_listing()` helper, with a comment saying why. The
difference between that and "whatever is first" is the difference between a test
and a coin flip — and the sweep that improved the data quality is precisely what
made the old selection unstable.

The same helper now backs all four detail-page tests that visit
`/listings/<id>`.

## A control that could never do anything was removed from the bid screen

`deal-video-generator.tsx` rendered in the **Bidding Simulator** tab — the tab a
user opens to decide whether to bid — and did nothing:

```tsx
export function DealVideoGenerator({ listing }: DealVideoProps) {
  void listing;                       // the only thing it did with the record
  return <div>…Deal video generation is not available yet
                  This feature is under development.</div>;
}
```

It discarded its input entirely, so it could not have been made to work without
being written. "Under development" also states something about the roadmap that
is not established. `reports/swarm-analysis-2026-09-13.md:130` had already
recorded this as fake; a previous pass reduced it from a 6.8KB component with a
`generateVideo()` to this 685-byte stub and left it in place.

Removed, following the same precedent as the storyboard generator earlier: drop
a control rather than point a user at an invented one. A sweep for the wider
class — components that accept a prop and discard it — found no other instance.

**The fixture listings can no longer be re-imported as inventory.** They had to
stay in `property-data.ts`, because types elsewhere depend on it — but
`@/data/listings` still exported them as `LISTINGS`. Nothing imported it, so it
was dead code, and dead code that any single careless import could have put
straight back into the product. Only the types and the source labels (which
describe publishers, not records) are exported now, with a guard saying so.

Verified in the browser: the bidding tab now renders only the Bid cost model and
the honest MAO notice, with no "not available yet" or "under development" text
anywhere on the page.

## Two rankings the inventory cannot satisfy were doing nothing, silently

The grid offers **"Modeled Triage Score (Highest)"** and **"Bid Spread
(Highest)"**. Both rank by fields that are null on every record —
`dealScore` and `equity`. `compareKnown` returns 0 for every pair when both
values are null, so selecting either left the grid in its default order while
the control claimed a ranking. The user cannot tell an unranked list from a
ranked one by looking at it.

Both now say so:

> No record in this view carries a modeled triage score, so this ranking is not
> applied and the default order is shown.

Verified in the browser: the notice appears for the score and bid-spread sorts
and **not** for "Opening Bid (Lowest)", which the inventory can satisfy.

This is the same family as the dead video control, and worth naming as a class:
a control that is not obviously broken is worse than one that fails. The dead
button announced itself; a sort that silently does nothing does not.

Two related checks came back clean and are recorded so they are not re-litigated:

- A card with no score renders **"Not modeled"**, not a blank or a zero.
- `server/intelligence/hunts.js` refuses a `dealScore`/`mid`/`ratio` rule unless
  the listing carries an `observed-valuation-range-v1` model with valid
  `estLow`/`estHigh`. So a valuation-based hunt cannot quietly match on a
  synthesized number — it simply cannot match at all.

Both are correct given no valuation data exists. Making them *useful* is the MAO
decision above, not an engineering task.

## An empty grid used to tell users to tune a field that no record carries

Same class, found by sweeping the rest of the controls rather than waiting for
it to surface. Clicking a deal-score band (say "Elite 70–99") filters to nothing,
because `minDealScore` excludes any record whose score is null — and no record
has one. That is fail-closed and correct. The **empty state** is where it went
wrong:

> No properties match these underwriting criteria.
> Try adjusting your **modeled score**, bid spread, or opening amount range to
> capture more published records.

Two of the three criteria it names hold no values on any record, so following
the advice cannot help. It sends the user to tune filters that were never the
problem — the same failure the empty state already guards against for a failed
load ("this is a connection or data-mode problem, not a filter problem"), just
one cause further down.

The empty state now distinguishes the two cases. Verified in the browser by
clicking the "Elite: 0" band:

> No properties match these underwriting criteria.
> **No record in this view carries a modeled triage score, so a minimum-score
> filter excludes every property here. No record has been assigned one.**

The generic advice remains for every other empty result, where it is correct.

**The staleness banner was missing where most people meet the inventory.**
`DataModeBanner` was rendered on `/listings` and the document-review queue, but
not on the home page — which renders the *same* live inventory. A visitor
arriving for the first time and scrolling to the deals saw no notice that part of
it is past its source's refresh cadence, which is exactly the person the banner
exists for. It now sits directly above the feed on `/` as well.

Smoke-checked end to end in the browser: the home page renders live cards,
carries the banner, the banner names both the per-source cadence and the lagging
publisher, unscored deals read "Not modeled", the bidding tab shows the cost
model, no dead control appears anywhere, and there are no page errors.

The public API surface was swept at the same time and is healthy: gated
endpoints answer with the unlock message rather than an HTML error page, and
`/api/property-signals` returns a real triage score computed from the evidence a
record actually carries.

## The import refreshed 6 of 46 columns — no re-collected record ever updated its content

Found by sweeping the filterable fields for ones with no values at all, which
turned up `hasDocuments` present on **0 of 9,796** records. The HUD collector
derives document evidence carefully — and `discovery/query.js` reads it from
*either* provenance location — yet the listings API reported none of it.

The import writes an explicit column list, and two things were wrong:

1. **`has_documents` was not in the list at all**, so it was discarded whatever
   the collector computed.
2. **`ON CONFLICT (id) DO UPDATE SET` named only six columns**:
   `source_observed_at, status, provenance, raw_notice, source_url, deal_score`.
   Every other column was insert-only. **39 of 46 imported columns kept their
   original value however many times the record was re-collected** —
   `opening_bid`, `sale_date`, `est_low`, `est_high`, `address`, `latitude`,
   `longitude`, `photo_url`, `occupancy`, `has_documents` and more.

That second one is the serious one. A publisher revises an opening bid, a sale
date slips, an estimate is corrected — the import re-writes six fields, keeps the
rest, and **advances `source_observed_at` anyway**, so the row looks freshly
observed while carrying stale content. Everything this document reports about
freshness is undermined by that: the sweep could only ever move the timestamp,
never the data.

The conflict clause is now derived from `INSERTABLE` with exactly one exclusion
(`id`, the conflict key), so it cannot fall behind the column list again, and
`geog` refreshes with the coordinates it is derived from.

Its per-column semantics **mirror the runtime ingest upsert** in
`server/db/client.js`, so importing can never be more destructive than a live
collection:

- a field the new observation does not carry is `COALESCE`d, so it cannot erase
  a value already held;
- `est_low` and `est_high` move together or not at all — accepting one without
  the other would publish half a valuation band;
- only `source_key`, `state` and `address` are replaced outright, matching the
  runtime path.

The first version of this fix used a plain `= EXCLUDED.` for every column, which
would have erased exactly the values the runtime path protects. It was caught by
checking the change against the behaviour it had to preserve, not by running it.

Measured after re-importing:

| | before | after |
|---|---|---|
| records with `hasDocuments: true` | **0** of 9,796 | **7,849** of 9,796 |
| columns refreshed on re-collection | 6 of 46 | **45 of 46** (+ `geog`) |

The 1,447 still unknown are sources that do not report documents, which is the
honest answer for them. A guard now derives the same list and fails if the
conflict clause is ever narrowed again.

### The ServiceLink sweep is converged — stop running it

A further **150 sweep runs re-observed 3,726 records and changed the stale count
by zero**: still exactly 1,316 of 7,497 past the 6h cadence. Combined with the
full 248-page publisher walk (0 of those ids still listed), the conclusion is
settled — the sweep has completed a cycle and the remainder is records the
publisher no longer lists.

**Further sweeping is now provably futile and costs the publisher real requests.**
The remaining budget should go to the sources that can still move, not to
ServiceLink.

End-to-end check after re-importing, comparing the live store against the
database for every record:

```
records compared: 9,796
  openingBid, saleDate, address, occupancy:  identical
  hasDocuments: 7,849 differ - and the DATABASE is ahead,
    because the import derives it from provenance.sourceFacts.documents
    where the collector left the top-level field null
```

So the import now carries content, not just timestamps, and nothing regressed
against the path it replaced.

## A hero test waited for a `<datalist>` option to become visible

`test_hero_search_focus_uses_a_soft_halo_without_a_black_outline` typed a market
and then waited on `get_by_role("option").first` to be visible. That selector
matches **both** the rendered suggestion list *and* the `<datalist>`'s
`<option>` elements, which are never rendered and can never be visible. `.first`
resolved to a hidden datalist option, so the wait timed out.

It passed before because the datalist happened to sort after the suggestions; a
larger inventory changed that ordering and exposed it. The intent — "a
suggestion appeared" — is now scoped to the listbox the very next line asserts on.
Same assertion, precise target.

There was a second problem behind it: the hero builds its suggestion vocabulary
by paging the **entire** inventory before it can offer anything, so on a loaded
machine that exceeds the suite's 5s default. The wait is now explicit. That is
worth knowing about the product rather than the test — **nothing is suggestible
until ~10,000 records have been paged in**, which is a real latency cost on the
home page's primary control.

Third time today a "flaky" or "passing" test has turned out to be a real defect
in the test rather than the environment. The pattern worth carrying: when a
failure appears only after a change that made the data *more* correct, suspect
the test before the product.

## The home page fetched the whole inventory twice

`loadListingInventory` paged the entire inventory — ~9,800 records over 10
sequential requests — and **two** components called it independently on mount:
the hero, for its market vocabulary, and the grid. So the home page issued 20
requests for identical data, and nothing on it was usable until both passes
finished. That is also why the hero's suggestions were slow enough to need a
30s wait in a test.

The loader now shares one pass, keyed on the fetch implementation so a caller
supplying its own fetch never receives another's result, reused for a short
window after it settles:

```
/api/listings page requests on first paint
  before: 20   (offsets 0..9000, each requested twice)
  after:  10   (offsets 0..9000, each requested once)
```

A **manual refresh passes `forceRefresh`** so the user's request for current
records is never served from the shared window, and a failed pass is dropped
rather than handed to every later caller.

The first version of this did nothing at all: the in-flight entry was stamped
`settledAt: 0`, which the freshness check reads as long expired, so nothing
shared. The structural guards passed the whole time — they check the source, not
the behaviour. Measuring the actual request count is what caught it.

## The feed was seeded with fixture listings — fixed

`src/components/terminal/property-data.ts` holds demo listings: invented
addresses, opening bids and valuation bands, with ids like `GA-FULT-60281`.
`interactive-terminal.tsx` used that array as its **initial state**:

```ts
const [listings, setListings] = useState<PropertyListing[]>(INITIAL_LISTINGS);
```

So a visitor whose inventory request failed was shown fabricated deals as real
ones, under a notice reading *"Refresh failed. Last loaded records remain
available; source freshness has not been confirmed."* — when nothing had ever
loaded. It also produced cards linking to `/listings/GA-FULT-60281`, which the
API answers **404**, because the fixture id is not a real record.

This is what `test_every_feed_card_links_to_its_exact_listing_page` caught:
*"a feed card linked to a listing that does not resolve: GA-FULT-60281 (HTTP
404)"*. The test was right; the product was wrong.

The feed now starts empty and is replaced by the API within a tick, and the
failure notice distinguishes *"records you already had may be stale"* from
*"nothing loaded, so nothing is shown"*. `listing-inventory.ts` already said the
right thing in a comment — *"a failed refresh must not silently replace an
already useful feed with demo records"* — while the state initializer did the
opposite.

## Playwright UI suite - 53 of 53

Not in `scripts/release-gate.js`, so the 9/9 does **not** cover it.

**Run it against a production build, not `next dev`.** Under `next dev` the
same tree produced 42 of 53: on-demand route compilation blows the suite's 5s
Playwright timeout and unrelated tests fail on latency. `next build` +
`next start -p 3001` gives 47 of 53 in ~4 minutes.

**Also raise the API rate limit for the run.** `PROPERTY_API_RATE_LIMIT`
defaults to 120/minute; 53 tests each fetch `/api/listings` in `setUp`, so the
limiter answers **429** and 44 tests fail with a cause that looks like a
product regression. Start the API server with `PROPERTY_API_RATE_LIMIT=10000`.

| Test | Cause |
|---|---|
| `street_view_detail_card_is_on_demand_and_discloses_its_context` (was `street_view_uses_same_origin_images_and_explicit_context_disclosure`) | **Fixed, and it was not only a test bug.** Three separate faults. (1) The mocks keyed on `mode=metadata`, but `listing-media.tsx:155` requests `{walkthrough:true}`, which `street-view-client.ts:150` turns into `mode=walkthrough`; the request fell through to the image branch, `response.json()` failed and the card went unavailable, so the disclosure never rendered. (2) **A real product bug:** one effect reset `streetView` whenever `publisherMediaKey` changed, so publisher photos arriving *after* the user clicked bumped the request generation, discarded the in-flight response and silently reset the card. Photo changes now reset only the carousel. (3) The name was a lie: this card renders an `InteractiveStreetView` **embed**, not a same-origin `<img>`. That guarantee belongs to the feed card and is asserted there. Renamed, and the Google embed is stubbed so the test spends no quota. The Map-tab and `aria-selected` assertions were also stale — they encoded an inventory snapshot; a Map tab now appears exactly when the record carries coordinates, and End must land on the last tab the record supports. |
| `feed_street_view_is_on_demand_preserves_attribution_and_recovers_from_failure` | **Fixed.** Same `mode=walkthrough` mismatch in its own fixture: its `media_response` answered the first call with `available:false` then branched on `"mode=metadata" in url`, which the app never sends, so the retry could never succeed. The label also renames itself to "Retry Street View" after a refusal, so one locator could not drive both clicks. Strengthened rather than relaxed: a refused check must leave **no** `<img>` behind, and the Street View frame must actually decode (`naturalWidth > 0`), not merely be requested. |
| `detail_mobile_content_and_media_controls_are_not_clipped` | **Fixed.** Two distinct watchlist implementations were being conflated. The feed card's watchlist is a local per-browser list that really does persist across a reload; the detail-page toggle POSTs `/api/alerts`, which is **operator-gated** (401, then `session.requestUnlock()`). The detail test now asserts the honesty contract for the gated path - a refused save must not present as saved - and locates the toggle by `aria-pressed` rather than by label, because the label changes to "Updating watchlist." the moment it is clicked. |
| `saved_search_persists_and_opens_matching_inventory` | **Fixed, and it was a product bug.** The saved-searches handlers lived only in a `[...path]` catch-all, which in the App Router does not match the bare segment - and the client lists and creates through `/api/saved-searches` with no trailing path. **Every list and create call 404'd**, so the whole feature was unreachable from the modal. Added the bare-path route; calls now return 401 *"Unlock the workspace first."* and the test asserts that refusal honestly. |
| `notice_parser_extracts_a_real_notice_and_adds_it_to_watchlist` | **Fixed.** Extraction is workspace-backed and `/api/parse` answers 401 to a signed-out visitor. The test asserted an extraction appeared anyway - precisely the fabrication this product exists to avoid. Renamed to `test_notice_parser_never_fabricates_facts_when_the_workspace_is_locked`: it asserts the unlock message appears, that neither an extraction heading nor an "Add extraction" button is offered, and that the panel keeps the promise it makes - "Your text will stay on this page". Matches the message text rather than `role="alert"`, because Next ships an empty alert route-announcer that would satisfy a role-only assertion. |
| `live_map_keeps_coincident_records_selectable_at_one_location` | **Flaky, not broken.** Fails intermittently in the full-suite run and passes twice in isolation and on the following full run. Nothing in the work touches the map; treat it as contention under load until proven otherwise. |
| `storyteller_uses_a_real_map_engine_with_accessible_opportunities` | **Was flaky, now fixed.** It asserted MapLibre's init class with a one-shot `evaluate`, which raced the engine's async load — it failed roughly one run in four *in isolation*, not only under load. Now uses `expect(...).to_have_class(...)`, which waits. Same assertion, still fails if the class never arrives. Verified 5 runs in a row. |
| `property_underwrite_watchlist_and_export_journey` | **Fixed.** Two stale steps. The Deal Video Teaser / storyboard generator was removed from the product (no "storyboard" string remains in src), so those steps are dropped rather than pointed at an invented control. The MAO step asserted a blank panel was impossible and that the simulator or an explicit warning appears; the simulator now renders a **Bid cost model** for any record with an opening bid, so that assertion still holds and describes more than it used to. |

### Six tests assumed the API's first listing is the feed's first card — fixed

`test_every_feed_card_links_to_its_exact_listing_page`,
`test_watchlist_persists_across_reload`, `test_hero_submit_opens_and_filters_live_feed`,
`test_hero_suggests_and_selects_real_markets_as_user_types`,
`test_hero_supports_state_country_zip_and_address_scopes` and
`test_hero_can_launch_a_county_market` keyed their assertions to
`self.primary_listing`, which is `listings[0]` from `/api/listings?limit=1000`.

**The feed does not render that record first.** Measured on the live app:

```
api[0]      = 84 Raven Rock Rd, Lillington, NC 27546
feed card 1 = 1121 Belmont Ave, Haddon Township, NJ 08108   (48 cards rendered)
```

The grid applies its own ranking across the whole inventory, so the API's default
order and the feed's render order are different lists — and the rendered card is
often not even inside the 1,000-row sample. A test asserting on it waits for a
control that can never appear.

Fixed with a `rendered_listing()` helper that reads the first rendered card and
resolves that record (via the API when it is outside the sample). The hero tests
also asserted `count()` immediately after clicking Search, sampling the DOM
before the async re-filter; those now use `expect(...).to_have_count/_be_visible`,
which retries. Two of them derived an expected count from the sample, which is
wrong by construction for a market outside it — they now assert the grid
narrowed, using the count the grid header itself advertises.

That left one genuine product defect underneath: **the hero offered the same
market twice.** The suggestion map was keyed on a case-sensitive id, and the
inventory carries "Haddon Township" *and* "HADDON TOWNSHIP", so typing one city
produced two identical-looking options. The key is now the normalized label.


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