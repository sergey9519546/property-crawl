'use strict';

function leaseLost() {
  const error = new Error('Collection job lease was lost; refusing stale evidence write');
  error.code = 'DISCOVERY_JOB_LEASE_LOST';
  return error;
}

// Hold the job row lock until the evidence transaction commits. A successor
// cannot take ownership between this check and the write. Use wall-clock time:
// PostgreSQL NOW() stays fixed at transaction start even during a long write.
async function assertJobClaim(client, options = {}, sourceKey = null) {
  const { jobId, owner } = options;
  if (!jobId && !owner) return;
  if (!jobId || !owner) throw leaseLost();
  const result = await client.query(`SELECT id FROM discovery_jobs
    WHERE id=$1 AND lease_owner=$2 AND status='running'
      AND lease_expires_at>clock_timestamp()
      AND ($3::text IS NULL OR $3=ANY(source_keys)) FOR UPDATE`, [jobId, owner, sourceKey]);
  if (result.rowCount !== 1) throw leaseLost();
}

async function withJobFence(pool, options, sourceKey, operation) {
  if (!options?.jobId && !options?.owner) return operation(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await assertJobClaim(client, options, sourceKey);
    const result = await operation(client);
    await assertJobClaim(client, options, sourceKey);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { assertJobClaim, leaseLost, withJobFence };
