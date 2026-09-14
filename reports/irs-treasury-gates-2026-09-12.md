# IRS and Treasury canonical gate evidence — 2026-09-12

## Boundary and contracts

The adapters expose structured acquisition scopes before collection:

- IRS: `{"endpoint":"/auction/items","filters":{"assetClass":"real_estate"}}`
- Treasury: `{"endpoint":"/auctions/treasury/rp/realprop.shtml","filters":{"assetClass":"real_property"}}`

Both adapters enumerate a bounded publisher index and fetch its discovered detail records with the repository's existing retry, jitter, and rate-limit behavior. Their reports include publisher-discovered, parser-emitted, parser-rejected, and ingestion-rejected counts plus explicit complete/full-sweep/truncation flags.

The canary process parsed `.env.local` and `.cache/discovery-runtime/test.env` with `node:util.parseEnv`, replaced inherited database/discovery variables, disabled background collection, and ran only the requested source. No source was promoted and no daemon was started.

These canaries ran with the coordinator code loaded before the atomic lease-fence work identified later on September 12. They verify source scope and parser/completeness evidence, not crash recovery or stale-worker fencing.

## IRS — blocked

The first canonical attempt produced:

| Evidence | Value |
|---|---|
| Job | `job_b744476dccab66fae95bb5fa` (`completed`) |
| Run | `51ec0e94-104b-41c4-9433-ee8237cd431a` (`complete`) |
| Publisher discovered | 8 |
| Parser emitted / accepted | 6 / 6 |
| Parser rejected / durable rejected | 2 / 2 |
| Ingestion rejected | 0 |
| Scope | `/auction/items`; `assetClass=real_estate` |

The adapter's report labels this `success`, `complete=true`, `fullSweepComplete=true`, and `truncated=false` even though two publisher cards were parser-rejected. The durable promotion predicate correctly refused the run because `rejected_count=2`; IRS clean proof reset to zero and rollout state is `canary`.

The helper began a second attempt before its local stop predicate was tightened to inspect structured parser-rejection counts. It was interrupted as soon as the first run's durable mismatch was confirmed. Process termination was verified because its execution session no longer existed. Its exact durable ownership was run `24e14518-1a78-4edd-96b4-0fd9519fa363`, job `job_6258063805917519fe2aaf75`, lease owner `worker:883856:11f25cab-4519-4d12-92cb-97a517d9f968`. After that lease expired, a transaction locked and changed only those two matching IRS rows to `failed`; it did not alter the source checkpoint. This interrupted attempt has zero persisted counts and empty coverage and is not evidence.

A separate bounded read-only audit of the eight detail pages identified both rejection reasons. They are legitimate real-property offerings, not personal-property cards:

- `7863-acres-more-or-less-seized-agricultural-land-sale-abbeville-louisiana` — agricultural land; rejected because the published street/address line does not begin with a number.
- `agricultural-land-about-100420-acres-south-charleston-oh` — agricultural land; rejected for the same leading-number rule.

The IRS scope remains real estate and should include these land records. The parser should accept a publisher address without a leading street number when the title/detail facts establish real property, preserve the address as published, and classify it as land. Separately, report `complete` and `fullSweepComplete` should require `recordsRejected === 0`, or the report should expose an explicit, justified out-of-scope count distinct from parser rejection. These two records cannot be treated as out of scope under the present `assetClass=real_estate` contract.

No further IRS attempt was made. Before retrying, IRS must either parse all eight cards or make any skipped/non-property classification explicit while keeping rejected publisher records from being labeled a complete clean sweep.

The parser was subsequently corrected without starting another canary. It now accepts a nonnumeric published address only when the publisher title or detail contains positive land evidence such as agricultural land, vacant land/lot, land for sale, or a stated acreage. It retains the exact slug identity and publisher title/address qualification in provenance, while generic non-property and malformed locality shapes still fail. Parser rejection now makes both completion flags false. Explicit personal-property title matches are recorded as justified exclusions outside the real-estate scope. Focused IRS tests pass 3/3; the shared national report suite's IRS assertions also pass. That broader suite currently has an unrelated HUD scope expectation failure caused by concurrent HUD changes.

## Post-fence IRS canary attempt

After the atomic lease-fence suite passed, an authorized two-run sequence was started with the corrected parser. The first run stopped the sequence because it was partial:

| Evidence | Value |
|---|---|
| Job | `job_330c837c661d6c9ec3e31433` (`completed`) |
| Run | `de536b7e-1852-4c8e-8609-b402a3ed6134` (`partial`) |
| Publisher discovered | 8 |
| Accepted | 7 |
| Parser/durable rejected | 1 |
| Complete / full sweep | `false / false` |
| Truncated | `false` |
| Scope | `/auction/items`; `assetClass=real_estate` |

The configured and checkpoint scope hashes remained `eb11e3b716c5a87eb682fd8ab80288a83296e380375e36ddb5d1921216097a42`, with terminal checkpoint cursor `{}`. The rollout remains `canary` with zero clean runs. No second run or promotion was attempted.

The remaining rejection was the Louisiana 7.863-acre offering. Its publisher address block begins with `PARCEL ID Number R7288700`, followed by the actual `Bass Rd...` location and then `Abbeville, 70510 LA`. The parser was tightened again to recognize only this explicit parcel-label prefix when positive exact title/description land evidence is present. It preserves the parcel label in `provenance.sourceFacts.publisherParcelLabel`; generic shifted address blocks remain invalid. Focused IRS tests now pass 4/4, including both observed agricultural records, malformed/non-property negatives, unrelated-footer isolation, and residential acreage classification. No further live canary was run pending a fresh authorization.

