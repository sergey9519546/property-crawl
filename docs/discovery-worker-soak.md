# Discovery worker soak and recovery harness

`scripts/discovery-worker-soak.js` checks the PostgreSQL job loop and lease recovery path. It creates a random temporary schema, applies the real schema and migrations, runs the exported worker iteration with the real discovery store, and drops the schema afterward. Ambient `DATABASE_URL` is ignored. An explicit `--test-env-file` reads the named file directly, overrides inherited database variables for this run, and selects the first defined key in this order: `DISCOVERY_TEST_DATABASE_URL`, `TEST_DATABASE_URL`, `DATABASE_URL`.

Its coordinator is synthetic: it only advances job and stage rows. It does not contact publishers, create observations, or write listings. Listing counts are checked before and after. `DATABASE_URL` is deliberately ignored; set `DISCOVERY_TEST_DATABASE_URL` or `TEST_DATABASE_URL` so production cannot be selected accidentally.

```text
node scripts/discovery-worker-soak.js
node scripts/discovery-worker-soak.js --samples 3 --duration-ms 10000 --no-recovery --no-heartbeat
node scripts/discovery-worker-soak.js --test-env-file .cache/discovery-runtime/test.env --samples 1 --duration-ms 150000 --no-recovery --no-heartbeat --production-timer
```

Defaults are three iterations, one recovery sample, one active-lease renewal sample, a 30-second budget, and a 10-second lease. The production-timer check is optional so the default harness remains fast. Enforced bounds are 1-50 iterations, 1-300 seconds total, and 10-30 seconds per recovery lease. JSON output includes timing, schema, sample job IDs/statuses, recovery attempt count, inventory counts, cleanup state, and sanitized failures. Programmatic options use the same numeric bounds and strict boolean validation as the CLI. Any canonical worker result whose status is not completed records an explicit failure. `complete` requires all requested samples, requested recovery and renewal checks, unchanged inventory, and successful schema removal. Synthetic canaries always report zero accepted rows and incomplete source coverage; they are not promotion evidence.

## Coverage and deployment audit

`test/discovery-worker.test.js` covers filtering, due sources, retries, canary injection, and signal cleanup with mocks. `test/discovery-acceptance-restart.test.js` covers one real PostgreSQL claim, claimant termination, lease expiry, and takeover. This harness adds repeated measured samples and inventory isolation.

`docker-compose.discovery.yml` declares a dedicated worker with `restart: unless-stopped`, the shared PostGIS database, migration dependencies, persistent state/media volumes, and `SCRAPER_BACKGROUND_ENABLED=0`; the API disables its background scheduler too. `render.yaml` declares only the web/API service with its background scheduler disabled. A deployment based only on `render.yaml` therefore has no recurring discovery worker; fixing that requires shared deployment changes outside this harness.

The active-lease sample claims a real job, renews its lease before expiry, waits beyond the original expiry, and proves a competitor still cannot claim it. It exercises the same PostgreSQL renewal operation used by the worker and keeps the synthetic job active longer than its original lease boundary.

`--production-timer` additionally runs the exported production worker unchanged and holds its synthetic coordinator open until the worker's hardcoded 120-second `setInterval` callback calls the real PostgreSQL `renewJobClaim`. The report records the observed callback delay, call count, 300-second renewal TTL, original and renewed expiry timestamps, and measured lease extension. It fails if no callback arrives within the bounded budget or if PostgreSQL does not show a later expiry. Allow at least 125 seconds after earlier requested samples; 150 seconds with recovery checks disabled is the reproducible command above. This is an offline isolated-schema check: it does not contact a publisher, enable background collection, promote a source, or write production inventory. It proves the positive production timer path once per requested run; it does not simulate event-loop stalls or prove behavior after a renewal failure.
