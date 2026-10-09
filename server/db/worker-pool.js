'use strict';

/**
 * Worker Pool & Lease Fencing Manager
 *
 * Implements Task 17:
 * Provides multi-worker task leasing with Postgres `FOR UPDATE SKIP LOCKED`
 * concurrency control and an in-memory fallback for local development.
 */

function createWorkerPool(options = {}) {
  const pool = options.pool || null;
  const defaultTtlSeconds = options.defaultTtlSeconds || 300;

  // In-memory task registry fallback when running without Postgres
  const memoryTasks = new Map();

  /**
   * Enqueues a new task into the worker pool.
   */
  async function enqueueTask(id, payload = {}) {
    if (!id || typeof id !== 'string') {
      throw new Error('Task ID must be a non-empty string');
    }

    if (pool) {
      await pool.query(
        `INSERT INTO worker_leases (id, status, payload, created_at, updated_at)
         VALUES ($1, 'available', $2, clock_timestamp(), clock_timestamp())
         ON CONFLICT (id) DO UPDATE
         SET status = 'available', payload = $2, updated_at = clock_timestamp()`,
        [id, JSON.stringify(payload)]
      );
      return { id, status: 'available' };
    }

    // In-memory path
    const now = Date.now();
    const task = {
      id,
      leaseOwner: null,
      status: 'available',
      leasedAt: null,
      expiresAt: null,
      attemptCount: 0,
      payload,
      createdAt: now,
      updatedAt: now
    };
    memoryTasks.set(id, task);
    return { id, status: 'available' };
  }

  /**
   * Acquires the next available task using row-level locking (FOR UPDATE SKIP LOCKED).
   * Automatically reclaims expired tasks whose lease timed out.
   */
  async function acquireNextTask(workerId, { ttlSeconds = defaultTtlSeconds } = {}) {
    if (!workerId || typeof workerId !== 'string') {
      throw new Error('Worker ID is required to acquire a lease');
    }

    if (pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const query = `
          WITH candidate AS (
            SELECT id FROM worker_leases
            WHERE (status = 'available' OR (status = 'leased' AND expires_at < clock_timestamp()))
            ORDER BY created_at ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
          )
          UPDATE worker_leases wl
          SET status = 'leased',
              lease_owner = $1,
              leased_at = clock_timestamp(),
              expires_at = clock_timestamp() + ($2 || ' seconds')::interval,
              attempt_count = attempt_count + 1,
              updated_at = clock_timestamp()
          FROM candidate
          WHERE wl.id = candidate.id
          RETURNING wl.id, wl.payload, wl.lease_owner AS "leaseOwner", wl.leased_at AS "leasedAt", wl.expires_at AS "expiresAt", wl.attempt_count AS "attemptCount";
        `;
        const res = await client.query(query, [workerId, ttlSeconds]);
        await client.query('COMMIT');

        if (res.rowCount === 0) return null;
        return res.rows[0];
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    // In-memory atomic lease acquisition
    const now = Date.now();
    for (const task of memoryTasks.values()) {
      const isAvailable = task.status === 'available';
      const isExpired = task.status === 'leased' && task.expiresAt && task.expiresAt < now;

      if (isAvailable || isExpired) {
        task.status = 'leased';
        task.leaseOwner = workerId;
        task.leasedAt = now;
        task.expiresAt = now + ttlSeconds * 1000;
        task.attemptCount += 1;
        task.updatedAt = now;
        return { ...task };
      }
    }

    return null;
  }

  /**
   * Heartbeat touches an active lease to extend its expiration window.
   */
  async function touchLease(taskId, workerId, extendSeconds = defaultTtlSeconds) {
    if (pool) {
      const res = await pool.query(
        `UPDATE worker_leases
         SET expires_at = clock_timestamp() + ($3 || ' seconds')::interval,
             updated_at = clock_timestamp()
         WHERE id = $1 AND lease_owner = $2 AND status = 'leased'
         RETURNING id`,
        [taskId, workerId, extendSeconds]
      );
      return res.rowCount === 1;
    }

    const task = memoryTasks.get(taskId);
    if (!task || task.status !== 'leased' || task.leaseOwner !== workerId) {
      return false;
    }
    const now = Date.now();
    task.expiresAt = now + extendSeconds * 1000;
    task.updatedAt = now;
    return true;
  }

  /**
   * Marks a task as completed upon successful execution.
   */
  async function completeTask(taskId, workerId) {
    if (pool) {
      const res = await pool.query(
        `UPDATE worker_leases
         SET status = 'completed',
             expires_at = NULL,
             updated_at = clock_timestamp()
         WHERE id = $1 AND lease_owner = $2 AND status = 'leased'
         RETURNING id`,
        [taskId, workerId]
      );
      return res.rowCount === 1;
    }

    const task = memoryTasks.get(taskId);
    if (!task || task.status !== 'leased' || task.leaseOwner !== workerId) {
      return false;
    }
    task.status = 'completed';
    task.expiresAt = null;
    task.updatedAt = Date.now();
    return true;
  }

  /**
   * Releases a lease back to the pool, marking it failed or available for retry.
   */
  async function releaseTask(taskId, workerId, makeAvailable = true) {
    const nextStatus = makeAvailable ? 'available' : 'failed';
    if (pool) {
      const res = await pool.query(
        `UPDATE worker_leases
         SET status = $3,
             lease_owner = NULL,
             expires_at = NULL,
             updated_at = clock_timestamp()
         WHERE id = $1 AND lease_owner = $2 AND status = 'leased'
         RETURNING id`,
        [taskId, workerId, nextStatus]
      );
      return res.rowCount === 1;
    }

    const task = memoryTasks.get(taskId);
    if (!task || task.status !== 'leased' || task.leaseOwner !== workerId) {
      return false;
    }
    task.status = nextStatus;
    task.leaseOwner = null;
    task.expiresAt = null;
    task.updatedAt = Date.now();
    return true;
  }

  /**
   * Aggregates task stats across the pool.
   */
  async function getStats() {
    if (pool) {
      const res = await pool.query(
        `SELECT status, COUNT(*)::int AS count
         FROM worker_leases
         GROUP BY status`
      );
      const counts = { available: 0, leased: 0, completed: 0, failed: 0 };
      for (const row of res.rows) {
        counts[row.status] = row.count;
      }
      return counts;
    }

    const counts = { available: 0, leased: 0, completed: 0, failed: 0 };
    for (const task of memoryTasks.values()) {
      counts[task.status] = (counts[task.status] || 0) + 1;
    }
    return counts;
  }

  return {
    enqueueTask,
    acquireNextTask,
    touchLease,
    completeTask,
    releaseTask,
    getStats,
    get isMemory() {
      return !pool;
    }
  };
}

module.exports = {
  createWorkerPool
};
