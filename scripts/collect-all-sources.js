'use strict';

// Run the same durable full-cycle coordinator used by the source network API.
// It is intentionally a process-local CLI: no operator token or HTTP server is
// required, and the job record remains available in the Activity endpoint.
const scheduler = require('../server/scrapers/scheduler');

async function main() {
  const coordinator = scheduler.collectionCoordinator;
  if (!coordinator) throw new Error('Collection coordinator is unavailable');
  const idempotencyKey = String(process.env.COLLECTION_IDEMPOTENCY_KEY || '').trim() || undefined;
  // coordinator.start() is async, so it returns a Promise. Reading .id off it
  // gave undefined, which made the inFlight lookup miss, made store.get(undefined)
  // miss, and threw "Collection job was not retained" -- while a full sweep ran
  // unobserved in this same process and was killed when the process exited.
  const job = await coordinator.start({ trigger: 'cli', ...(idempotencyKey ? { idempotencyKey } : {}) });
  const running = coordinator.inFlight.get(job.id);
  if (running) await running;
  // store.get is synchronous on the JSON adapter and promise-returning on the
  // Postgres one; await is correct for both.
  const final = await coordinator.store.get(job.id);
  if (!final) throw new Error('Collection job was not retained');
  console.log(JSON.stringify({ id: final.id, status: final.status, revision: final.revision, stages: final.stages, errors: final.errors }, null, 2));
  if (final.status !== 'completed') process.exitCode = 1;
}

// Exported and guarded so a test can drive main() against a stub coordinator.
// Calling main() at module load meant merely requiring this file started a real
// full sweep -- a side effect no test could survive and no reader would expect.
if (require.main === module) {
  main().catch((error) => {
    console.error(`[collect-all-sources] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { main };
