'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const { parseEnv } = require('node:util');
const { createIsolatedDatabase } = require('../test/discovery-acceptance-db');
const { createDiscoveryStore } = require('../server/discovery/store');
const { run: runWorkerIteration } = require('./discovery-worker');

const SOURCE_ID = 'soak-offline-fixture';
const DEFAULTS = Object.freeze({ samples: 3, durationMs: 30_000, leaseSeconds: 10, recovery: true, heartbeat: true, productionTimer: false, testEnvFile: null });
const PRODUCTION_HEARTBEAT_MS = 120_000;

function parseInteger(value, name, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return parsed;
}

function validateOptions(options = {}) {
  const config = { ...DEFAULTS, ...options };
  config.samples = parseInteger(config.samples, 'samples', 1, 50);
  config.durationMs = parseInteger(config.durationMs, 'durationMs', 1_000, 300_000);
  config.leaseSeconds = parseInteger(config.leaseSeconds, 'leaseSeconds', 10, 30);
  for (const key of ['recovery', 'heartbeat', 'productionTimer']) {
    if (typeof config[key] !== 'boolean') throw new Error(`${key} must be a boolean`);
  }
  if (config.testEnvFile !== null && (typeof config.testEnvFile !== 'string' || !config.testEnvFile.trim())) throw new Error('testEnvFile must be a non-empty path or null');
  return config;
}

function recordWorkerSample(report, result, index, durationMs) {
  const sample = { kind: 'worker-iteration', index, jobId: result?.id || null, status: result?.status || null, durationMs };
  report.samples.push(sample);
  if (sample.status !== 'completed') {
    report.failures.push({
      phase: `worker-iteration-${index}`,
      code: 'WORKER_ITERATION_NOT_COMPLETED',
      message: `worker-iteration-${index} failed`,
    });
  }
  return sample;
}

