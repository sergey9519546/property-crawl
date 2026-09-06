# Source live audit — 2026-09-05

This audit executed only the 13 collectors registered in
`server/scrapers/scheduler.js`. Each source ran in its own `node
scripts/collect-source.js <source>` child process, with no shell, a 60-second
deadline, and at most two child processes at once. CivilView used `--state NJ
--counties 1 --limit 2`; HUD used one configured state, one page, and page size
10. No user-supplied URL was fetched and no challenge bypass was attempted.

The first sandboxed pass could not establish remote connections. The reported
results below are from the authorized public-network rerun, so they must not be
confused with sandbox transport failures.

| Source | Result | Observed evidence |
| --- | --- | --- |
| GSA | Records collected | 3 accepted current records in 7.7s. |
| IRS | Records collected | 7 accepted current records in 46.6s. |
| USDA | Records collected | 15 accepted current records in 8.2s. |
| CivilView | Records collected | NJ bounded sample: 1 county, 85 summaries, 2 detail-backed/accepted records. |
| Treasury | Timeout | Listing page exposed 16 property links; the isolated collector did not finish detail work before the 60s deadline. This is not a zero-inventory result. |
| Land Bank Search | Blocked | Circuit breaker detected a Turnstile challenge on `/data`; no bypass attempted. |
| Bid4Assets | Blocked | Circuit breaker detected a CAPTCHA challenge on `/sheriffsales`; no bypass attempted. |
| HUD | Collector error | Bounded collector reported no completed state endpoint. HUD HomeStore was displaying maintenance during the preceding source check; this is not a zero-inventory result. |
| Sheriff | Unverified zero yield | Exit was zero with 0 accepted and no verified-empty run report. Existing collector can swallow county/fallback failures, so this cannot prove no inventory. |
| Fannie | Unverified zero yield | Exit was zero with 0 accepted and no verified-empty run report. |
| Freddie | Unverified zero yield | Exit was zero with 0 accepted and no verified-empty run report. |
| VA/VRM | Unverified zero yield | Exit was zero with 0 accepted and no verified-empty run report. |
| U.S. Marshals | Unverified zero yield | Exit was zero with 0 accepted and no verified-empty run report. |

The second bounded audit reran the five zero-yield collectors after the auditor
was hardened. It records an observation error for each `unverified_zero_yield`
case, so the UI/history cannot treat a swallowed upstream problem as a clean
empty run. This does not assert a network fault; it preserves the uncertainty
until each collector exposes its own detailed failure report.

## Local artifacts

- Primary public-network report:
  `.cache/source-live-audit-2026-09-05T12-16-02-729Z/report.json`
- Follow-up zero-yield classification:
  `.cache/source-live-audit-2026-09-05T12-18-31-736Z/report.json`
- Per-source bounded stdout/stderr logs: the source-specific `.log` files in
  each report directory.
- Validated collected records merged by the existing collector:
  `.cache/live-listings.json` (75 retained after this audit).
- Run history updated by the existing collector/auditor:
  `.cache/source-observations.json`.

These `.cache` paths are intentionally local and ignored by Git. The audit did
not overwrite `data.js`, fixtures, snapshots, or source code outside the new
auditor.

## Repeating the audit

Run `node scripts/audit-source-network.js`. It emits a timestamped local report
and accepts an optional subset of the registered source keys. A successful exit
with zero accepted records is classified as `verified_empty` only if the
collector produces an explicit verified-empty coverage report; otherwise it is
`zero_yield_unverified` and is recorded as an observation error.