## Treasury — qualifying source evidence, pending root review

Two sequential runs completed against the identical structured acquisition scope:

| Job | Run | Discovered | Accepted | Rejected | Complete / full / untruncated |
|---|---|---:|---:|---:|---|
| `job_f74081202efc3e308e7acc2c` | `348270b1-61ee-4db7-96e8-58be63b9f91c` | 14 | 14 | 0 | `true / true / true` |
| `job_592d099e01a34def53264e45` | `0ecf0d73-77c2-47ff-aeb0-ba575e701399` | 14 | 14 | 0 | `true / true / true` |

Each run reports 14 parser-emitted records, zero parser or ingestion rejection, and no observation error. The configured scope and terminal checkpoint scope hash are both `2dc0435f09367b7544b5fa7e2dd5a00239f6bea67c029c17a36a9c0547d2dc28`; the terminal cursor is `{}`. The durable rollout remains `canary`, latest clean run is `0ecf0d73-77c2-47ff-aeb0-ba575e701399`, and the counter is 4 because it includes earlier compatible evidence. No promotion was attempted.

## Fresh IRS canary on the current runtime — stopped on transport denial

Before this attempt, the focused IRS parser suite passed 4/4. The durable runtime was PostgreSQL with `DISCOVERY_MODE=advanced`, background collection disabled, no queued or running IRS job, rollout state `canary`, zero clean canaries, and a terminal `{}` checkpoint whose scope hash matched the intended IRS scope hash `eb11e3b716c5a87eb682fd8ab80288a83296e380375e36ddb5d1921216097a42`. The job ownership/fence acceptance test also passed against an isolated schema on the configured PostgreSQL service.

Exactly one fresh IRS canary was then started through `scripts/discovery-worker.js --canary irs`. It stopped at the first network request because this execution runtime denied outbound access to `www.irsauctions.gov`:

| Evidence | Value |
|---|---|
| Job | `job_aaf28c0c039012daf92315f1` (`partial`, one claim attempt) |
| Run | `bb61112e-e13a-45d7-b9a7-9457daf2e627` (`failed`) |
| Trigger | `discovery_canary` |
| Source scope | `/auction/items`; `assetClass=real_estate` |
| Scope hash | `eb11e3b716c5a87eb682fd8ab80288a83296e380375e36ddb5d1921216097a42` |
| Discovered / accepted / rejected | `0 / 0 / 0` |
| Coverage | `{}` |
| Error | `Upstream transport failed (EACCES) for host www.irsauctions.gov; retryable=false` |
| Started / completed | `2026-09-13T03:15:50.903Z` / `2026-09-13T03:15:51.857Z` |

The coordinator marked hunt execution unsafe with reason `source_failed`; inventory committed zero records. This is a runtime access denial, not a publisher response or parser rejection, but it is still a durable partial canary. Per the stop rule, no second canary was started and no promotion was attempted.

The failed canary also exposed a coordinator behavior outside the IRS parser: `recordCanary` replaced the rollout's configured publisher scope with the fallback `{"source":"irs","incomplete":true}` and hash `5ca7a6ce12fb8b15b180a6db0ed9ee2168f02ed908cdcca426218dd2d563acf7`. The terminal checkpoint correctly retained the intended scope hash and `{}` cursor. Promotion review must treat this scope mismatch as blocking. An independent evidence query found zero qualifying complete IRS runs for the exact intended scope.

### Independent IRS promotion review SQL

Run these read-only statements against the same durable PostgreSQL database. They use the intended publisher slice explicitly, so a failed canary cannot redefine the review scope.

```sql
SELECT source_key, state, clean_canary_runs, last_clean_run_id,
       configured_scope, canary_scope_hash, promoted_at, updated_at
FROM discovery_source_rollouts
WHERE source_key = 'irs';

SELECT source_key, cursor, scope_hash, updated_at
FROM discovery_checkpoints
WHERE source_key = 'irs';

SELECT id, discovery_job_id AS job_id, status, trigger,
       discovered_count, accepted_count, rejected_count,
       scope, scope_hash, coverage, error_message, started_at, completed_at
FROM discovery_source_runs
WHERE source_key = 'irs'
ORDER BY started_at DESC;

SELECT id, discovery_job_id AS job_id,
       discovered_count, accepted_count, rejected_count,
       coverage->'acquisitionScope' AS acquisition_scope,
       completed_at
FROM discovery_source_runs
WHERE source_key = 'irs'
  AND status = 'complete'
  AND accepted_count > 0
  AND rejected_count = 0
  AND coverage->'complete' = 'true'::jsonb
  AND coverage->'fullSweepComplete' = 'true'::jsonb
  AND coverage->'truncated' = 'false'::jsonb
  AND coverage->'acquisitionScope' =
      '{"endpoint":"/auction/items","filters":{"assetClass":"real_estate"}}'::jsonb
ORDER BY completed_at DESC;
```

Promotion review must require two distinct rows from the final query, the rollout's configured scope restored to that exact JSON object, the rollout hash and checkpoint hash equal to `eb11e3b716c5a87eb682fd8ab80288a83296e380375e36ddb5d1921216097a42`, and no active IRS job. The present durable state fails those requirements and must not be promoted.
