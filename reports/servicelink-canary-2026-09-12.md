# ServiceLink canonical canary — 2026-09-12

## Execution boundary

- Source: `servicelink` only
- Trigger: `discovery_canary`
- Collector bounds: `maxPages=100`, `pageSize=100`
- Starting checkpoint cursor: `{}`
- Background collection: disabled
- Promotion and recurring collection: unchanged
- Environment: `.env.local` and `.cache/discovery-runtime/test.env` parsed explicitly with `node:util.parseEnv`; the explicit local values replaced inherited discovery/database variables.

## Durable result

| Evidence | Value |
|---|---|
| Job ID | `job_155526acd6d122aaeac152f1` |
| Job status | `completed` |
| Source run ID | `8b17e4a3-bf90-4d20-a6d6-0635e2558d2d` |
| Publisher discovered | 5,637 |
| Parser emitted | 5,637 |
| Accepted | 5,637 |
| Rejected | 0 |
| Records skipped | 0 |
| Pages fetched/requested | 57 / 57 |
| Complete | `true` |
| Full sweep complete | `true` |
| Truncated | `false` |
| Observation error | `null` |

The acquisition and configured scopes match exactly:

```json
{"endpoint":"/api/listingsvc/v1/Listings","filters":{}}
```

The clean canary counter advanced from `1` to `2`. `last_clean_run_id` now points to `8b17e4a3-bf90-4d20-a6d6-0635e2558d2d`. The rollout remains `canary`; this operation did not promote it.

No challenge response or partial/truncated condition was observed.

## Independent promotion proof and release action

The release check queried durable source-run rows independently after the canary. It found two distinct completed runs whose `coverage.acquisitionScope` exactly equals the configured scope above:

| Run ID | Completed | Accepted | Rejected | Complete / full / untruncated |
|---|---:|---:|---:|---|
| `ee60da06-cc38-4eb6-a19e-66d371e0a43c` | `2026-09-12T17:49:50.573Z` | 5,635 | 0 | `true / true / true` |
| `8b17e4a3-bf90-4d20-a6d6-0635e2558d2d` | `2026-09-12T22:29:45.231Z` | 5,637 | 0 | `true / true / true` |

The older run's initial `scope` field uses the legacy collector label, while its structured `coverage.acquisitionScope` is the exact current publisher slice. Migration 014's promotion contract evaluates the structured acquisition scope. Both runs satisfy that contract.

The configured scope hash and terminal checkpoint scope hash both equal `05642c8fd81a05d8351203bf7827377adb1d5b3e5b7084276cbdb85ff9633f05`; the checkpoint cursor remains `{}`. This establishes terminal completion and exact compatibility with the next full sweep.

Under the existing release authorization, ServiceLink alone was promoted at `2026-09-12T22:32:35.782Z`. Its durable state is now `promoted`, with two clean canary runs and latest clean run `8b17e4a3-bf90-4d20-a6d6-0635e2558d2d`. No recurring worker was started.
