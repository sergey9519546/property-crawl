'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createIsolatedDatabase } = require('./discovery-acceptance-db');
const { DiscoveryStore } = require('../server/discovery/store');
const { PgHuntStore } = require('../server/discovery/hunt-store');

test('job ownership fences evidence, projection, run completion, checkpoints and hunt events', async () => {
  const database = await createIsolatedDatabase({ prefix: 'job_fence' });
  const { pool } = database, store = new DiscoveryStore(pool);
  try {
    const job = await store.createOrReuseJob({ sourceIds: ['treasury'] });
    await store.claimJob(job.id, 'first', 300);
    const first = { jobId: job.id, owner: 'first' };
    const run = await store.beginRun({ sourceKey: 'treasury', jobId: job.id }, first);
    const snapshot = (record) => ({ runId: run.id, sourceKey: 'treasury', sourceRecordId: record, observedAt: new Date().toISOString(), rawPayload: { record } });
    await store.saveCheckpoint('treasury', { page: 1 }, { endpoint: '/index' }, first);

    // The job row lock lasts throughout the listing projection transaction.
    let enterProjection, releaseProjection;
    const entered = new Promise(resolve => { enterProjection = resolve; });
    const released = new Promise(resolve => { releaseProjection = resolve; });
    const pending = store.ingestSnapshot(snapshot('owned'), async client => {
      await client.query("INSERT INTO listings(id,source_key,state,address) VALUES('fenced','treasury','CA','1 Main Street')");
      enterProjection();
      await released;
    }, first);
    await entered;
    const contender = await pool.connect();
    try {
      await contender.query("SET lock_timeout='100ms'");
      await assert.rejects(contender.query("UPDATE discovery_jobs SET lease_owner='other' WHERE id=$1", [job.id]), { code: '55P03' });
    } finally {
      await contender.query('RESET lock_timeout');
      contender.release();
      releaseProjection();
    }
    await pending;

    // A lease expiring during the transaction rolls back both evidence and
    // the corresponding listing projection, using wall-clock time at commit.
    await assert.rejects(store.ingestSnapshot(snapshot('expired-during-write'), async client => {
      await client.query("INSERT INTO listings(id,source_key,state,address) VALUES('rolled-back','treasury','CA','2 Main Street')");
      await client.query("UPDATE discovery_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [job.id]);
    }, first), { code: 'DISCOVERY_JOB_LEASE_LOST' });
    assert.equal((await pool.query("SELECT id FROM listings WHERE id='rolled-back'")).rowCount, 0);
    assert.equal((await pool.query('SELECT id FROM discovery_snapshots')).rowCount, 1);

    await pool.query("UPDATE discovery_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [job.id]);
    await store.claimJob(job.id, 'successor', 300);
    const successor = { jobId: job.id, owner: 'successor' };
    await assert.rejects(store.ingestSnapshot(snapshot('stale'), () => assert.fail('stale projection executed'), first), { code: 'DISCOVERY_JOB_LEASE_LOST' });
    await assert.rejects(store.finishRun(run.id, { status: 'complete' }, first), { code: 'DISCOVERY_JOB_LEASE_LOST' });
    await assert.rejects(store.saveCheckpoint('treasury', {}, {}, first), { code: 'DISCOVERY_JOB_LEASE_LOST' });
    await assert.rejects(store.beginRun({ sourceKey: 'treasury', jobId: job.id }, first), { code: 'DISCOVERY_JOB_LEASE_LOST' });
    await assert.rejects(store.saveCheckpoint('irs', {}, {}, successor), { code: 'DISCOVERY_JOB_LEASE_LOST' });
    assert.deepEqual((await store.getCheckpoint('treasury')).cursor, { page: 1 });
    assert.equal((await pool.query('SELECT status FROM discovery_source_runs WHERE id=$1', [run.id])).rows[0].status, 'running');

    const hunts = new PgHuntStore(pool);
    const hunt = await hunts.create({ name: 'Fence test', enabled: true, criteria: {} });
    const evaluated = { baseline: { huntVersion: hunt.version, records: {} }, events: [{ id: 'hevt_' + 'a'.repeat(24), identityKey: 'treasury:owned', type: 'new_match', detectedAt: new Date().toISOString() }], response: { matched: 1 } };
    await assert.rejects(hunts.saveEvaluation(hunt, evaluated, first), { code: 'DISCOVERY_JOB_LEASE_LOST' });
    assert.equal((await pool.query('SELECT id FROM discovery_hunt_events')).rowCount, 0);
    await hunts.saveEvaluation(hunt, evaluated, successor);
    assert.equal((await pool.query('SELECT id FROM discovery_hunt_events')).rowCount, 1);
    await store.finishRun(run.id, { status: 'partial', accepted: 1 }, successor);
    await store.saveCheckpoint('treasury', { page: 2 }, { endpoint: '/index' }, successor);
    assert.deepEqual((await store.getCheckpoint('treasury')).cursor, { page: 2 });
  } finally {
    await database.close();
  }
});
