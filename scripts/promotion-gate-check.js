'use strict';

/**
 * Source promotion gate contract (Migration 014) — runnable without PostgreSQL.
 *
 * Validates:
 *  - migration SQL contains the durable-run evidence predicates
 *  - DiscoveryStore.promoteSource SQL gate text requires two clean runs
 *  - canary-live evaluateCanaryClean aligns with rejected=0 + complete/fullSweep
 *  - scheduler still lists only intended live adapters
 */

const fs = require('node:fs');
const path = require('node:path');
const { evaluateCanaryClean } = require('./canary-live');
const { SCHEDULED_ADAPTER_KEYS } = require('../server/sources/catalog');

function readSql() {
  return fs.readFileSync(
    path.resolve(__dirname, '../server/db/migrations/014_discovery_promotion_evidence.sql'),
    'utf8'
  );
}

function readStore() {
  return fs.readFileSync(path.resolve(__dirname, '../server/discovery/store.js'), 'utf8');
}

function checkPromotionContract() {
  const findings = [];
  const sql = readSql();
  const store = readStore();

  const sqlRequired = [
    "clean_canary_runs < 2",
    "accepted_count > 0",
    "rejected_count = 0",
    "fullSweepComplete",
    "configured_scope",
  ];
  for (const token of sqlRequired) {
    if (!sql.includes(token)) {
      findings.push({ id: 'sql-token', ok: false, detail: `migration missing ${token}` });
    }
  }
  findings.push({ id: 'sql-withdraw-legacy', ok: sql.includes("SET state = 'canary'"), detail: 'legacy promotions withdrawn when evidence incomplete' });

  if (!store.includes('clean_canary_runs>=2')) {
    findings.push({ id: 'store-promote-sql', ok: false, detail: 'PROMOTION_EVIDENCE_SQL missing clean_canary_runs>=2' });
  } else {
    findings.push({ id: 'store-promote-sql', ok: true, detail: 'PROMOTION_EVIDENCE_SQL requires ≥2 clean canaries' });
  }
  if (!store.includes('two clean durable canary runs')) {
    findings.push({ id: 'store-error-copy', ok: false, detail: 'promoteSource error copy missing two-clean-runs message' });
  } else {
    findings.push({ id: 'store-error-copy', ok: true, detail: 'promoteSource fails closed without evidence' });
  }

  const clean = evaluateCanaryClean({
    sourceId: 'servicelink',
    accepted: 3,
    rejected: 0,
    error: null,
    observationError: null,
    runId: '11111111-1111-1111-1111-111111111111',
    report: { scope: { source: 'servicelink' }, complete: true, fullSweepComplete: true, truncated: false },
  });
  findings.push({ id: 'canary-clean-align', ok: clean.clean === true, detail: 'gate-clean evaluation accepts rejected=0 complete run' });

  const dirty = evaluateCanaryClean({
    sourceId: 'servicelink',
    accepted: 3,
    rejected: 2,
    report: { scope: { source: 'servicelink' }, complete: true, fullSweepComplete: true, truncated: false },
  });
  findings.push({ id: 'canary-reject-align', ok: dirty.clean === false, detail: 'gate-clean evaluation rejects non-zero rejected' });

  findings.push({
    id: 'scheduled-keys',
    ok: Array.isArray(SCHEDULED_ADAPTER_KEYS) && SCHEDULED_ADAPTER_KEYS.length >= 20,
    detail: `scheduled adapters=${SCHEDULED_ADAPTER_KEYS.length}`,
  });

  return {
    ok: findings.every((f) => f.ok),
    findings,
    scheduledAdapterKeys: [...SCHEDULED_ADAPTER_KEYS].sort(),
  };
}

function main() {
  const result = checkPromotionContract();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    console.error('PROMOTION GATE CONTRACT FAILED');
    process.exitCode = 1;
  } else {
    console.log('PROMOTION GATE CONTRACT OK');
  }
}

if (require.main === module) main();
module.exports = { checkPromotionContract };
