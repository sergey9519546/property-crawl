'use strict';
/**
 * scripts/swarm/task-queue.js — Work-stealing task queue with lease fencing.
 *
 * Mirrors the lease/fencing spirit of server/discovery/job-fence.js: an agent
 * claims the highest-priority task whose capability it holds, holds a timed
 * lease, and cannot complete a task after the lease expires. Persisted to
 * .cache/swarm-tasks.json so a restart can recover in-flight work.
 */

const fs = require('fs');
const path = require('path');
const { atomicWriteJson } = require('./memory-store');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_QUEUE_PATH =
  process.env.SWARM_TASKS_PATH || path.join(ROOT, '.cache', 'swarm-tasks.json');

const STATUS = {
  QUEUED: 'queued',
  CLAIMED: 'claimed',
  DONE: 'done',
  FAILED: 'failed',
  DEAD: 'deadLetter',
};

class TaskQueue {
  /**
   * @param {object} [opts]
   * @param {string} [opts.persistPath] defaults to .cache/swarm-tasks.json
   * @param {boolean} [opts.persist] set false for pure in-memory (tests)
   */
  constructor(opts = {}) {
    this.persistPath = opts.persistPath || DEFAULT_QUEUE_PATH;
    this.persist = opts.persist !== false;
    this.tasks = new Map();
    this._seq = 0;
    this._load();
  }

  _load() {
    if (!this.persist) return;
    try {
      if (!fs.existsSync(this.persistPath)) return;
      const raw = JSON.parse(fs.readFileSync(this.persistPath, 'utf8'));
      if (!raw || !Array.isArray(raw.tasks)) return;
      for (const t of raw.tasks) {
        this.tasks.set(t.id, t);
        const n = Number(String(t.id).replace(/\D+/g, ''));
        if (Number.isFinite(n) && n > this._seq) this._seq = n;
      }
    } catch (_) {}
  }

  _flush() {
    if (!this.persist) return;
    atomicWriteJson(this.persistPath, { tasks: Array.from(this.tasks.values()) });
  }

  /**
   * @param {object} task
   * @param {string} [task.id]
   * @param {string} task.strategy
   * @param {string} task.phase
   * @param {string} task.capability
   * @param {*} [task.payload]
   * @param {number} [task.priority] 0-9, lower = higher priority
   * @param {number} [task.maxAttempts]
   */
  enqueue(task) {
    if (!task || !task.capability) {
      throw new Error('enqueue requires a task with a capability');
    }
    this._seq += 1;
    const id = task.id || `task-${this._seq}`;
    if (this.tasks.has(id)) {
      throw new Error(`Task id "${id}" already enqueued`);
    }
    const record = {
      id,
      strategy: task.strategy || 'development',
      phase: task.phase || 'execute',
      capability: task.capability,
      payload: task.payload != null ? task.payload : null,
      priority: clampPriority(task.priority),
      maxAttempts: task.maxAttempts != null ? task.maxAttempts : 3,
      attempts: task.attempts != null ? task.attempts : 0,
      status: STATUS.QUEUED,
      leaseOwner: null,
      leaseExpiresAt: null,
      result: null,
      error: null,
      enqueuedAt: Date.now(),
    };
    this.tasks.set(id, record);
    this._flush();
    return record;
  }

  /**
   * Atomically claim the highest-priority queued task whose capability is in
   * the agent's capability list. Work-stealing: any idle agent may take any
   * matching task.
   * @param {string} agentId
   * @param {string[]} capabilities
   * @param {number} [leaseMs]
   */
  claim(agentId, capabilities, leaseMs = 30000) {
    if (!agentId) throw new Error('claim requires an agentId');
    const caps = Array.isArray(capabilities) ? capabilities : [];
    const now = Date.now();

    const candidates = Array.from(this.tasks.values())
      .filter((t) => t.status === STATUS.QUEUED && caps.includes(t.capability))
      .sort((a, b) => a.priority - b.priority || a.enqueuedAt - b.enqueuedAt);

    if (candidates.length === 0) return null;

    const task = candidates[0];
    task.status = STATUS.CLAIMED;
    task.leaseOwner = agentId;
    task.leaseExpiresAt = now + leaseMs;
    task.attempts += 1;
    this._flush();
    return task;
  }

  complete(taskId, result) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Unknown task "${taskId}"`);
    if (task.status !== STATUS.CLAIMED) {
      throw new Error(`Task "${taskId}" is ${task.status}, not claimed`);
    }
    task.status = STATUS.DONE;
    task.result = result != null ? result : { ok: true };
    task.leaseOwner = null;
    task.leaseExpiresAt = null;
    this._flush();
    return task;
  }

  /**
   * Fail a claimed task. Re-queues while attempts < maxAttempts, else dead-letters.
   */
  fail(taskId, error) {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Unknown task "${taskId}"`);
    task.leaseOwner = null;
    task.leaseExpiresAt = null;
    task.error = error != null ? String(error) : 'unknown error';
    if (task.attempts < task.maxAttempts) {
      task.status = STATUS.QUEUED;
    } else {
      task.status = STATUS.DEAD;
    }
    this._flush();
    return task;
  }

  /**
   * Return tasks whose lease expired to the queued pool.
   * @param {number} [now]
   * @returns {object[]} recovered tasks
   */
  expireLeases(now = Date.now()) {
    const recovered = [];
    for (const task of this.tasks.values()) {
      if (task.status === STATUS.CLAIMED && task.leaseExpiresAt != null && task.leaseExpiresAt <= now) {
        task.status = STATUS.QUEUED;
        task.leaseOwner = null;
        task.leaseExpiresAt = null;
        task.error = 'lease expired';
        recovered.push(task);
      }
    }
    if (recovered.length > 0) this._flush();
    return recovered;
  }

  get(taskId) {
    return this.tasks.get(taskId) || null;
  }

  list(status) {
    const all = Array.from(this.tasks.values());
    return status ? all.filter((t) => t.status === status) : all;
  }

  /** Fail every remaining queued/claimed task (used on orchestrator timeout). */
  abortRemaining(reason = 'aborted') {
    let n = 0;
    for (const task of this.tasks.values()) {
      if (task.status === STATUS.QUEUED || task.status === STATUS.CLAIMED) {
        task.status = STATUS.FAILED;
        task.error = reason;
        task.leaseOwner = null;
        task.leaseExpiresAt = null;
        n += 1;
      }
    }
    if (n > 0) this._flush();
    return n;
  }

  stats() {
    const s = { queued: 0, claimed: 0, done: 0, failed: 0, deadLetter: 0 };
    for (const task of this.tasks.values()) {
      if (task.status === STATUS.QUEUED) s.queued += 1;
      else if (task.status === STATUS.CLAIMED) s.claimed += 1;
      else if (task.status === STATUS.DONE) s.done += 1;
      else if (task.status === STATUS.FAILED) s.failed += 1;
      else if (task.status === STATUS.DEAD) s.deadLetter += 1;
    }
    return s;
  }

  clear() {
    this.tasks.clear();
    this._flush();
  }
}

function clampPriority(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return 5;
  return Math.max(0, Math.min(9, Math.round(n)));
}

module.exports = { TaskQueue, STATUS, DEFAULT_QUEUE_PATH };
