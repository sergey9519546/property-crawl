# Crawler integration and reliability verification — September 12, 2026

## Outcome

Scrapling is available as an optional parser inside the canonical Node collection
pipeline. A bounded onboarding spider discovers candidate publisher records, and
an Unbrowse wrapper prepares and validates route candidates for review. These
tools supplement the existing PostgreSQL jobs, evidence snapshots, and adapters.
They do not automatically promote sources or establish nationwide coverage.

The full platform release remains incomplete. The API and existing preview are
available, but continuous collection is stopped and the preview still needs a
fresh production build containing later UI changes.

## Implemented and verified

- Scrapling 0.4.15 runs in an isolated Python environment. GSA extraction retains
  source URLs, parser/version identifiers and input hashes. Current bids do not
  become opening amounts. Parser failures cannot substitute fixture inventory.
- The onboarding spider bounds pages, depth, frontier, response size and retries;
  checks robots exclusions; stops on challenges; and resumes local research
  checkpoints. It emits candidates, not verified inventory.
- Unbrowse 11.4.1 is installed. Its wrapper checks installation, prepares review
  plans and validates restricted GET route candidates. Hosted setup, identity
  registration, capture and route resolution were not executed.
- HUD collection now resumes committed state/page progress using scope-bound
  cursors. Failed ingestion cannot advance the checkpoint. Terminal sweeps clear
  their checkpoints. Parser counts distinguish malformed rows from unknown counts.
- Migration 013 was applied. New source runs persist sanitized scope, page,
  jurisdiction, budget and count observations. Historical missing measurements
  remain unknown rather than being invented.
- Collection checks a default 1 GiB reserve on the local collector volume before
  claiming work and during ingestion. Low storage pauses collection and appears
  in readiness. This does not measure storage on a remote database host.
- Advanced PostgreSQL collection no longer rewrites the bounded demo inventory
  cache. GSA identity parsing rejects prose such as `Sale Number: Block` and uses
  a stable publisher property identifier when no valid sale/case ID exists.
- The walkthrough recorder now handles `--help` before starting processes or
  creating browser artifacts.

## Canonical PostgreSQL canaries

| Source | Run | Result | Coverage |
| --- | --- | --- | --- |
| ServiceLink | `c43d3bce-0d6f-4fbb-b1ac-c43b637b35e8` | Complete; 5,611 accepted, zero rejected in the final resumed segment | Terminal checkpoint cleared; this run preceded durable page counters |
| HUD | `95fa806d-1656-4a1f-84bc-3d5c643d6400` | Complete; 1,992 accepted, zero rejected | 56 pages; 52 completed jurisdictions; zero remaining or failed; checkpoint cleared |

These are observed run results, not verified transactions or a promise that the
publishers expose every property. The database readback confirmed both terminal
statuses and HUD's durable counters after the API restart.

Earlier GSA extraction canaries retained two immutable snapshots with Scrapling
metadata. A subsequent, separate onboarding probe observed robots exclusion for
`/our-listing` and stopped without requesting that path. Future GSA collection
needs its access policy resolved; the earlier canary does not resolve that issue.
The IRS index probe discovered eight candidate links within its depth-zero scope.

## Acceptance evidence

- `npm run test:crawler-tools`: 49 named tests passed.
- HUD, national-core, source-coverage and live-contract selection: 20 tests passed.
- `npm run test:evidence-truth`: 18 tests passed.
- Direct Python parser: two tests passed.
- Context generation check and `git diff --check` passed.
- Post-restart API readiness: HTTP 200, advanced mode, ready.
- Stored inventory: 8,455 listings; observed revision `102862`.
- Existing preview `/listings`: HTTP 200. This is availability evidence, not a
  fresh UI acceptance run.
- Worker health: stale/idle, zero queued or expired-running jobs. No continuous
  worker was left running after the one-shot canaries.
- Local free storage at the final runtime check: approximately 2.70 GB. Disk
  exhaustion occurred during work; regenerable npm caches were reclaimed. No
  property evidence, source archives or PostgreSQL files were removed.

The test selections overlap and should not be added into a unique test count.

## Remaining release work, in dependency order

1. Resolve GSA's observed access restriction and reconcile the historical
   `GSA-Block` record with future corrected publisher identity without losing
   saved links or evidence history.
2. Exercise a dedicated worker through a sustained operating soak and verify the
   production container deployment, storage reserve and recovery behavior.
3. Gate Wave 2 land-bank, CivilView and Bid4Assets adapters by explicit jurisdiction
   and two clean observed runs each.
4. Finish richer document labels/counts, access states and capture timestamps;
   expand source-backed property detail features where evidence exists.
5. Integrate and measure non-Google walkthrough providers. Research alone does
   not provide a working fallback or imagery for every property.
6. Build the current UI, perform the requested layout/language simplification,
   and verify grid/map/calendar/export/hunt filter parity and responsive flows.

Public subscriptions, onboarding, payments, email/SMS and auction bidding remain
outside the agreed phase.
