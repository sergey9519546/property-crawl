'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkerPool } = require('../server/db/worker-pool');

test('WorkerPool: memory fallback rejects invalid parameters', async () => {
  const pool = createWorkerPool();

  await assert.rejects(
    async () => pool.enqueueTask(''),
    /Task ID must be a non-empty string/
  );
  await assert.rejects(
    async () => pool.acquireNextTask(''),
    /Worker ID is required to acquire a lease/
  );
});

test('WorkerPool: concurrent workers achieve mutual exclusion without collisions', async () => {
  const pool = createWorkerPool();
  const taskCount = 30;
  const workerCount = 5;

  for (let i = 1; i <= taskCount; i++) {
    await pool.enqueueTask(`task-${i}`, { index: i, target: `county-${i % 3}` });
  }

  const initialStats = await pool.getStats();
  assert.equal(initialStats.available, taskCount);
  assert.equal(initialStats.leased, 0);

  // Track acquired tasks per worker
  const workerAssignments = new Map();
  for (let w = 1; w <= workerCount; w++) {
    workerAssignments.set(`worker-${w}`, []);
  }

  // Simulate concurrent workers attempting to pull and complete tasks
  const workers = Array.from({ length: workerCount }, async (_, idx) => {
    const workerId = `worker-${idx + 1}`;
    while (true) {
      const task = await pool.acquireNextTask(workerId, { ttlSeconds: 60 });
      if (!task) break; // No more available tasks

      workerAssignments.get(workerId).push(task.id);
      // Simulate quick work and complete
      const completed = await pool.completeTask(task.id, workerId);
      assert.equal(completed, true);
    }
  });

  await Promise.all(workers);

  // Assert all tasks completed
  const finalStats = await pool.getStats();
  assert.equal(finalStats.available, 0);
  assert.equal(finalStats.leased, 0);
  assert.equal(finalStats.completed, taskCount);

  // Assert exactly-once execution (no collisions across workers)
  const allLeasedTaskIds = [];
  for (const [wId, taskIds] of workerAssignments.entries()) {
    allLeasedTaskIds.push(...taskIds);
  }
  assert.equal(allLeasedTaskIds.length, taskCount);
  const uniqueSet = new Set(allLeasedTaskIds);
  assert.equal(uniqueSet.size, taskCount);
});

test('WorkerPool: heartbeat touches and extends active lease', async () => {
  const pool = createWorkerPool();
  await pool.enqueueTask('hb-task-1', { item: 'geo' });

  const lease = await pool.acquireNextTask('worker-alpha', { ttlSeconds: 10 });
  assert.ok(lease);
  assert.equal(lease.id, 'hb-task-1');
  const initialExpiry = lease.expiresAt;

  // Wrong worker cannot touch lease
  const unauthorizedTouch = await pool.touchLease('hb-task-1', 'worker-beta', 30);
  assert.equal(unauthorizedTouch, false);

  // Correct worker extends lease
  const authorizedTouch = await pool.touchLease('hb-task-1', 'worker-alpha', 50);
  assert.equal(authorizedTouch, true);

  // Re-acquire should return null since it is actively leased
  const trySteal = await pool.acquireNextTask('worker-beta');
  assert.equal(trySteal, null);
});

test('WorkerPool: expired lease is automatically reclaimed by next worker', async () => {
  const pool = createWorkerPool();
  await pool.enqueueTask('expire-task-1', { run: 'scrapling' });

  // Worker 1 acquires with -1s TTL (instantly expired)
  const lease1 = await pool.acquireNextTask('worker-dying', { ttlSeconds: -1 });
  assert.ok(lease1);
  assert.equal(lease1.attemptCount, 1);

  // Worker 2 should be able to acquire and reclaim the expired lease
  const lease2 = await pool.acquireNextTask('worker-healthy', { ttlSeconds: 60 });
  assert.ok(lease2);
  assert.equal(lease2.id, 'expire-task-1');
  assert.equal(lease2.leaseOwner, 'worker-healthy');
  assert.equal(lease2.attemptCount, 2);

  // Complete under worker-healthy
  const done = await pool.completeTask('expire-task-1', 'worker-healthy');
  assert.equal(done, true);
});

test('WorkerPool: lease release supports retry and failed states', async () => {
  const pool = createWorkerPool();
  await pool.enqueueTask('retry-task', { type: 'retry' });
  await pool.enqueueTask('fail-task', { type: 'fail' });

  // Lease both
  const t1 = await pool.acquireNextTask('w1');
  const t2 = await pool.acquireNextTask('w2');

  // Release t1 for retry (makeAvailable = true)
  const rel1 = await pool.releaseTask(t1.id, 'w1', true);
  assert.equal(rel1, true);

  // Release t2 as permanent failure (makeAvailable = false)
  const rel2 = await pool.releaseTask(t2.id, 'w2', false);
  assert.equal(rel2, true);

  const stats = await pool.getStats();
  assert.equal(stats.available, 1);
  assert.equal(stats.failed, 1);

  // Another worker can pick up the retried task
  const retried = await pool.acquireNextTask('w3');
  assert.equal(retried.id, 'retry-task');
});

test('WorkerPool: simulated Postgres pool executes atomic transaction with skip locked', async () => {
  let queryLog = [];
  let inTx = false;

  const mockClient = {
    async query(sql, params) {
      queryLog.push({ sql: sql.trim(), params });
      if (sql.includes('BEGIN')) inTx = true;
      if (sql.includes('COMMIT')) inTx = false;
      if (sql.includes('ROLLBACK')) inTx = false;

      if (sql.includes('candidate AS')) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 'pg-task-1',
              payload: { county: 'Cuyahoga' },
              leaseOwner: 'pg-worker-1',
              leasedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 60000).toISOString(),
              attemptCount: 1
            }
          ]
        };
      }
      return { rowCount: 1, rows: [] };
    },
    release() {}
  };

  const mockPgPool = {
    async connect() {
      return mockClient;
    },
    async query(sql, params) {
      queryLog.push({ sql: sql.trim(), params });
      if (sql.includes('COUNT(*)')) {
        return {
          rows: [
            { status: 'available', count: 5 },
            { status: 'leased', count: 2 },
            { status: 'completed', count: 10 }
          ]
        };
      }
      return { rowCount: 1, rows: [] };
    }
  };

  const pgPool = createWorkerPool({ pool: mockPgPool });
  assert.equal(pgPool.isMemory, false);

  // Enqueue
  await pgPool.enqueueTask('pg-task-1', { county: 'Cuyahoga' });
  assert.ok(queryLog.some(q => q.sql.includes('INSERT INTO worker_leases')));

  // Acquire
  const acquired = await pgPool.acquireNextTask('pg-worker-1', { ttlSeconds: 60 });
  assert.ok(acquired);
  assert.equal(acquired.id, 'pg-task-1');
  assert.ok(queryLog.some(q => q.sql.includes('FOR UPDATE SKIP LOCKED')));

  // Touch
  const touched = await pgPool.touchLease('pg-task-1', 'pg-worker-1', 120);
  assert.equal(touched, true);

  // Complete
  const completed = await pgPool.completeTask('pg-task-1', 'pg-worker-1');
  assert.equal(completed, true);

  // Release
  const released = await pgPool.releaseTask('pg-task-1', 'pg-worker-1', false);
  assert.equal(released, true);

  // Stats
  const stats = await pgPool.getStats();
  assert.equal(stats.available, 5);
  assert.equal(stats.leased, 2);
  assert.equal(stats.completed, 10);
});
