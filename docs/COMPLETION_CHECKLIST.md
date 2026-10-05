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
| Seed listings (`data.js`) | **2094** | `scripts/gen-context.js` |
| Source catalog entries | **163** | `server/sources/catalog.js` |
| Dispatched API paths | **41** | `server/server.js` |
| Scrapling parser tests | **16** | `npm run test:scrapling-parser` |

## Open work, in dependency order

Nothing below depends on anything later in the list.

| # | Item | Depends on | Blocked by |
|---|---|---|---|
| 1 | **PP-01** corrupt persisted stores: user/operator visibility + no silent overwrite | — | — |
| 2 | **PP-02** source-bound release gate | — | — |
| 3 | **PP-03** real isolated PostgreSQL: discovery/contracts, restart durability, lease loss/retry/worker soak | #2 | a Postgres instance |
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
| Isolate a real PostgreSQL and run discovery/contracts, restart durability, lease-loss/retry/worker soak | infra | see the exact state below |
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

```
docker run -d --name pp-pg -e POSTGRES_PASSWORD=property-local-dev \
  -p 55432:5432 postgis/postgis:16-3.4
$env:DISCOVERY_TEST_DATABASE_URL='postgres://postgres:property-local-dev@127.0.0.1:55432/property_crawl'
npm run test:discovery:operations:pg
```

That runner currently holds the two tests that are skipped everywhere else
(`discovery-job-fence`, `discovery-promotion-evidence`) — they are the only
coverage of job-ownership fencing and promotion evidence against real row
locks, and nothing runs them outside a PG job.

**CI `continue-on-error` is not release evidence.** Jobs that carry it are
advisory and cannot close anything in this table.

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