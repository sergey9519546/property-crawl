# Scope and lease integrity review

Astra integrated work from Sol and Terra and independently checked the stored
evidence and running interface. This is an incremental release review, not a
claim that every national source is operational.

## Promotion and scope

Migration 014 withdrew approvals unsupported by two distinct complete source
runs for the configured acquisition scope. It preserved inventory and history.
ServiceLink subsequently passed: runs `ee60da06-cc38-4eb6-a19e-66d371e0a43c`
and `8b17e4a3-bf90-4d20-a6d6-0635e2558d2d` each fetched 57 pages, accepting
5,635 and 5,637 records respectively, with zero rejection and explicit complete,
full-sweep, untruncated coverage. Root independently queried both runs and the
resulting promoted state. See the ServiceLink canary report for exact scope.

The worker checks adapter configuration and checkpoint scope against promotion
evidence before creating or claiming recurring jobs. A deterministic mismatch
excludes that source and records a bounded diagnostic while valid peers continue.
Database/authority failures still stop the iteration. HUD request budgets may
change without invalidating a continuation; geography, endpoint, page size and
the step-6 inventory filter remain acquisition identity.

Treasury produced two new complete 14-record sweeps. IRS exposed two agricultural
properties rejected because their addresses lacked leading street numbers. IRS
remains unapproved while its parser correction is reviewed and requalified. See
the IRS/Treasury report; an interrupted IRS attempt was explicitly marked failed
after its process and expired lease were verified, without changing its checkpoint.

## Lease fencing

The review identified writes occurring after a worker lost its job claim. The
store now locks and verifies the job owner inside snapshot/projection, run,
checkpoint and hunt-evaluation transactions, then checks wall-clock lease expiry
again before commit. A successor cannot claim the job during these transactions.
Expiry during projection rolls back both listing and snapshot writes. Scheduler
and coordinator boundaries propagate lease loss instead of converting it into a
successful result or a parser rejection.

The worker refuses a completed result and clean-canary credit after heartbeat
failure. Case handoffs check the lease before each effect; the legacy case file
store does not share a PostgreSQL transaction, so this is not a claim of atomic
case-file rollback with job state.

Root's integrated verification passed 43 tests across lease loss, real PostgreSQL
fencing, worker scope, checkpoints, coordinator behavior and the soak harness.
A separate four-test PostgreSQL run verified projection rollback, takeover
exclusion, stale hunt-event rejection, promotion evidence and hunt concurrency.
The broader runtime/query/hunt/transport checks passed 19 tests. Later changes
require their focused follow-up checks before worker startup.

## Interface and operations

The first purported Sources build was stale; live browser inspection caught it.
An explicit environment build helper then produced fresh preview assets and root
restarted the UI. The browser now displays `NJ · county ID 20` for CivilView and
HUD's recorded jurisdictions, without React errors. Legacy runs lacking coverage
evidence appear partial instead of operational. The verified UI uses port 3103;
the canonical API uses 3102.

The dedicated worker health command reads its durable heartbeat, has bounded
database timeouts, and avoids exposing connection information. Its default
360-second stale threshold accommodates the maximum 300-second poll interval.
Compose now uses this probe for the worker, which has no HTTP listener. Compose
configuration validation passed; Docker deployment remains unverified because
the local Docker daemon is unavailable. Recurring collection was kept disabled
during this integrity review.