function parseArgs(args = []) {
  const options = { ...DEFAULTS };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--samples') options.samples = parseInteger(args[++index], '--samples', 1, 50);
    else if (argument === '--duration-ms') options.durationMs = parseInteger(args[++index], '--duration-ms', 1_000, 300_000);
    else if (argument === '--lease-seconds') options.leaseSeconds = parseInteger(args[++index], '--lease-seconds', 10, 30);
    else if (argument === '--no-recovery') options.recovery = false;
    else if (argument === '--no-heartbeat') options.heartbeat = false;
    else if (argument === '--production-timer') options.productionTimer = true;
    else if (argument === '--test-env-file') options.testEnvFile = args[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function designatedTestDatabaseUrl(filePath) {
  const parsed = parseEnv(fs.readFileSync(filePath, 'utf8'));
  const url = parsed.DISCOVERY_TEST_DATABASE_URL || parsed.TEST_DATABASE_URL || parsed.DATABASE_URL;
  if (!url) throw new Error('The designated test env file does not define a database URL');
  return url;
}

async function runProductionTimerSample(store, options, dependencies, deadline) {
  const started = dependencies.now();
  const availableMs = deadline - started;
  if (availableMs < PRODUCTION_HEARTBEAT_MS + 5_000) {
    throw new Error(`Duration budget must leave at least ${PRODUCTION_HEARTBEAT_MS + 5_000}ms for the production timer sample`);
  }
  let initialClaim = null;
  let renewalResolve;
  let renewalReject;
  const renewalObserved = new Promise((resolve, reject) => { renewalResolve = resolve; renewalReject = reject; });
  const renewals = [];
  const instrumentedStore = new Proxy(store, {
    get(target, property) {
      if (property === 'claimJob') return async (...args) => {
        const claimed = await target.claimJob(...args);
        if (claimed && !initialClaim) initialClaim = claimed;
        return claimed;
      };
      if (property === 'renewJobClaim') return async (jobId, ownerId, ttlSeconds) => {
        try {
          const renewed = await target.renewJobClaim(jobId, ownerId, ttlSeconds);
          const job = await target.getJob(jobId);
          const observation = {
            atMs: dependencies.now(),
            renewed,
            ttlSeconds,
            leaseExpiresAt: job?.leaseExpiresAt ? new Date(job.leaseExpiresAt).toISOString() : null,
          };
          renewals.push(observation);
          if (renewed) renewalResolve(observation);
          else renewalReject(new Error('Production heartbeat did not renew the active claim'));
          return renewed;
        } catch (error) {
          renewalReject(error);
          throw error;
        }
      };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const coordinator = {
    async execute(jobId, input, { owner }) {
      await store.updateJob(jobId, { status: 'running', started: true, stage: { name: 'collection', value: { status: 'running' } } }, { ownerId: owner });
      const timeoutMs = Math.min(135_000, deadline - dependencies.now() - 1_000);
      let timeout;
      try {
        await Promise.race([
          renewalObserved,
          new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Production heartbeat was not observed before the bounded timeout')), timeoutMs); }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
      return store.updateJob(jobId, {
        status: 'completed', completed: true,
        stage: { name: 'collection', value: { status: 'completed' } },
        result: { synthetic: true, sourceResults: [{ sourceId: SOURCE_ID, accepted: 0, rejected: 0, report: { scope: { kind: 'offline_worker_production_timer', source: SOURCE_ID }, complete: false, fullSweepComplete: false, truncated: false } }], requestedSourceIds: input.sourceIds },
      }, { ownerId: owner });
    },
  };
  const result = await dependencies.runWorker({
    canarySource: SOURCE_ID,
    database: { isPg: true, pool: store.pool },
    discoveryStore: instrumentedStore,
    collector: { collectionCoordinator: coordinator },
    storageProbe: () => ({ ready: true, synthetic: true }),
  });
  const renewed = renewals[0];
  const initialExpiryMs = Date.parse(initialClaim?.leaseExpiresAt);
  const renewedExpiryMs = Date.parse(renewed?.leaseExpiresAt);
  if (result?.status !== 'completed') throw new Error('Production timer worker iteration did not complete');
  if (renewals.length < 1 || !Number.isFinite(initialExpiryMs) || !Number.isFinite(renewedExpiryMs) || renewedExpiryMs <= initialExpiryMs) {
    throw new Error('Production heartbeat did not extend the PostgreSQL job lease');
  }
  return {
    kind: 'production-worker-timer', jobId: result.id, status: result.status,
    durationMs: dependencies.now() - started,
    heartbeatIntervalMs: PRODUCTION_HEARTBEAT_MS,
    firstRenewalAfterMs: renewed.atMs - started,
    renewCallCount: renewals.length,
    renewalTtlSeconds: renewed.ttlSeconds,
    initialLeaseExpiresAt: new Date(initialExpiryMs).toISOString(),
    renewedLeaseExpiresAt: new Date(renewedExpiryMs).toISOString(),
    leaseExtendedMs: renewedExpiryMs - initialExpiryMs,
  };
}

function safeFailure(error, phase) {
  return {
    phase,
    code: error && error.code ? String(error.code).slice(0, 80) : null,
    message: `${phase} failed`,
  };
}

function offlineCoordinator(store) {
  return {
    async execute(jobId, input, { owner }) {
      await store.updateJob(jobId, {
        status: 'running',
        started: true,
        stage: { name: 'collection', value: { status: 'running' } },
      }, { ownerId: owner });
      return store.updateJob(jobId, {
        status: 'completed',
        completed: true,
        stage: { name: 'collection', value: { status: 'completed' } },
        result: {
          synthetic: true,
          sourceResults: [{
            sourceId: SOURCE_ID,
            accepted: 0,
            rejected: 0,
            report: {
              scope: { kind: 'offline_worker_soak', source: SOURCE_ID },
              complete: false,
              fullSweepComplete: false,
              truncated: false,
            },
          }],
          requestedSourceIds: input.sourceIds,
        },
      }, { ownerId: owner });
    },
  };
}

async function inventoryCount(pool) {
  const result = await pool.query('SELECT COUNT(*)::int AS count FROM listings');
  return result.rows[0].count;
}

async function runRecoverySample(store, options, dependencies, deadline) {
  const started = dependencies.now();
  const job = await store.createOrReuseJob({
    sourceIds: [SOURCE_ID],
    trigger: 'offline_soak_recovery',
    idempotencyKey: `offline-soak-recovery:${crypto.randomUUID()}`,
  });
  const firstOwner = `soak:first:${crypto.randomUUID()}`;
  const secondOwner = `soak:second:${crypto.randomUUID()}`;
  const firstClaim = await store.claimJob(job.id, firstOwner, options.leaseSeconds);
  if (!firstClaim) throw new Error('Initial recovery lease was not claimed');
  const earlyClaim = await store.claimJob(job.id, secondOwner, options.leaseSeconds);
  if (earlyClaim) throw new Error('A second worker claimed an unexpired lease');
  const waitMs = options.leaseSeconds * 1000 + 150;
  if (dependencies.now() + waitMs > deadline) throw new Error('Duration budget cannot contain the recovery lease expiry');
  await dependencies.sleep(waitMs);
  const recovered = await store.claimJob(job.id, secondOwner, options.leaseSeconds);
  if (!recovered) throw new Error('Expired lease was not recovered');
  await store.updateJob(job.id, { status: 'completed', completed: true }, { ownerId: secondOwner });
  return {
    kind: 'lease-recovery',
    jobId: job.id,
    durationMs: dependencies.now() - started,
    earlyClaimRejected: true,
    recoveredAttemptCount: recovered.attemptCount,
  };
}

async function runHeartbeatSample(store, options, dependencies, deadline) {
  const started = dependencies.now();
  const job = await store.createOrReuseJob({
    sourceIds: [SOURCE_ID],
    trigger: 'offline_soak_heartbeat',
    idempotencyKey: `offline-soak-heartbeat:${crypto.randomUUID()}`,
  });
  const owner = `soak:active:${crypto.randomUUID()}`;
  const competitor = `soak:competitor:${crypto.randomUUID()}`;
  if (!await store.claimJob(job.id, owner, options.leaseSeconds)) throw new Error('Active lease was not claimed');
  const renewAfterMs = Math.max(1_000, Math.floor(options.leaseSeconds * 600));
  const crossOriginalExpiryMs = options.leaseSeconds * 1000 - renewAfterMs + 150;
  const totalWaitMs = renewAfterMs + crossOriginalExpiryMs;
  if (dependencies.now() + totalWaitMs > deadline) throw new Error('Duration budget cannot contain the heartbeat sample');
  await dependencies.sleep(renewAfterMs);
  if (!await store.renewJobClaim(job.id, owner, options.leaseSeconds)) throw new Error('Active lease renewal failed');
  if (await store.claimJob(job.id, competitor, options.leaseSeconds)) throw new Error('Competitor claimed immediately after renewal');
  await dependencies.sleep(crossOriginalExpiryMs);
  if (await store.claimJob(job.id, competitor, options.leaseSeconds)) throw new Error('Competitor claimed after original expiry despite renewed lease');
  await store.updateJob(job.id, { status: 'completed', completed: true }, { ownerId: owner });
  return {
    kind: 'active-lease-renewal',
    jobId: job.id,
    durationMs: dependencies.now() - started,
    renewAfterMs,
    crossedOriginalExpiry: true,
    competitorClaimsRejected: 2,
  };
}

async function runSoak(options = DEFAULTS, injected = {}) {
  const config = validateOptions(options);
  const testUrl = injected.databaseUrl || (config.testEnvFile ? designatedTestDatabaseUrl(config.testEnvFile) : null) || process.env.DISCOVERY_TEST_DATABASE_URL || process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error('DISCOVERY_TEST_DATABASE_URL or TEST_DATABASE_URL is required; DATABASE_URL is intentionally ignored');
  const dependencies = {
    now: injected.now || Date.now,
    sleep: injected.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
    createDatabase: injected.createDatabase || createIsolatedDatabase,
    runWorker: injected.runWorker || runWorkerIteration,
  };
  const startedAtMs = dependencies.now();
  const deadline = startedAtMs + config.durationMs;
  const report = {
    version: 1,
    mode: 'isolated-postgresql-offline-coordinator',
    startedAt: new Date(startedAtMs).toISOString(),
    config,
    samples: [],
    failures: [],
    complete: false,
  };
  let database;
  const previousMode = process.env.DISCOVERY_MODE;
  try {
    database = await dependencies.createDatabase({ url: testUrl, prefix: 'discovery_worker_soak', max: 4 });
    report.schema = database.schema;
    await database.pool.query("INSERT INTO sources(key,label,tier,color,note,is_active) VALUES($1,'Offline soak fixture','A','#475569','Synthetic isolated worker verification',FALSE) ON CONFLICT(key) DO NOTHING", [SOURCE_ID]);
    const store = createDiscoveryStore({ isPg: true, pool: database.pool });
    report.inventoryBefore = await inventoryCount(database.pool);
    process.env.DISCOVERY_MODE = 'advanced';
    const coordinator = offlineCoordinator(store);
    for (let index = 0; index < config.samples; index += 1) {
      if (dependencies.now() >= deadline) {
        report.failures.push({ phase: 'worker-loop', code: 'SOAK_DEADLINE_EXCEEDED', message: 'Duration budget expired before all samples ran' });
        break;
      }
      const sampleStart = dependencies.now();
      try {
        const result = await dependencies.runWorker({
          canarySource: SOURCE_ID,
          database: { isPg: true, pool: database.pool },
          discoveryStore: store,
          collector: { collectionCoordinator: coordinator },
          storageProbe: () => ({ ready: true, synthetic: true }),
        });
        recordWorkerSample(report, result, index, dependencies.now() - sampleStart);
      } catch (error) {
        report.failures.push(safeFailure(error, `worker-iteration-${index}`));
      }
    }
    if (config.recovery && !report.failures.length) {
      try {
        report.samples.push(await runRecoverySample(store, config, dependencies, deadline));
      } catch (error) {
        report.failures.push(safeFailure(error, 'lease-recovery'));
      }
    }
    if (config.heartbeat && !report.failures.length) {
      try {
        report.samples.push(await runHeartbeatSample(store, config, dependencies, deadline));
      } catch (error) {
        report.failures.push(safeFailure(error, 'active-lease-renewal'));
      }
    }
    if (config.productionTimer && !report.failures.length) {
      try {
        report.samples.push(await runProductionTimerSample(store, config, dependencies, deadline));
      } catch (error) {
        report.failures.push(safeFailure(error, 'production-worker-timer'));
      }
    }
    report.inventoryAfter = await inventoryCount(database.pool);
    if (report.inventoryAfter !== report.inventoryBefore) {
      report.failures.push({ phase: 'inventory-guard', code: 'INVENTORY_CHANGED', message: 'The isolated listing count changed during the soak' });
    }
    report.complete = report.failures.length === 0 && report.samples.filter((sample) => sample.kind === 'worker-iteration').length === config.samples && (!config.recovery || report.samples.some((sample) => sample.kind === 'lease-recovery')) && (!config.heartbeat || report.samples.some((sample) => sample.kind === 'active-lease-renewal')) && (!config.productionTimer || report.samples.some((sample) => sample.kind === 'production-worker-timer'));
  } catch (error) {
    report.failures.push(safeFailure(error, database ? 'soak' : 'database-setup'));
  } finally {
    if (previousMode === undefined) delete process.env.DISCOVERY_MODE;
    else process.env.DISCOVERY_MODE = previousMode;
    if (database) {
      try { await database.close(); report.schemaDropped = true; }
      catch (error) { report.schemaDropped = false; report.failures.push(safeFailure(error, 'schema-cleanup')); report.complete = false; }
    }
    const completedAtMs = dependencies.now();
    report.completedAt = new Date(completedAtMs).toISOString();
    report.durationMs = completedAtMs - startedAtMs;
  }
  return report;
}

async function main(args = process.argv.slice(2)) {
  const report = await runSoak(parseArgs(args));
  console.log(JSON.stringify(report, null, 2));
  if (!report.complete) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => {
  console.error(JSON.stringify({ complete: false, failures: [safeFailure(error, 'startup')] }, null, 2));
  process.exitCode = 1;
});

module.exports = { DEFAULTS, PRODUCTION_HEARTBEAT_MS, SOURCE_ID, designatedTestDatabaseUrl, offlineCoordinator, parseArgs, recordWorkerSample, runHeartbeatSample, runProductionTimerSample, runRecoverySample, runSoak, safeFailure, validateOptions };
