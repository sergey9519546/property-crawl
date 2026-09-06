'use strict';

// Run the same durable full-cycle coordinator used by the source network API.
// It is intentionally a process-local CLI: no operator token or HTTP server is
// required, and the job record remains available in the Activity endpoint.
const scheduler = require('../server/scrapers/scheduler');

async function main() {
  const coordinator = scheduler.collectionCoordinator;
  if (!coordinator) throw new Error('Collection coordinator is unavailable');
  const idempotencyKey = String(process.env.COLLECTION_IDEMPOTENCY_KEY || '').trim() || undefined;
  const job = coordinator.start({ trigger: 'cli', ...(idempotencyKey ? { idempotencyKey } : {}) });
  const running = coordinator.inFlight.get(job.id);
  if (running) await running;
  const final = coordinator.store.get(job.id);
  if (!final) throw new Error('Collection job was not retained');
  console.log(JSON.stringify({ id: final.id, status: final.status, revision: final.revision, stages: final.stages, errors: final.errors }, null, 2));
  if (final.status !== 'completed') process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[collect-all-sources] ${error.message}`);
  process.exitCode = 1;
});
